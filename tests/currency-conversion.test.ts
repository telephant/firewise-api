import { convertAmount } from '../src/utils/currency-conversion';

describe('convertAmount', () => {
  // Rate table: 1 USD = N foreign
  // SGD: 1 USD = 1.35 SGD  → SGD rate = 1.35
  // HKD: 1 USD = 7.80 HKD  → HKD rate = 7.80
  // EUR: 1 USD = 0.92 EUR  → EUR rate = 0.92
  const rateMap = new Map<string, number>([
    ['sgd', 1.35],
    ['hkd', 7.80],
    ['eur', 0.92],
  ]);

  describe('same currency', () => {
    it('returns amount unchanged when from === to (usd)', () => {
      const result = convertAmount(100, 'USD', 'USD', rateMap);
      expect(result).toEqual({ converted: 100, rate: 1 });
    });

    it('returns amount unchanged when from === to (sgd)', () => {
      const result = convertAmount(200, 'SGD', 'SGD', rateMap);
      expect(result).toEqual({ converted: 200, rate: 1 });
    });

    it('is case-insensitive for same-currency detection', () => {
      const result = convertAmount(50, 'sgd', 'SGD', rateMap);
      expect(result).toEqual({ converted: 50, rate: 1 });
    });
  });

  describe('foreign → USD', () => {
    it('converts SGD to USD correctly (100 SGD / 1.35 = 74.07 USD)', () => {
      const result = convertAmount(100, 'SGD', 'USD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBeCloseTo(74.07, 1);
    });

    it('converts HKD to USD correctly (780 HKD / 7.80 = 100 USD)', () => {
      const result = convertAmount(780, 'HKD', 'USD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBeCloseTo(100, 2);
    });
  });

  describe('USD → foreign', () => {
    it('converts USD to SGD correctly (100 USD * 1.35 = 135 SGD)', () => {
      const result = convertAmount(100, 'USD', 'SGD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBeCloseTo(135, 2);
    });

    it('converts USD to HKD correctly (100 USD * 7.80 = 780 HKD)', () => {
      const result = convertAmount(100, 'USD', 'HKD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBeCloseTo(780, 2);
    });
  });

  describe('foreign → foreign (via USD)', () => {
    it('converts SGD to HKD (100 SGD → USD → HKD)', () => {
      // 100 SGD / 1.35 = 74.07 USD * 7.80 = 577.78 HKD
      const result = convertAmount(100, 'SGD', 'HKD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBeCloseTo(577.78, 0);
    });
  });

  describe('missing rates', () => {
    it('returns null when fromCurrency rate is missing', () => {
      const result = convertAmount(100, 'JPY', 'USD', rateMap);
      expect(result).toBeNull();
    });

    it('returns null when toCurrency rate is missing', () => {
      const result = convertAmount(100, 'USD', 'JPY', rateMap);
      expect(result).toBeNull();
    });

    it('returns null when both rates are missing', () => {
      const result = convertAmount(100, 'JPY', 'CNY', rateMap);
      expect(result).toBeNull();
    });

    // This is the critical bug test: callers must NOT use native amount as fallback when null is returned
    it('does NOT silently return the original amount — callers must handle null', () => {
      const result = convertAmount(100, 'JPY', 'USD', rateMap);
      // Result is null → caller is responsible for not treating 100 JPY as 100 USD
      expect(result).toBeNull();
      // The correct caller behavior: use 0, not `result?.converted ?? amount`
      const safeValue = result ? result.converted : 0;
      expect(safeValue).toBe(0);
    });
  });

  describe('zero amount', () => {
    it('converts zero correctly', () => {
      const result = convertAmount(0, 'SGD', 'USD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBe(0);
    });
  });

  describe('negative amounts (losses)', () => {
    it('converts negative SGD to USD correctly', () => {
      const result = convertAmount(-135, 'SGD', 'USD', rateMap);
      expect(result).not.toBeNull();
      expect(result!.converted).toBeCloseTo(-100, 1);
    });
  });
});
