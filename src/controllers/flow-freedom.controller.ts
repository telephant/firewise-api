import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Debt } from '../types';
import { AppError } from '../middleware/error';
import { getUserPreferences, sumWithConversion, MoneyEntry } from '../utils/currency-conversion';
import { calculateDataWindow, mapToMonthlyData, DataQuality, ConfidenceLevel } from '../utils/data-window';

// Passive income categories
const PASSIVE_INCOME_CATEGORIES = ['dividend', 'rental', 'interest'];

// Debt item for breakdown
interface DebtBreakdownItem {
  name: string;
  monthlyPayment: number;
  type: string;
}

// Response type for Flow Freedom
interface FlowFreedomResponse {
  passiveIncome: {
    annual: number;
    monthly: number;
    breakdown: {
      dividends: number;
      rental: number;
      interest: number;
      other: number;
    };
    dataQuality: DataQuality;
  };
  expenses: {
    annual: number;
    monthly: number;
    living: number; // Without debt payments
    debtPayments: number; // Annual debt payments
    debtBreakdown: DebtBreakdownItem[]; // Individual debts
    dataQuality: DataQuality;
  };
  flowFreedom: {
    current: number; // 0.67 = 67%
    afterDebtsPaid: number; // Flow Freedom after all debts paid
    debtPayoffYear: number | null; // Year when last debt is paid off
  };
  timeToFreedom: {
    years: number | null;
    confidence: ConfidenceLevel;
    dataMonths: number;
    trend: {
      monthlyGrowthRate: number | null;
      direction: 'up' | 'down' | 'stable';
    };
  };
  // Flows that need review (may affect accuracy)
  pendingReview: {
    count: number;
    hasPassiveIncome: boolean; // Any unreviewed passive income flows
    hasExpenses: boolean; // Any unreviewed expense flows
  };
}

/**
 * Get Flow Freedom statistics
 * Calculates passive income vs expenses to determine financial independence progress
 */
