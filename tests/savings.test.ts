import { computeForecast, computeNextPayoutDate } from '../src/controllers/savings.controller';

describe('computeForecast', () => {
  it('monthly: returns correct payout amount', () => {
    const result = computeForecast(12000, 0.03, 'monthly');
    expect(result).toBeCloseTo(30, 2); // 12000 * 0.03 / 12 = 30
  });

  it('quarterly: returns correct payout amount', () => {
    const result = computeForecast(12000, 0.04, 'quarterly');
    expect(result).toBeCloseTo(120, 2); // 12000 * 0.04 / 4 = 120
  });

  it('semi_annual: returns correct payout amount', () => {
    const result = computeForecast(10000, 0.05, 'semi_annual');
    expect(result).toBeCloseTo(250, 2); // 10000 * 0.05 / 2 = 250
  });

  it('annual: returns correct payout amount', () => {
    const result = computeForecast(10000, 0.035, 'annual');
    expect(result).toBeCloseTo(350, 2); // 10000 * 0.035 / 1 = 350
  });
});

describe('computeNextPayoutDate', () => {
  it('monthly: advances by 30 days', () => {
    const result = computeNextPayoutDate('2025-01-01', 'monthly');
    expect(result).toBe('2025-01-31');
  });

  it('quarterly: advances by 91 days', () => {
    const result = computeNextPayoutDate('2025-01-01', 'quarterly');
    expect(result).toBe('2025-04-02');
  });

  it('semi_annual: advances by 182 days', () => {
    const result = computeNextPayoutDate('2025-01-01', 'semi_annual');
    expect(result).toBe('2025-07-02');
  });

  it('annual: advances by 365 days', () => {
    const result = computeNextPayoutDate('2025-01-01', 'annual');
    expect(result).toBe('2026-01-01');
  });
});
