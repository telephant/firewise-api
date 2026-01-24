import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Debt } from '../types';
import { AppError } from '../middleware/error';
import { DataQuality, ConfidenceLevel } from '../utils/data-window';
import { getFinancialStats } from '../utils/financial-stats';

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
  // Currency all values are converted to
  currency: string;
}

/**
 * Get Flow Freedom statistics
 * Calculates passive income vs expenses to determine financial independence progress
 * Uses shared financial stats for income/expense calculations
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

    // Get shared financial stats (cached)
    const financialStats = await getFinancialStats(userId);

    // Calculate date range for pending review check
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    // Fetch debts for payoff calculation and pending review flows
    const [debtsResult, pendingReviewResult] = await Promise.all([
      supabaseAdmin
        .from('debts')
        .select('*')
        .eq('user_id', userId)
        .gt('current_balance', 0),
      // Get flows needing review (for pendingReview stats)
      supabaseAdmin
        .from('flows')
        .select('type, category, from_asset_id, needs_review')
        .eq('user_id', userId)
        .eq('needs_review', true)
        .in('type', ['income', 'expense'])
        .gte('date', formatDate(twelveMonthsAgo)),
    ]);

    const debts = (debtsResult.data || []) as Debt[];
    const pendingFlows = pendingReviewResult.data || [];

    // Calculate pending review stats
    let excludedCount = 0;
    let hasExcludedPassiveIncome = false;
    let hasExcludedExpenses = false;

    pendingFlows.forEach((flow) => {
      excludedCount++;
      if (flow.type === 'income') {
        const isPassive = flow.from_asset_id !== null ||
          ['dividend', 'rental', 'interest'].includes(flow.category || '');
        if (isPassive) {
          hasExcludedPassiveIncome = true;
        }
      } else if (flow.type === 'expense') {
        hasExcludedExpenses = true;
      }
    });

    // Calculate debt payoff year
    let latestDebtPayoffYear: number | null = null;
    debts.forEach((debt) => {
      const monthlyPayment = Number(debt.monthly_payment) || 0;
      if (monthlyPayment > 0 && debt.current_balance > 0 && debt.interest_rate !== undefined) {
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
    });

    // Build debt breakdown from shared stats
    const debtBreakdown: DebtBreakdownItem[] = financialStats.debts.breakdown.map(d => ({
      name: d.name,
      monthlyPayment: d.monthlyPayment,
      type: d.type,
    }));

    // Use values from shared stats
    const annualPassiveIncome = financialStats.passiveIncome.annual;
    const monthlyPassiveIncome = financialStats.passiveIncome.monthly;
    const annualLivingExpenses = financialStats.expenses.living;
    const annualDebtPayments = financialStats.expenses.debtPayments;
    const annualTotalExpenses = financialStats.expenses.total;
    const monthlyTotalExpenses = financialStats.expenses.monthly;

    // Calculate Flow Freedom
    const flowFreedomCurrent = annualTotalExpenses > 0
      ? annualPassiveIncome / annualTotalExpenses
      : 0;

    const flowFreedomAfterDebtsPaid = annualLivingExpenses > 0
      ? annualPassiveIncome / annualLivingExpenses
      : 0;

    // Build passiveIncomeByMonth map from monthly history for time-to-freedom calculation
    const passiveIncomeByMonth = new Map<string, number>();
    financialStats.monthlyHistory.forEach(({ month, income }) => {
      passiveIncomeByMonth.set(month, income);
    });

    // Calculate time to freedom based on historical trend
    const { years, confidence, monthlyGrowthRate, direction } = calculateTimeToFreedom(
      passiveIncomeByMonth,
      annualTotalExpenses,
      financialStats.passiveIncome.dataQuality.months_of_data
    );

    res.json({
      success: true,
      data: {
        passiveIncome: {
          annual: annualPassiveIncome,
          monthly: monthlyPassiveIncome,
          breakdown: financialStats.passiveIncome.breakdown,
          dataQuality: financialStats.passiveIncome.dataQuality,
        },
        expenses: {
          annual: annualTotalExpenses,
          monthly: monthlyTotalExpenses,
          living: annualLivingExpenses,
          debtPayments: annualDebtPayments,
          debtBreakdown,
          dataQuality: financialStats.expenses.dataQuality,
        },
        flowFreedom: {
          current: Math.round(flowFreedomCurrent * 1000) / 1000,
          afterDebtsPaid: Math.round(flowFreedomAfterDebtsPaid * 1000) / 1000,
          debtPayoffYear: latestDebtPayoffYear,
        },
        timeToFreedom: {
          years,
          confidence,
          dataMonths: financialStats.passiveIncome.dataQuality.months_of_data,
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
        currency: financialStats.currency,
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
