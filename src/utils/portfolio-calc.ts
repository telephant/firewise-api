import { Trade, Holding } from '../types/portfolio';

export interface PositionState {
  shares: number;
  avg_cost: number;
  realized_pl: number;
}

export function computePositions(trades: Trade[]): Map<string, PositionState> {
  // Sort trades by date ascending
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const positions = new Map<string, PositionState>();

  for (const trade of sorted) {
    const key = trade.ticker.toUpperCase();
    const pos = positions.get(key) || { shares: 0, avg_cost: 0, realized_pl: 0 };

    if (trade.type === 'buy') {
      // Update avg cost
      const newShares = pos.shares + trade.shares;
      pos.avg_cost = (pos.shares * pos.avg_cost + trade.shares * trade.price) / newShares;
      pos.shares = newShares;
    } else {
      // sell
      pos.realized_pl += (trade.price - pos.avg_cost) * trade.shares;
      pos.shares = Math.max(0, pos.shares - trade.shares);
      // avg_cost unchanged on sell
    }

    positions.set(key, pos);
  }

  return positions;
}

export function buildHoldings(
  trades: Trade[],
  priceMap: Record<string, { price: number | null; currency: string; quote_type?: string | null }>
): Holding[] {
  const positions = computePositions(trades);
  const holdings: Holding[] = [];

  // Get market/currency/asset_subtype from last trade for each ticker
  const tickerMeta = new Map<string, { market: string; currency: string; asset_subtype: Holding['asset_subtype'] }>();
  for (const t of trades) {
    tickerMeta.set(t.ticker.toUpperCase(), {
      market: t.market,
      currency: t.currency,
      asset_subtype: t.asset_subtype ?? null,
    });
  }

  for (const [ticker, pos] of positions) {
    if (pos.shares <= 0) continue; // skip closed positions

    const meta = tickerMeta.get(ticker) || { market: 'US', currency: 'USD', asset_subtype: null };
    const priceData = priceMap[ticker];
    const current_price = priceData?.price ?? null;
    const cost = pos.shares * pos.avg_cost;
    const value = current_price !== null ? pos.shares * current_price : null;
    const unrealized_pl = value !== null ? value - cost : null;
    const unrealized_pl_pct =
      unrealized_pl !== null && cost > 0 ? (unrealized_pl / cost) * 100 : null;

    // asset_subtype: prefer trade metadata; fall back to findata quote_type if trade has none
    const subtypeFromPrice = priceData?.quote_type as Holding['asset_subtype'] ?? null;
    const asset_subtype = meta.asset_subtype ?? subtypeFromPrice;

    holdings.push({
      ticker,
      market: meta.market,
      currency: meta.currency,
      shares: pos.shares,
      avg_cost: pos.avg_cost,
      current_price,
      value,
      cost,
      unrealized_pl,
      unrealized_pl_pct,
      asset_subtype,
    });
  }

  return holdings;
}

export function computeTotalRealizedPL(trades: Trade[]): number {
  const positions = computePositions(trades);
  let total = 0;
  for (const pos of positions.values()) {
    total += pos.realized_pl;
  }
  return total;
}
