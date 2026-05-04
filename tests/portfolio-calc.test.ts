import { computePositions, buildHoldings, computeTotalRealizedPL } from '../src/utils/portfolio-calc';
import { Trade } from '../src/types/portfolio';

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 'test-id',
    portfolio_id: 'port-1',
    ticker: 'AAPL',
    market: 'US',
    type: 'buy',
    shares: 10,
    price: 100,
    currency: 'USD',
    date: '2024-01-01',
    notes: null,
    created_at: new Date().toISOString(),
    asset_type: 'stock',
    unit: null,
    ...overrides,
  };
}

describe('computePositions', () => {
  describe('buy only', () => {
    it('accumulates shares on a single buy', () => {
      const trades = [makeTrade({ shares: 10, price: 100 })];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.shares).toBe(10);
      expect(pos.avg_cost).toBe(100);
      expect(pos.realized_pl).toBe(0);
    });

    it('computes weighted average cost across multiple buys', () => {
      const trades = [
        makeTrade({ shares: 10, price: 100, date: '2024-01-01' }),
        makeTrade({ shares: 10, price: 120, date: '2024-01-02' }),
      ];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.shares).toBe(20);
      expect(pos.avg_cost).toBe(110); // (10*100 + 10*120) / 20
      expect(pos.realized_pl).toBe(0);
    });
  });

  describe('buy then sell', () => {
    it('computes realized P&L on full sell at profit', () => {
      const trades = [
        makeTrade({ type: 'buy', shares: 10, price: 100, date: '2024-01-01' }),
        makeTrade({ type: 'sell', shares: 10, price: 150, date: '2024-01-02' }),
      ];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.shares).toBe(0);
      expect(pos.realized_pl).toBe(500); // (150-100) * 10
    });

    it('computes realized P&L on full sell at loss', () => {
      const trades = [
        makeTrade({ type: 'buy', shares: 10, price: 100, date: '2024-01-01' }),
        makeTrade({ type: 'sell', shares: 10, price: 80, date: '2024-01-02' }),
      ];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.shares).toBe(0);
      expect(pos.realized_pl).toBe(-200); // (80-100) * 10
    });

    it('computes realized P&L on partial sell', () => {
      const trades = [
        makeTrade({ type: 'buy', shares: 20, price: 100, date: '2024-01-01' }),
        makeTrade({ type: 'sell', shares: 10, price: 150, date: '2024-01-02' }),
      ];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.shares).toBe(10);
      expect(pos.realized_pl).toBe(500); // (150-100) * 10
      expect(pos.avg_cost).toBe(100); // avg_cost unchanged on sell
    });

    it('does not change avg_cost on sell', () => {
      const trades = [
        makeTrade({ type: 'buy', shares: 10, price: 100, date: '2024-01-01' }),
        makeTrade({ type: 'buy', shares: 10, price: 120, date: '2024-01-02' }),
        makeTrade({ type: 'sell', shares: 5, price: 200, date: '2024-01-03' }),
      ];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.avg_cost).toBe(110); // unchanged after sell
      expect(pos.shares).toBe(15);
      expect(pos.realized_pl).toBe((200 - 110) * 5); // 450
    });
  });

  describe('multiple tickers', () => {
    it('tracks each ticker independently', () => {
      const trades = [
        makeTrade({ ticker: 'AAPL', shares: 10, price: 100 }),
        makeTrade({ ticker: 'MSFT', shares: 5, price: 200 }),
      ];
      const positions = computePositions(trades);
      expect(positions.get('AAPL')!.shares).toBe(10);
      expect(positions.get('MSFT')!.shares).toBe(5);
    });
  });

  describe('trade ordering', () => {
    it('processes trades in date order regardless of input order', () => {
      // If sell comes before buy in input but after in date — should be: buy then sell
      const trades = [
        makeTrade({ type: 'sell', shares: 10, price: 150, date: '2024-01-02' }),
        makeTrade({ type: 'buy', shares: 10, price: 100, date: '2024-01-01' }),
      ];
      const positions = computePositions(trades);
      const pos = positions.get('AAPL')!;
      expect(pos.realized_pl).toBe(500);
      expect(pos.shares).toBe(0);
    });
  });

  describe('ticker case normalization', () => {
    it('normalizes tickers to uppercase', () => {
      const trades = [makeTrade({ ticker: 'aapl' })];
      const positions = computePositions(trades);
      expect(positions.has('AAPL')).toBe(true);
      expect(positions.has('aapl')).toBe(false);
    });
  });

  describe('empty input', () => {
    it('returns empty map for no trades', () => {
      const positions = computePositions([]);
      expect(positions.size).toBe(0);
    });
  });
});

