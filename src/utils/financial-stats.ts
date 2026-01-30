/**
 * Shared financial stats calculation utility
 * Used by runway, flow-freedom, and other endpoints
 */

import { supabaseAdmin } from '../config/supabase';
import { Debt } from '../types';
import { getUserPreferences, sumWithConversion, MoneyEntry, getExchangeRates, convertAmount } from './currency-conversion';
import { calculateDataWindow, mapToMonthlyData, DataQuality } from './data-window';
import { ViewContext, applyOwnershipFilter } from './family-context';

// Passive income categories
const PASSIVE_INCOME_CATEGORIES = ['dividend', 'rental', 'interest'];

// Debt breakdown item
interface DebtBreakdownItem {
  id: string;
  name: string;
  type: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
}

// Financial stats response
export interface FinancialStats {
  passiveIncome: {
    monthly: number;
    annual: number;
    breakdown: {
      dividends: number;
      rental: number;
      interest: number;
      other: number;
    };
    dataQuality: DataQuality;
  };
  expenses: {
    living: number;      // Annual living expenses (without debt)
    debtPayments: number; // Annual debt payments
    total: number;        // Annual total (living + debt)
    monthly: number;      // Monthly total
    dataQuality: DataQuality;
  };
  debts: {
    total: number;        // Total debt balance
    monthlyPayments: number; // Total monthly debt payments
    breakdown: DebtBreakdownItem[];
  };
  netWorth: number;
  currency: string;
  // Monthly history for LLM context
  monthlyHistory: Array<{
    month: string;
    income: number;
    expenses: number;
  }>;
}

// Cache for financial stats (1 minute TTL per user/family)
const statsCache = new Map<string, { data: FinancialStats; timestamp: number }>();
const STATS_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Build cache key based on view context
 * Uses belongId which is already the canonical key (userId for personal, familyId for family)
 */
function buildCacheKey(viewContext: ViewContext): string {
  return `belong:${viewContext.belongId}`
}

/**
 * Get financial stats for a user/family (with caching)
 */
export async function getFinancialStats(viewContext: ViewContext, forceRefresh = false): Promise<FinancialStats> {
  // Check cache first
  const cacheKey = buildCacheKey(viewContext);
  const cached = statsCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
    return cached.data;
  }

  // Calculate fresh stats
  const stats = await calculateFinancialStats(viewContext);

  // Cache the result
  statsCache.set(cacheKey, { data: stats, timestamp: Date.now() });

  return stats;
}

/**
 * Clear cached stats for a user/family (call when data changes)
 */
export function clearFinancialStatsCache(viewContext: ViewContext): void {
  const cacheKey = buildCacheKey(viewContext);
  statsCache.delete(cacheKey);
}

/**
 * Calculate financial stats for a user/family
 */
