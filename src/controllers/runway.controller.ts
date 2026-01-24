import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, Debt } from '../types';
import { AppError } from '../middleware/error';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { DataQuality } from '../utils/data-window';
import { fetchStockPrices } from '../utils/stock-price';
import { getFinancialStats } from '../utils/financial-stats';

// Agent service URL (Railway internal network)
const RUNWAY_AGENT_URL = process.env.RUNWAY_AGENT_URL || 'http://localhost:8000';

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
 * Uses shared financial stats for income/expenses, fetches assets/debts for agent
 */
async function collectFinancialData(userId: string, preferredCurrency: string, timezone: string | null): Promise<AgentRequest> {
  // Get shared financial stats (cached)
  const financialStats = await getFinancialStats(userId);

  // Fetch assets and debts for agent (need detailed breakdown)
  const [assetsResult, debtsResult] = await Promise.all([
    supabaseAdmin.from('assets').select('*').eq('user_id', userId),
    supabaseAdmin.from('debts').select('*').eq('user_id', userId).gt('current_balance', 0),
  ]);

  if (assetsResult.error) throw new AppError('Failed to fetch assets', 500);
  if (debtsResult.error) throw new AppError('Failed to fetch debts', 500);

  const assets = (assetsResult.data || []) as Asset[];
  const debts = (debtsResult.data || []) as Debt[];

  // Fetch stock prices for stock/ETF assets (uses shared cache)
  const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf') && a.ticker);
  const tickers = stockAssets.map(a => a.ticker!);
  const priceMap = await fetchStockPrices(tickers);

  // Get exchange rates for conversion (include stock currencies)
  const allCurrencies = new Set<string>([preferredCurrency.toLowerCase()]);
  assets.forEach(a => allCurrencies.add(a.currency.toLowerCase()));
  debts.forEach(d => allCurrencies.add(d.currency.toLowerCase()));
  priceMap.forEach(result => {
    allCurrencies.add(result.currency.toLowerCase());
  });
  const rateMap = await getExchangeRates(Array.from(allCurrencies));

  // Convert assets to preferred currency (with market value for stocks)
  const agentAssets: AgentAsset[] = assets.map(asset => {
    let value: number;
    let valueCurrency: string;

    // For stock/ETF: calculate market value = shares × price
    if ((asset.type === 'stock' || asset.type === 'etf') && asset.ticker) {
      const stockPrice = priceMap.get(asset.ticker);
      if (stockPrice) {
        value = Number(asset.balance) * stockPrice.price;
        valueCurrency = stockPrice.currency;
      } else {
        // No price available - skip this asset or use 0
        value = 0;
        valueCurrency = preferredCurrency;
      }
    } else {
      // For other assets: balance is already the value
      value = Number(asset.balance);
      valueCurrency = asset.currency;
    }

    // Convert to preferred currency
    const conversion = convertAmount(value, valueCurrency, preferredCurrency, rateMap);

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
      balance: conversion ? Math.round(conversion.converted * 100) / 100 : value,
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

  // Calculate net worth from assets and debts
  const totalAssets = agentAssets.reduce((sum, a) => sum + a.balance, 0);
  const totalDebts = agentDebts.reduce((sum, d) => sum + d.current_balance, 0);
  const netWorth = totalAssets - totalDebts;

  // Use living expenses from shared stats (debt payments handled separately by agent)
  const monthlyLivingExpenses = financialStats.expenses.living / 12;
  const annualLivingExpenses = financialStats.expenses.living;

  // Calculate gap (expenses - income = what you need to withdraw)
  const monthlyGap = monthlyLivingExpenses - financialStats.passiveIncome.monthly;
  const annualGap = annualLivingExpenses - financialStats.passiveIncome.annual;

  return {
    assets: agentAssets,
    debts: agentDebts,
    // Monthly values from shared stats
    monthly_passive_income: financialStats.passiveIncome.monthly,
    monthly_expenses: Math.round(monthlyLivingExpenses * 100) / 100,
    monthly_gap: Math.round(monthlyGap * 100) / 100,
    // Annual values from shared stats
    annual_passive_income: financialStats.passiveIncome.annual,
    annual_expenses: Math.round(annualLivingExpenses * 100) / 100,
    annual_gap: Math.round(annualGap * 100) / 100,
    // Monthly breakdown from shared stats
    monthly_history: financialStats.monthlyHistory,
    // Net worth (calculated from assets - debts)
    net_worth: Math.round(netWorth * 100) / 100,
    currency: financialStats.currency,
    // User's region for inflation rate
    timezone,
    data_quality: {
      income: financialStats.passiveIncome.dataQuality,
      expenses: financialStats.expenses.dataQuality,
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