export const getFlowFreedom = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowFreedomResponse>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get user preferences for currency conversion
    // For Flow Freedom, we ALWAYS convert to preferred currency since we're summing amounts
    const userPrefs = await getUserPreferences(userId);
    const preferredCurrency = userPrefs?.preferred_currency || 'USD';

    // Calculate date ranges
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    // Fetch all data in parallel
    const [flowsResult, linkedLedgersResult, debtsResult] = await Promise.all([
      // Get flows for the last 12 months
      supabaseAdmin
        .from('flows')
        .select('type, amount, currency, date, category, from_asset_id, needs_review')
        .eq('user_id', userId)
        .in('type', ['income', 'expense'])
        .gte('date', formatDate(twelveMonthsAgo))
        .neq('category', 'adjustment'),
      // Get linked ledgers
      supabaseAdmin
        .from('fire_linked_ledgers')
        .select('ledger_id')
        .eq('user_id', userId),
      // Get active debts with monthly payments
      supabaseAdmin
        .from('debts')
        .select('*')
        .eq('user_id', userId)
        .gt('current_balance', 0),
    ]);

    if (flowsResult.error) {
      throw new AppError('Failed to fetch flows', 500);
    }

    const flows = flowsResult.data || [];
    const debts = (debtsResult.data || []) as Debt[];

    // Collect money entries for batch conversion
    const passiveIncomeEntries: MoneyEntry[] = [];
    const dividendEntries: MoneyEntry[] = [];
    const rentalEntries: MoneyEntry[] = [];
    const interestEntries: MoneyEntry[] = [];
    const otherPassiveEntries: MoneyEntry[] = [];
    const expenseEntries: MoneyEntry[] = [];

    // Track by month (using raw amounts, will be converted later)
    const passiveIncomeByMonth = new Map<string, MoneyEntry[]>();
    const expensesByMonth = new Map<string, MoneyEntry[]>();

    // Track excluded flows (under review)
    let excludedCount = 0;
    let hasExcludedPassiveIncome = false;
    let hasExcludedExpenses = false;

    // Process flows - collect entries (EXCLUDE flows under review)
    flows.forEach((flow) => {
      const monthKey = flow.date.substring(0, 7); // YYYY-MM

      if (flow.type === 'income') {
        // Check if it's passive income
        const isPassive = flow.from_asset_id !== null ||
          PASSIVE_INCOME_CATEGORIES.includes(flow.category || '');

        if (isPassive) {
          // Skip flows under review
          if (flow.needs_review) {
            excludedCount++;
            hasExcludedPassiveIncome = true;
            return; // Skip this flow
          }

          const entry: MoneyEntry = {
            amount: Number(flow.amount),
            currency: flow.currency || 'USD',
          };

          passiveIncomeEntries.push(entry);

          // Track by month
          const monthEntries = passiveIncomeByMonth.get(monthKey) || [];
          monthEntries.push(entry);
          passiveIncomeByMonth.set(monthKey, monthEntries);

          // Categorize
          if (flow.category === 'dividend') {
            dividendEntries.push(entry);
          } else if (flow.category === 'rental') {
            rentalEntries.push(entry);
          } else if (flow.category === 'interest') {
            interestEntries.push(entry);
          } else {
            otherPassiveEntries.push(entry);
          }
        }
      } else if (flow.type === 'expense') {
        // Skip flows under review
        if (flow.needs_review) {
          excludedCount++;
          hasExcludedExpenses = true;
          return; // Skip this flow
        }

        const entry: MoneyEntry = {
          amount: Number(flow.amount),
          currency: flow.currency || 'USD',
        };

        expenseEntries.push(entry);

        // Track by month
        const monthEntries = expensesByMonth.get(monthKey) || [];
        monthEntries.push(entry);
        expensesByMonth.set(monthKey, monthEntries);
      }
    });

    // Fetch linked ledger expenses and add to expense entries
    const linkedLedgerIds = (linkedLedgersResult.data || []).map((l) => l.ledger_id);
    if (linkedLedgerIds.length > 0) {
      const { data: linkedExpenses } = await supabaseAdmin
        .from('expenses')
        .select(`
          amount,
          date,
          currency_id,
          ledger_currencies!currency_id(code)
        `)
        .in('ledger_id', linkedLedgerIds)
        .gte('date', formatDate(twelveMonthsAgo));

      (linkedExpenses || []).forEach((exp) => {
        const currency = exp.ledger_currencies as unknown as { code: string } | null;
        const entry: MoneyEntry = {
          amount: Number(exp.amount),
          currency: currency?.code || 'USD',
        };

        expenseEntries.push(entry);

        // Track by month
        const monthKey = exp.date.substring(0, 7);
        const monthEntries = expensesByMonth.get(monthKey) || [];
        monthEntries.push(entry);
        expensesByMonth.set(monthKey, monthEntries);
      });
    }

    // Collect debt payment entries and breakdown info
    const debtPaymentEntries: MoneyEntry[] = [];
    const debtBreakdownRaw: { name: string; entry: MoneyEntry; type: string }[] = [];
    let latestDebtPayoffYear: number | null = null;

    debts.forEach((debt) => {
      const monthlyPayment = Number(debt.monthly_payment) || 0;
      if (monthlyPayment > 0) {
        const entry: MoneyEntry = {
          amount: monthlyPayment,
          currency: debt.currency || 'USD',
        };

        // Add annual debt payment as entry
        debtPaymentEntries.push({
          amount: monthlyPayment * 12,
          currency: debt.currency || 'USD',
        });

        // Collect for breakdown
        debtBreakdownRaw.push({
          name: debt.name,
          entry,
          type: debt.debt_type,
        });

        // Calculate payoff date
        if (debt.current_balance > 0 && debt.interest_rate !== undefined) {
          const monthsRemaining = calculateMonthsToPayoff(
            Number(debt.current_balance),
            Number(debt.interest_rate),
            monthlyPayment
          );
          const payoffYear = now.getFullYear() + Math.ceil(monthsRemaining / 12);
          if (latestDebtPayoffYear === null || payoffYear > latestDebtPayoffYear) {
            latestDebtPayoffYear = payoffYear;
          }
        }
      }
    });

    // Convert and sum all entries using the utility
    const [
      totalPassiveIncome,
      totalDividends,
      totalRental,
      totalInterest,
      totalOtherPassive,
      totalExpenses,
      annualDebtPayments,
    ] = await Promise.all([
      sumWithConversion(passiveIncomeEntries, preferredCurrency),
      sumWithConversion(dividendEntries, preferredCurrency),
      sumWithConversion(rentalEntries, preferredCurrency),
      sumWithConversion(interestEntries, preferredCurrency),
      sumWithConversion(otherPassiveEntries, preferredCurrency),
      sumWithConversion(expenseEntries, preferredCurrency),
      sumWithConversion(debtPaymentEntries, preferredCurrency),
    ]);

    // Convert debt breakdown entries to preferred currency
    const debtBreakdown: DebtBreakdownItem[] = await Promise.all(
      debtBreakdownRaw.map(async (item) => {
        const converted = await sumWithConversion([item.entry], preferredCurrency);
        return {
          name: item.name,
          monthlyPayment: Math.round(converted * 100) / 100,
          type: item.type,
        };
      })
    );

    // Convert monthly Maps to currency-converted totals for data window calculation
    const passiveIncomeMonthlyConverted = new Map<string, number>();
    for (const [month, entries] of passiveIncomeByMonth) {
      const converted = await sumWithConversion(entries, preferredCurrency);
      passiveIncomeMonthlyConverted.set(month, converted);
    }

    const expensesMonthlyConverted = new Map<string, number>();
    for (const [month, entries] of expensesByMonth) {
      const converted = await sumWithConversion(entries, preferredCurrency);
      expensesMonthlyConverted.set(month, converted);
    }

    // Use data window utility for consistent calculation and confidence
    const incomeWindow = calculateDataWindow(mapToMonthlyData(passiveIncomeMonthlyConverted));
    const expenseWindow = calculateDataWindow(mapToMonthlyData(expensesMonthlyConverted));

    const annualPassiveIncome = incomeWindow.annualized;
    const monthlyPassiveIncome = incomeWindow.monthly_average;
    const annualLivingExpenses = expenseWindow.annualized;
    const monthlyLivingExpenses = expenseWindow.monthly_average;
    const annualTotalExpenses = annualLivingExpenses + annualDebtPayments;

    // Calculate Flow Freedom
    const flowFreedomCurrent = annualTotalExpenses > 0
      ? annualPassiveIncome / annualTotalExpenses
      : 0;

    const flowFreedomAfterDebtsPaid = annualLivingExpenses > 0
      ? annualPassiveIncome / annualLivingExpenses
      : 0;

    // Calculate time to freedom based on historical trend (reuse converted Map)
    const { years, confidence, monthlyGrowthRate, direction } = calculateTimeToFreedom(
      passiveIncomeMonthlyConverted,
      annualTotalExpenses,
      incomeWindow.months_of_data
    );

    res.json({
      success: true,
      data: {
        passiveIncome: {
          annual: Math.round(annualPassiveIncome * 100) / 100,
          monthly: Math.round(monthlyPassiveIncome * 100) / 100,
          // Breakdown as monthly averages (divide totals by months of data)
          breakdown: {
            dividends: Math.round((totalDividends / Math.max(incomeWindow.months_of_data, 1)) * 100) / 100,
            rental: Math.round((totalRental / Math.max(incomeWindow.months_of_data, 1)) * 100) / 100,
            interest: Math.round((totalInterest / Math.max(incomeWindow.months_of_data, 1)) * 100) / 100,
            other: Math.round((totalOtherPassive / Math.max(incomeWindow.months_of_data, 1)) * 100) / 100,
          },
          dataQuality: {
            confidence: incomeWindow.confidence,
            months_of_data: incomeWindow.months_of_data,
            warning: incomeWindow.warning,
          },
        },
        expenses: {
          annual: Math.round(annualTotalExpenses * 100) / 100,
          monthly: Math.round((monthlyLivingExpenses + annualDebtPayments / 12) * 100) / 100,
          living: Math.round(annualLivingExpenses * 100) / 100,
          debtPayments: Math.round(annualDebtPayments * 100) / 100,
          debtBreakdown,
          dataQuality: {
            confidence: expenseWindow.confidence,
            months_of_data: expenseWindow.months_of_data,
            warning: expenseWindow.warning,
          },
        },
        flowFreedom: {
          current: Math.round(flowFreedomCurrent * 1000) / 1000,
          afterDebtsPaid: Math.round(flowFreedomAfterDebtsPaid * 1000) / 1000,
          debtPayoffYear: latestDebtPayoffYear,
        },
        timeToFreedom: {
          years,
          confidence,
          dataMonths: incomeWindow.months_of_data,
          trend: {
            monthlyGrowthRate,
            direction,
          },
        },
        pendingReview: {
          count: excludedCount,
          hasPassiveIncome: hasExcludedPassiveIncome,
          hasExpenses: hasExcludedExpenses,
        },
        // Currency all values are converted to
        currency: preferredCurrency,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getFlowFreedom:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch flow freedom stats' });
  }
};

/**
 * Calculate months to pay off a debt using standard amortization
 */
function calculateMonthsToPayoff(
  balance: number,
  annualRate: number,
  monthlyPayment: number
): number {
  if (monthlyPayment <= 0 || balance <= 0) return 0;

  const monthlyRate = annualRate / 12;

  // If no interest, simple division
  if (monthlyRate <= 0) {
    return Math.ceil(balance / monthlyPayment);
  }

  // Standard amortization formula
  // n = -log(1 - (r * P) / M) / log(1 + r)
  // where P = principal, r = monthly rate, M = monthly payment
  const interestPortion = monthlyRate * balance;

  // If payment doesn't cover interest, debt will never be paid off
  if (monthlyPayment <= interestPortion) {
    return 999; // Very long time
  }

  const n = -Math.log(1 - (monthlyRate * balance) / monthlyPayment) / Math.log(1 + monthlyRate);
  return Math.ceil(n);
}

/**
 * Calculate time to Flow Freedom based on historical trend
 * Requires at least 6 months of data to account for quarterly dividends
 */
function calculateTimeToFreedom(
  passiveIncomeByMonth: Map<string, number>,
  targetAnnualExpenses: number,
  dataMonths: number
): {
  years: number | null;
  confidence: ConfidenceLevel;
  monthlyGrowthRate: number | null;
  direction: 'up' | 'down' | 'stable';
} {
  // Need at least 6 months of data to account for quarterly dividends
  if (dataMonths < 6) {
    return {
      years: null,
      confidence: dataMonths < 3 ? 'very_low' : 'low',
      monthlyGrowthRate: null,
      direction: 'stable',
    };
  }

  // Sort months and get values
  const sortedMonths = Array.from(passiveIncomeByMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Calculate average monthly growth rate
  let totalGrowthRate = 0;
  let growthCount = 0;

  for (let i = 1; i < sortedMonths.length; i++) {
    const prevValue = sortedMonths[i - 1][1];
    const currValue = sortedMonths[i][1];

    if (prevValue > 0) {
      const monthlyGrowth = (currValue - prevValue) / prevValue;
      totalGrowthRate += monthlyGrowth;
      growthCount++;
    }
  }

  const avgMonthlyGrowthRate = growthCount > 0 ? totalGrowthRate / growthCount : 0;

  // Determine direction
  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (avgMonthlyGrowthRate > 0.01) direction = 'up';
  else if (avgMonthlyGrowthRate < -0.01) direction = 'down';

  // Calculate current annual passive income (latest 12 months)
  const totalPassiveIncome = Array.from(passiveIncomeByMonth.values())
    .reduce((sum, val) => sum + val, 0);
  const annualizationFactor = 12 / Math.min(dataMonths, 12);
  const currentAnnualPassive = totalPassiveIncome * annualizationFactor;

  // If already at or above target, years = 0
  if (currentAnnualPassive >= targetAnnualExpenses) {
    return {
      years: 0,
      confidence: dataMonths >= 12 ? 'high' : dataMonths >= 6 ? 'medium' : 'low',
      monthlyGrowthRate: Math.round(avgMonthlyGrowthRate * 1000) / 1000,
      direction,
    };
  }

  // If no growth or negative growth, can't project
  if (avgMonthlyGrowthRate <= 0) {
    return {
      years: null,
      confidence: 'low',
      monthlyGrowthRate: Math.round(avgMonthlyGrowthRate * 1000) / 1000,
      direction,
    };
  }

  // Project time to reach target
  // Using compound growth: FV = PV * (1 + r)^n
  // Solve for n: n = log(FV/PV) / log(1 + r)
  const annualGrowthRate = Math.pow(1 + avgMonthlyGrowthRate, 12) - 1;
  const yearsToTarget = Math.log(targetAnnualExpenses / currentAnnualPassive) / Math.log(1 + annualGrowthRate);

  // Confidence based on data available (using data-window thresholds)
  let confidence: ConfidenceLevel = 'medium';
  if (dataMonths >= 12) confidence = 'high';
  else if (dataMonths >= 6) confidence = 'good';

  return {
    years: Math.round(yearsToTarget * 10) / 10,
    confidence,
    monthlyGrowthRate: Math.round(avgMonthlyGrowthRate * 1000) / 1000,
    direction,
  };
}
