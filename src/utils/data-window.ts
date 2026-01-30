/**
 * Data Window Strategy
 *
 * Centralized data quality assessment and annualization logic.
 * Used across all financial statistics: Flow Freedom, Runway, Net Flow, etc.
 *
 * Responsibilities:
 * - Assess data quality based on months available
 * - Provide confidence levels and warnings
 * - Calculate monthly averages and annualized values
 * - Cap data to rolling window (default 12 months)
 *
 * NOT responsible for:
 * - Currency conversion (use currency-conversion.ts)
 * - Data fetching (controllers do this)
 */

// ============ STRATEGY CONSTANTS ============
// Easy to adjust in one place if needed

export const DATA_WINDOW_CONFIG = {
  /**
   * Confidence thresholds based on months of data
   * - 1 month: very_low (single data point, high variance)
   * - 2 months: low (limited, could be outliers)
   * - 3-5 months: medium (starting to be useful)
   * - 6-11 months: good (decent sample, may miss some seasonality)
   * - 12+ months: high (full year, captures seasonality)
   */
  THRESHOLDS: {
    MIN_FOR_LOW: 2,
    MIN_FOR_MEDIUM: 3,
    MIN_FOR_GOOD: 6,
    MIN_FOR_HIGH: 12,
  },

  /** Rolling window cap - only use last N months */
  MAX_WINDOW_MONTHS: 12,

  /** Warning messages */
  WARNINGS: {
    NO_DATA: 'No data available',
    MONTH_1: 'Based on 1 month only - may vary significantly',
    MONTH_2: 'Based on 2 months of data',
    PARTIAL_LESS_6: 'Less than 6 months of data',
    PARTIAL_LESS_12: 'Partial year - may miss seasonal patterns',
  },
} as const;

// ============ TYPES ============

export type ConfidenceLevel = 'very_low' | 'low' | 'medium' | 'good' | 'high';

/**
 * Monthly data point - the standard input format
 * Controllers should convert their data to this format
 */
export interface MonthlyDataPoint {
  /** Month in YYYY-MM format */
  month: string;
  /** Total for this month (already currency-converted if needed) */
  total: number;
}

/**
 * Result of data window calculation
 */
export interface DataWindowResult {
  /** Average per month */
  monthly_average: number;
  /** Annualized value (monthly × 12) */
  annualized: number;
  /** Sum of all values in the window */
  total: number;
  /** Number of months with data (capped at MAX_WINDOW) */
  months_of_data: number;
  /** Confidence level based on data availability */
  confidence: ConfidenceLevel;
  /** Warning message for UI, null if high confidence */
  warning: string | null;
  /** Date range of data used */
  date_range: {
    oldest: string;
    newest: string;
  } | null;
}

/**
 * Data quality metadata - can be embedded in API responses
 */
export interface DataQuality {
  confidence: ConfidenceLevel;
  months_of_data: number;
  warning: string | null;
}

// ============ CORE FUNCTIONS ============

/**
 * Get confidence level based on months of data
 */
export function getConfidence(months: number): ConfidenceLevel {
  const { THRESHOLDS } = DATA_WINDOW_CONFIG;
  if (months < THRESHOLDS.MIN_FOR_LOW) return 'very_low';
  if (months < THRESHOLDS.MIN_FOR_MEDIUM) return 'low';
  if (months < THRESHOLDS.MIN_FOR_GOOD) return 'medium';
  if (months < THRESHOLDS.MIN_FOR_HIGH) return 'good';
  return 'high';
}

/**
 * Get warning message based on months of data
 */
export function getWarning(months: number): string | null {
  const { WARNINGS } = DATA_WINDOW_CONFIG;
  if (months === 0) return WARNINGS.NO_DATA;
  if (months === 1) return WARNINGS.MONTH_1;
  if (months === 2) return WARNINGS.MONTH_2;
  if (months < 6) return WARNINGS.PARTIAL_LESS_6;
  if (months < 12) return WARNINGS.PARTIAL_LESS_12;
  return null;
}

/**
 * Main calculation function - calculates data window statistics
 *
 * @param monthlyData - Array of monthly totals (already currency-converted)
 * @returns DataWindowResult with averages, confidence, and warnings
 *
 * @example
 * const monthlyExpenses = [
 *   { month: '2025-01', total: 4500 },
 *   { month: '2024-12', total: 5200 },
 *   { month: '2024-11', total: 4800 },
 * ];
 * const result = calculateDataWindow(monthlyExpenses);
 * // result.monthly_average = 4833.33
 * // result.annualized = 58000
 * // result.confidence = 'medium'
 */
export function calculateDataWindow(monthlyData: MonthlyDataPoint[]): DataWindowResult {
  // Handle empty data
  if (monthlyData.length === 0) {
    return {
      monthly_average: 0,
      annualized: 0,
      total: 0,
      months_of_data: 0,
      confidence: 'very_low',
      warning: DATA_WINDOW_CONFIG.WARNINGS.NO_DATA,
      date_range: null,
    };
  }

  // Sort by month descending (newest first) and cap at MAX_WINDOW
  const sorted = [...monthlyData].sort((a, b) => b.month.localeCompare(a.month));
  const windowed = sorted.slice(0, DATA_WINDOW_CONFIG.MAX_WINDOW_MONTHS);
  const months = windowed.length;

  // Calculate totals
  const total = windowed.reduce((sum, m) => sum + m.total, 0);
  const monthlyAverage = total / months;

  return {
    monthly_average: round2(monthlyAverage),
    annualized: round2(monthlyAverage * 12),
    total: round2(total),
    months_of_data: months,
    confidence: getConfidence(months),
    warning: getWarning(months),
    date_range: {
      oldest: windowed[windowed.length - 1].month,
      newest: windowed[0].month,
    },
  };
}

// ============ HELPER FUNCTIONS ============

/**
 * Convert a Map<month, total> to MonthlyDataPoint array
 * Useful when you've already grouped data by month
 */
export function mapToMonthlyData(monthMap: Map<string, number>): MonthlyDataPoint[] {
  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Group raw entries by month
 * Use this when you have raw entries with date and amount fields
 *
 * @param entries - Array of objects with date and amount
 * @param getDate - Function to extract date string from entry
 * @param getAmount - Function to extract amount from entry
 *
 * @example
 * const flows = [{ date: '2025-01-15', amount: 100 }, ...];
 * const byMonth = groupEntriesByMonth(flows, f => f.date, f => f.amount);
 */
export function groupEntriesByMonth<T>(
  entries: T[],
  getDate: (entry: T) => string,
  getAmount: (entry: T) => number
): Map<string, number> {
  const monthMap = new Map<string, number>();

  for (const entry of entries) {
    const date = getDate(entry);
    const amount = getAmount(entry);
    const month = date.substring(0, 7); // YYYY-MM

    const current = monthMap.get(month) || 0;
    monthMap.set(month, current + amount);
  }

  return monthMap;
}

/**
 * Convenience: Calculate data window directly from raw entries
 *
 * @example
 * const result = calculateFromEntries(
 *   flows,
 *   f => f.date,
 *   f => f.amount
 * );
 */
export function calculateFromEntries<T>(
  entries: T[],
  getDate: (entry: T) => string,
  getAmount: (entry: T) => number
): DataWindowResult {
  const monthMap = groupEntriesByMonth(entries, getDate, getAmount);
  const monthlyData = mapToMonthlyData(monthMap);
  return calculateDataWindow(monthlyData);
}

/**
 * Round to 2 decimal places
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