describe('computeTotalRealizedPL', () => {
  it('sums realized_pl across all tickers', () => {
    const trades = [
      // AAPL: buy 10 @ 100, sell 10 @ 150 → +500
      makeTrade({ ticker: 'AAPL', type: 'buy', shares: 10, price: 100, date: '2024-01-01' }),
      makeTrade({ ticker: 'AAPL', type: 'sell', shares: 10, price: 150, date: '2024-01-02' }),
      // MSFT: buy 5 @ 200, sell 5 @ 180 → -100
      makeTrade({ ticker: 'MSFT', type: 'buy', shares: 5, price: 200, date: '2024-01-01' }),
      makeTrade({ ticker: 'MSFT', type: 'sell', shares: 5, price: 180, date: '2024-01-02' }),
    ];
    const total = computeTotalRealizedPL(trades);
    expect(total).toBeCloseTo(400); // 500 - 100
  });

  it('returns 0 for no trades', () => {
    expect(computeTotalRealizedPL([])).toBe(0);
  });

  it('returns 0 when no sells have occurred', () => {
    const trades = [makeTrade({ type: 'buy', shares: 10, price: 100 })];
    expect(computeTotalRealizedPL(trades)).toBe(0);
  });
});

describe('buildHoldings', () => {
  it('excludes closed positions (shares = 0)', () => {
    const trades = [
      makeTrade({ type: 'buy', shares: 10, price: 100, date: '2024-01-01' }),
      makeTrade({ type: 'sell', shares: 10, price: 150, date: '2024-01-02' }),
    ];
    const priceMap = { AAPL: { price: 160, currency: 'USD' } };
    const holdings = buildHoldings(trades, priceMap);
    expect(holdings).toHaveLength(0);
  });

  it('computes value and unrealized P&L from current price', () => {
    const trades = [makeTrade({ shares: 10, price: 100 })];
    const priceMap = { AAPL: { price: 150, currency: 'USD' } };
    const holdings = buildHoldings(trades, priceMap);
    expect(holdings).toHaveLength(1);
    const h = holdings[0];
    expect(h.shares).toBe(10);
    expect(h.avg_cost).toBe(100);
    expect(h.value).toBe(1500);
    expect(h.cost).toBe(1000);
    expect(h.unrealized_pl).toBe(500);
    expect(h.unrealized_pl_pct).toBeCloseTo(50, 1);
  });

  it('returns null value and P&L when price is unavailable', () => {
    const trades = [makeTrade({ shares: 10, price: 100 })];
    const holdings = buildHoldings(trades, {});
    expect(holdings[0].value).toBeNull();
    expect(holdings[0].unrealized_pl).toBeNull();
    expect(holdings[0].unrealized_pl_pct).toBeNull();
  });

  it('uses currency from the most recent trade for each ticker', () => {
    const trades = [
      makeTrade({ currency: 'USD', date: '2024-01-01' }),
      makeTrade({ currency: 'HKD', date: '2024-01-02' }), // later trade wins
    ];
    const priceMap = { AAPL: { price: 150, currency: 'HKD' } };
    const holdings = buildHoldings(trades, priceMap);
    expect(holdings[0].currency).toBe('HKD');
  });
});
