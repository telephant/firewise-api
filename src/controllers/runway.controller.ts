import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, Debt } from '../types';
import { AppError } from '../middleware/error';
import { getUserPreferences, sumWithConversion, MoneyEntry, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { calculateDataWindow, mapToMonthlyData, DataQuality } from '../utils/data-window';

// Agent service URL (Railway internal network)
const RUNWAY_AGENT_URL = process.env.RUNWAY_AGENT_URL || 'http://localhost:8000';

// Passive income categories
const PASSIVE_INCOME_CATEGORIES = ['dividend', 'rental', 'interest'];

// Types matching agent service schemas
interface GrowthRates {
  '5y': number | null;
  '10y': number | null;
}

interface AgentAsset {
  id: string;
  name: string;
  type: string;
  ticker: string | null;
  balance: number;
  currency: string;
  growth_rates: GrowthRates | null;
}

interface AgentDebt {
  id: string;
  name: string;
  debt_type: string;
  current_balance: number;
  interest_rate: number;
  monthly_payment: number;
}

// Compressed monthly stats for LLM (instead of raw flows)
interface MonthlyStats {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
}

interface AgentRequest {
  assets: AgentAsset[];
  debts: AgentDebt[];
  // Aggregated values
  monthly_passive_income: number;
  monthly_expenses: number;
  monthly_gap: number;
  annual_passive_income: number;
  annual_expenses: number;
  annual_gap: number;
  // Monthly breakdown (compressed - just totals per month)
  monthly_history: MonthlyStats[];
  // Net worth
  net_worth: number;
  currency: string;
  timezone: string | null;
  data_quality: {
    income: DataQuality;
    expenses: DataQuality;
  };
}

// Response from agent (passthrough)
interface AgentProjection {
  assumptions: {
    inflation_rate: number;
    growth_rates: Record<string, number>;
    reasoning: string;
  };
  strategy: {
    withdrawal_order: string[];
    keep_assets: string[];
    reasoning: string;
  };
  projection: Array<{
    year: number;
    net_worth: number;
    assets: number;
    debts: number;
    expenses: number;
    passive_income: number;
    gap: number;
    notes: string | null;
  }>;
  milestones: Array<{
    year: number;
    event: string;
    impact: string;
  }>;
  suggestions: string[];
  runway_years: number;
  runway_status: 'infinite' | 'finite' | 'critical';
}

// Full response including summary stats for frontend
interface RunwayResponse {
  // Current financial summary (for display)
  summary: {
    net_worth: number;
    // Monthly values (primary display)
    monthly: {
      passive_income: number;
      expenses: number;
      gap: number; // expenses - income
    };
    // Annual values
    annual: {
      passive_income: number;
      expenses: number;
      gap: number;
    };
    currency: string;
    data_quality: {
      income: DataQuality;
      expenses: DataQuality;
    };
  };
  // AI projection
  projection: AgentProjection;
}

/**
 * Get Runway Projection
 * Collects financial data and sends to AI agent for projection
 *
 * Query params:
 * - timezone: User's timezone for region-specific inflation (e.g., "Asia/Dubai")
 */
export const getRunway = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<RunwayResponse>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get timezone from query param (sent by frontend)
    const timezone = (req.query.timezone as string) || null;

    // Get user preferences for currency
    const userPrefs = await getUserPreferences(userId);
    const preferredCurrency = userPrefs?.preferred_currency || 'USD';

    // Collect all data
    const agentRequest = await collectFinancialData(userId, preferredCurrency, timezone);

    // Call agent service
    const agentProjection = await callAgentService(agentRequest);

    // Build response with summary + projection
    const response: RunwayResponse = {
      summary: {
        net_worth: agentRequest.net_worth,
        monthly: {
          passive_income: agentRequest.monthly_passive_income,
          expenses: agentRequest.monthly_expenses,
          gap: agentRequest.monthly_gap,
        },
        annual: {
          passive_income: agentRequest.annual_passive_income,
          expenses: agentRequest.annual_expenses,
          gap: agentRequest.annual_gap,
        },
        currency: agentRequest.currency,
        data_quality: agentRequest.data_quality,
      },
      projection: agentProjection,
    };

    res.json({
      success: true,
      data: response,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getRunway:', err);
    res.status(500).json({ success: false, error: 'Failed to calculate runway projection' });
  }
};

/**
 * Collect all financial data for the agent
 */
async function collectFinancialData(userId: string, preferredCurrency: string, timezone: string | null): Promise<AgentRequest> {
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  // Fetch all data in parallel
  const [assetsResult, debtsResult, flowsResult, linkedLedgersResult] = await Promise.all([
    supabaseAdmin.from('assets').select('*').eq('user_id', userId),
    supabaseAdmin.from('debts').select('*').eq('user_id', userId).gt('current_balance', 0),
    supabaseAdmin
      .from('flows')
      .select('type, amount, currency, date, category, from_asset_id, needs_review')
      .eq('user_id', userId)
      .in('type', ['income', 'expense'])
      .gte('date', formatDate(twelveMonthsAgo))
      .neq('category', 'adjustment')
      .eq('needs_review', false),
    supabaseAdmin.from('fire_linked_ledgers').select('ledger_id').eq('user_id', userId),
  ]);

  if (assetsResult.error) throw new AppError('Failed to fetch assets', 500);
  if (debtsResult.error) throw new AppError('Failed to fetch debts', 500);
  if (flowsResult.error) throw new AppError('Failed to fetch flows', 500);

  const assets = (assetsResult.data || []) as Asset[];
  const debts = (debtsResult.data || []) as Debt[];
  const flows = flowsResult.data || [];

  // Get exchange rates for conversion
  const allCurrencies = new Set<string>([preferredCurrency.toLowerCase()]);
  assets.forEach(a => allCurrencies.add(a.currency.toLowerCase()));
  debts.forEach(d => allCurrencies.add(d.currency.toLowerCase()));
  flows.forEach(f => f.currency && allCurrencies.add(f.currency.toLowerCase()));
  const rateMap = await getExchangeRates(Array.from(allCurrencies));

  // Convert assets to preferred currency
  const agentAssets: AgentAsset[] = assets.map(asset => {
    const conversion = convertAmount(Number(asset.balance), asset.currency, preferredCurrency, rateMap);
    // Get growth_rates from dedicated column (extract only 5y and 10y)
    const growthRates: GrowthRates | null = asset.growth_rates ? {
      '5y': asset.growth_rates['5y'] ?? null,
      '10y': asset.growth_rates['10y'] ?? null,
    } : null;

    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      ticker: asset.ticker,
      balance: conversion ? Math.round(conversion.converted * 100) / 100 : Number(asset.balance),
      currency: preferredCurrency,
      growth_rates: growthRates,
    };
  });

  // Convert debts to preferred currency
  const agentDebts: AgentDebt[] = debts.map(debt => {
    const balanceConv = convertAmount(Number(debt.current_balance), debt.currency, preferredCurrency, rateMap);
    const paymentConv = convertAmount(Number(debt.monthly_payment || 0), debt.currency, preferredCurrency, rateMap);
    return {
      id: debt.id,
      name: debt.name,
      debt_type: debt.debt_type,
      current_balance: balanceConv ? Math.round(balanceConv.converted * 100) / 100 : Number(debt.current_balance),
      interest_rate: Number(debt.interest_rate) || 0,
      monthly_payment: paymentConv ? Math.round(paymentConv.converted * 100) / 100 : Number(debt.monthly_payment || 0),
    };
  });

  // Calculate passive income and expenses
  const passiveIncomeEntries: MoneyEntry[] = [];
  const expenseEntries: MoneyEntry[] = [];
  const passiveIncomeByMonth = new Map<string, MoneyEntry[]>();
  const expensesByMonth = new Map<string, MoneyEntry[]>();

  flows.forEach(flow => {
    const monthKey = flow.date.substring(0, 7);

    if (flow.type === 'income') {
      const isPassive = flow.from_asset_id !== null || PASSIVE_INCOME_CATEGORIES.includes(flow.category || '');
      if (isPassive) {
        const entry: MoneyEntry = { amount: Number(flow.amount), currency: flow.currency || 'USD' };
        passiveIncomeEntries.push(entry);
        const monthEntries = passiveIncomeByMonth.get(monthKey) || [];
        monthEntries.push(entry);
        passiveIncomeByMonth.set(monthKey, monthEntries);
      }
    } else if (flow.type === 'expense') {
      const entry: MoneyEntry = { amount: Number(flow.amount), currency: flow.currency || 'USD' };
      expenseEntries.push(entry);
      const monthEntries = expensesByMonth.get(monthKey) || [];
      monthEntries.push(entry);
      expensesByMonth.set(monthKey, monthEntries);
    }
  });

  // Fetch linked ledger expenses
  const linkedLedgerIds = (linkedLedgersResult.data || []).map(l => l.ledger_id);
  if (linkedLedgerIds.length > 0) {
    const { data: linkedExpenses } = await supabaseAdmin
      .from('expenses')
      .select(`amount, date, currency_id, ledger_currencies!currency_id(code)`)
      .in('ledger_id', linkedLedgerIds)
      .gte('date', formatDate(twelveMonthsAgo));

    (linkedExpenses || []).forEach(exp => {
      const currency = exp.ledger_currencies as unknown as { code: string } | null;
      const entry: MoneyEntry = { amount: Number(exp.amount), currency: currency?.code || 'USD' };
      expenseEntries.push(entry);
      const monthKey = exp.date.substring(0, 7);
      const monthEntries = expensesByMonth.get(monthKey) || [];
      monthEntries.push(entry);
      expensesByMonth.set(monthKey, monthEntries);
    });
  }

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

  // Calculate total monthly debt payments (already converted to preferred currency)
  const monthlyDebtPayments = agentDebts.reduce((sum, d) => sum + d.monthly_payment, 0);

  // Total monthly expenses = living expenses + debt payments (consistent with flow-freedom)
  const totalMonthlyExpenses = expenseWindow.monthly_average + monthlyDebtPayments;
  const totalAnnualExpenses = expenseWindow.annualized + (monthlyDebtPayments * 12);

  // Calculate net worth
  const totalAssets = agentAssets.reduce((sum, a) => sum + a.balance, 0);
  const totalDebts = agentDebts.reduce((sum, d) => sum + d.current_balance, 0);
  const netWorth = totalAssets - totalDebts;

  // Calculate gap (expenses - income = what you need to withdraw)
  const monthlyGap = totalMonthlyExpenses - incomeWindow.monthly_average;
  const annualGap = totalAnnualExpenses - incomeWindow.annualized;

  // Build compressed monthly history (combines both Maps)
  const allMonths = new Set([
    ...passiveIncomeMonthlyConverted.keys(),
    ...expensesMonthlyConverted.keys(),
  ]);
  const monthlyHistory: MonthlyStats[] = Array.from(allMonths)
    .sort()
    .map(month => ({
      month,
      income: Math.round((passiveIncomeMonthlyConverted.get(month) || 0) * 100) / 100,
      expenses: Math.round((expensesMonthlyConverted.get(month) || 0) * 100) / 100,
    }));

  return {
    assets: agentAssets,
    debts: agentDebts,
    // Monthly values (primary display) - includes debt payments
    monthly_passive_income: incomeWindow.monthly_average,
    monthly_expenses: Math.round(totalMonthlyExpenses * 100) / 100,
    monthly_gap: Math.round(monthlyGap * 100) / 100,
    // Annual values (for agent calculation) - includes debt payments
    annual_passive_income: incomeWindow.annualized,
    annual_expenses: Math.round(totalAnnualExpenses * 100) / 100,
    annual_gap: Math.round(annualGap * 100) / 100,
    // Monthly breakdown (compressed - just totals per month)
    monthly_history: monthlyHistory,
    // Net worth
    net_worth: Math.round(netWorth * 100) / 100,
    currency: preferredCurrency,
    // User's region for inflation rate
    timezone,
    data_quality: {
      income: {
        confidence: incomeWindow.confidence,
        months_of_data: incomeWindow.months_of_data,
        warning: incomeWindow.warning,
      },
      expenses: {
        confidence: expenseWindow.confidence,
        months_of_data: expenseWindow.months_of_data,
        warning: expenseWindow.warning,
      },
    },
  };
}

/**
 * Call the runway agent service
 */
async function callAgentService(request: AgentRequest): Promise<AgentProjection> {
  try {
    const response = await fetch(`${RUNWAY_AGENT_URL}/runway/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Agent service error:', errorText);
      throw new AppError(`Agent service error: ${response.status}`, 500);
    }

    return await response.json() as AgentProjection;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Failed to call agent service:', err);
    throw new AppError('Failed to connect to runway agent service', 500);
  }
}