async function calculateFinancialStats(viewContext: ViewContext): Promise<FinancialStats> {
  const { userId } = viewContext;

  // Get user preferences for currency
  const userPrefs = await getUserPreferences(userId);
  const preferredCurrency = userPrefs?.preferred_currency || 'USD';

  // Calculate date ranges
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  // Build base queries with simple belong_id ownership filter
  const flowsQuery = applyOwnershipFilter(
    supabaseAdmin.from('flows').select('type, amount, currency, date, category, from_asset_id, needs_review'),
    viewContext
  )
    .in('type', ['income', 'expense'])
    .gte('date', formatDate(twelveMonthsAgo))
    .neq('category', 'adjustment')
    .eq('needs_review', false); // Only include reviewed flows

  const debtsQuery = applyOwnershipFilter(
    supabaseAdmin.from('debts').select('*'),
    viewContext
  ).gt('current_balance', 0);

  // Fetch all data in parallel with ownership filter
  const [flowsResult, linkedLedgersResult, debtsResult] = await Promise.all([
    flowsQuery,
    applyOwnershipFilter(
      supabaseAdmin.from('fire_linked_ledgers').select('ledger_id'),
      viewContext
    ),
    debtsQuery,
  ]);

  if (flowsResult.error) throw new Error('Failed to fetch flows');

  const flows = flowsResult.data || [];
  const debts = (debtsResult.data || []) as Debt[];

  // Collect entries by category
  const passiveIncomeEntries: MoneyEntry[] = [];
  const dividendEntries: MoneyEntry[] = [];
  const rentalEntries: MoneyEntry[] = [];
  const interestEntries: MoneyEntry[] = [];
  const otherPassiveEntries: MoneyEntry[] = [];
  const expenseEntries: MoneyEntry[] = [];

  // Track by month
  const passiveIncomeByMonth = new Map<string, MoneyEntry[]>();
  const expensesByMonth = new Map<string, MoneyEntry[]>();

  // Process flows
  flows.forEach((flow) => {
    const monthKey = flow.date.substring(0, 7);

    if (flow.type === 'income') {
      const isPassive = flow.from_asset_id !== null ||
        PASSIVE_INCOME_CATEGORIES.includes(flow.category || '');

      if (isPassive) {
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

  // Fetch linked ledger expenses
  const linkedLedgerIds = (linkedLedgersResult.data || []).map((l) => l.ledger_id);
  if (linkedLedgerIds.length > 0) {
    const { data: linkedExpenses } = await supabaseAdmin
      .from('expenses')
      .select(`amount, date, currency_id, ledger_currencies!currency_id(code)`)
      .in('ledger_id', linkedLedgerIds)
      .gte('date', formatDate(twelveMonthsAgo));

    (linkedExpenses || []).forEach((exp) => {
      const currency = exp.ledger_currencies as unknown as { code: string } | null;
      const entry: MoneyEntry = {
        amount: Number(exp.amount),
        currency: currency?.code || 'USD',
      };

      expenseEntries.push(entry);

      const monthKey = exp.date.substring(0, 7);
      const monthEntries = expensesByMonth.get(monthKey) || [];
      monthEntries.push(entry);
      expensesByMonth.set(monthKey, monthEntries);
    });
  }

  // Process debts
  const debtPaymentEntries: MoneyEntry[] = [];
  const debtBreakdown: DebtBreakdownItem[] = [];
  let totalDebtBalance = 0;

  for (const debt of debts) {
    const monthlyPayment = Number(debt.monthly_payment) || 0;
    const balance = Number(debt.current_balance) || 0;

    // Convert balance to preferred currency
    const currencies = new Set([preferredCurrency.toLowerCase(), (debt.currency || 'USD').toLowerCase()]);
    const rateMap = await getExchangeRates(Array.from(currencies));
    const balanceConv = convertAmount(balance, debt.currency || 'USD', preferredCurrency, rateMap);
    const paymentConv = convertAmount(monthlyPayment, debt.currency || 'USD', preferredCurrency, rateMap);

    const convertedBalance = balanceConv ? balanceConv.converted : balance;
    const convertedPayment = paymentConv ? paymentConv.converted : monthlyPayment;

    totalDebtBalance += convertedBalance;

    if (monthlyPayment > 0) {
      debtPaymentEntries.push({
        amount: monthlyPayment * 12,
        currency: debt.currency || 'USD',
      });

      debtBreakdown.push({
        id: debt.id,
        name: debt.name,
        type: debt.debt_type,
        balance: Math.round(convertedBalance * 100) / 100,
        interestRate: Number(debt.interest_rate) || 0,
        monthlyPayment: Math.round(convertedPayment * 100) / 100,
      });
    }
  }

  // Convert and sum all entries
  const [
    totalDividends,
    totalRental,
    totalInterest,
    totalOtherPassive,
    annualDebtPayments,
  ] = await Promise.all([
    sumWithConversion(dividendEntries, preferredCurrency),
    sumWithConversion(rentalEntries, preferredCurrency),
    sumWithConversion(interestEntries, preferredCurrency),
    sumWithConversion(otherPassiveEntries, preferredCurrency),
    sumWithConversion(debtPaymentEntries, preferredCurrency),
  ]);

  // Convert monthly Maps to currency-converted totals
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

  // Use data window for consistent calculation
  const incomeWindow = calculateDataWindow(mapToMonthlyData(passiveIncomeMonthlyConverted));
  const expenseWindow = calculateDataWindow(mapToMonthlyData(expensesMonthlyConverted));

  const annualPassiveIncome = incomeWindow.annualized;
  const monthlyPassiveIncome = incomeWindow.monthly_average;
  const annualLivingExpenses = expenseWindow.annualized;
  const monthlyLivingExpenses = expenseWindow.monthly_average;
  const annualTotalExpenses = annualLivingExpenses + annualDebtPayments;
  const monthlyTotalExpenses = monthlyLivingExpenses + annualDebtPayments / 12;

  // Build monthly history
  const allMonths = new Set([
    ...passiveIncomeMonthlyConverted.keys(),
    ...expensesMonthlyConverted.keys(),
  ]);
  const monthlyHistory = Array.from(allMonths)
    .sort()
    .slice(-12) // Last 12 months
    .map(month => ({
      month,
      income: Math.round((passiveIncomeMonthlyConverted.get(month) || 0) * 100) / 100,
      expenses: Math.round((expensesMonthlyConverted.get(month) || 0) * 100) / 100,
    }));

  return {
    passiveIncome: {
      monthly: Math.round(monthlyPassiveIncome * 100) / 100,
      annual: Math.round(annualPassiveIncome * 100) / 100,
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
      living: Math.round(annualLivingExpenses * 100) / 100,
      debtPayments: Math.round(annualDebtPayments * 100) / 100,
      total: Math.round(annualTotalExpenses * 100) / 100,
      monthly: Math.round(monthlyTotalExpenses * 100) / 100,
      dataQuality: {
        confidence: expenseWindow.confidence,
        months_of_data: expenseWindow.months_of_data,
        warning: expenseWindow.warning,
      },
    },
    debts: {
      total: Math.round(totalDebtBalance * 100) / 100,
      monthlyPayments: Math.round((annualDebtPayments / 12) * 100) / 100,
      breakdown: debtBreakdown,
    },
    netWorth: 0, // Will be set by caller with asset data
    currency: preferredCurrency,
    monthlyHistory,
  };
}
