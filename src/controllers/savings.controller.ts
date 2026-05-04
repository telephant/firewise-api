import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SavingsAccount {
  id: string;
  belong_id: string;
  name: string;
  bank: string | null;
  currency: string;
  balance: number;
  interest_rate: number;
  compound_frequency: 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  notes: string | null;
  start_date: string | null;
  created_at: string;
  updated_at: string;
  // Enriched fields
  last_credited_at: string | null;
  next_payout_date: string;
  next_payout_amount: number;
  total_interest_ytd: number;
  total_interest_all: number;
}

export interface InterestRecord {
  id: string;
  account_id: string;
  amount: number;
  credited_at: string;
  notes: string | null;
  created_at: string;
}

export interface ForecastPeriod {
  period: number;       // 1-based index
  date: string;         // ISO date YYYY-MM-DD
  amount: number;
}

const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
};

const DAYS_PER_PERIOD: Record<string, number> = {
  monthly: 30,
  quarterly: 91,
  semi_annual: 182,
  annual: 365,
};

// ── Pure helpers (exported for testing) ───────────────────────────────────

export function computeForecast(
  balance: number,
  interestRate: number,
  frequency: string
): number {
  const periods = PERIODS_PER_YEAR[frequency] ?? 12;
  return balance * interestRate / periods;
}

export function computeNextPayoutDate(fromDate: string, frequency: string): string {
  const days = DAYS_PER_PERIOD[frequency] ?? 30;
  const d = new Date(fromDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildForecast(
  balance: number,
  interestRate: number,
  frequency: string,
  lastCreditedAt: string | null,
  startDate: string | null,
  createdAt: string,
  periods = 12
): ForecastPeriod[] {
  const payoutAmount = computeForecast(balance, interestRate, frequency);
  const baseDate = lastCreditedAt ?? startDate ?? createdAt.slice(0, 10);
  const result: ForecastPeriod[] = [];
  let currentDate = baseDate;
  for (let i = 1; i <= periods; i++) {
    currentDate = computeNextPayoutDate(currentDate, frequency);
    result.push({ period: i, date: currentDate, amount: payoutAmount });
  }
  return result;
}

// ── Controller functions ───────────────────────────────────────────────────

// GET /fire/savings
export const listAccounts = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<SavingsAccount[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);

    const { data: accounts, error } = await supabaseAdmin
      .from('savings_accounts')
      .select('*')
      .eq('belong_id', ctx.belongId)
      .order('created_at', { ascending: false });

    if (error) throw new AppError('Failed to fetch savings accounts', 500);

    const accountIds = (accounts || []).map((a: { id: string }) => a.id);
    if (accountIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Fetch all interest records for these accounts
    const { data: records } = await supabaseAdmin
      .from('interest_records')
      .select('account_id, amount, credited_at')
      .in('account_id', accountIds);

    const allRecords: { account_id: string; amount: number; credited_at: string }[] = records || [];
    const currentYear = new Date().getFullYear();

    const enriched: SavingsAccount[] = (accounts || []).map((a: {
      id: string; belong_id: string; name: string; bank: string | null;
      currency: string; balance: number; interest_rate: number;
      compound_frequency: string; notes: string | null; start_date: string | null;
      created_at: string; updated_at: string;
    }) => {
      const acctRecords = allRecords.filter(r => r.account_id === a.id);
      const sorted = [...acctRecords].sort((x, y) => y.credited_at.localeCompare(x.credited_at));
      const lastCreditedAt = sorted[0]?.credited_at ?? null;
      const nextPayoutDate = computeNextPayoutDate(
        lastCreditedAt ?? a.start_date ?? a.created_at.slice(0, 10),
        a.compound_frequency
      );
      const nextPayoutAmount = computeForecast(a.balance, a.interest_rate, a.compound_frequency);
      const totalInterestYtd = acctRecords
        .filter(r => new Date(r.credited_at).getFullYear() === currentYear)
        .reduce((sum, r) => sum + r.amount, 0);
      const totalInterestAll = acctRecords.reduce((sum, r) => sum + r.amount, 0);

      return {
        ...a,
        compound_frequency: a.compound_frequency as SavingsAccount['compound_frequency'],
        last_credited_at: lastCreditedAt,
        next_payout_date: nextPayoutDate,
        next_payout_amount: nextPayoutAmount,
        total_interest_ytd: totalInterestYtd,
        total_interest_all: totalInterestAll,
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch savings accounts' });
  }
};

// POST /fire/savings
export const createAccount = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<SavingsAccount>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { name, bank, currency, balance, interest_rate, compound_frequency, notes, start_date } = req.body;

    if (!name || balance === undefined || interest_rate === undefined) {
      throw new AppError('name, balance, and interest_rate are required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('savings_accounts')
      .insert({
        belong_id: ctx.belongId,
        name,
        bank: bank || null,
        currency: currency || 'USD',
        balance: Number(balance),
        interest_rate: Number(interest_rate),
        compound_frequency: compound_frequency || 'monthly',
        notes: notes || null,
        start_date: start_date || null,
      })
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to create savings account', 500);

    res.status(201).json({
      success: true,
      data: {
        ...data,
        last_credited_at: null,
        next_payout_date: computeNextPayoutDate(data.start_date ?? data.created_at.slice(0, 10), data.compound_frequency),
        next_payout_amount: computeForecast(data.balance, data.interest_rate, data.compound_frequency),
        total_interest_ytd: 0,
        total_interest_all: 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create savings account' });
  }
};

// PUT /fire/savings/:id
export const updateAccount = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ id: string }>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;
    const { name, bank, currency, balance, interest_rate, compound_frequency, notes, start_date } = req.body;

    const { data: existing } = await supabaseAdmin
      .from('savings_accounts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!existing) throw new AppError('Savings account not found', 404);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (bank !== undefined) updates.bank = bank || null;
    if (currency !== undefined) updates.currency = currency;
    if (balance !== undefined) updates.balance = Number(balance);
    if (interest_rate !== undefined) updates.interest_rate = Number(interest_rate);
    if (compound_frequency !== undefined) updates.compound_frequency = compound_frequency;
    if (notes !== undefined) updates.notes = notes || null;
    if (start_date !== undefined) updates.start_date = start_date || null;

    const { error } = await supabaseAdmin
      .from('savings_accounts')
      .update(updates)
      .eq('id', id);

    if (error) throw new AppError('Failed to update savings account', 500);

    res.json({ success: true, data: { id } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update savings account' });
  }
};

// DELETE /fire/savings/:id
export const deleteAccount = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ id: string }>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;

    const { data: existing } = await supabaseAdmin
      .from('savings_accounts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!existing) throw new AppError('Savings account not found', 404);

    const { error: deleteError } = await supabaseAdmin.from('savings_accounts').delete().eq('id', id);
    if (deleteError) throw new AppError('Failed to delete savings account', 500);

    res.json({ success: true, data: { id } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete savings account' });
  }
};

// GET /fire/savings/:id/interest
export const listInterest = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ records: InterestRecord[]; forecast: ForecastPeriod[] }>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;

    const { data: account } = await supabaseAdmin
      .from('savings_accounts')
      .select('*')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!account) throw new AppError('Savings account not found', 404);

    const { data: records, error } = await supabaseAdmin
      .from('interest_records')
      .select('*')
      .eq('account_id', id)
      .order('credited_at', { ascending: false });

    if (error) throw new AppError('Failed to fetch interest records', 500);

    const sorted = (records || []).sort((a: { credited_at: string }, b: { credited_at: string }) =>
      b.credited_at.localeCompare(a.credited_at)
    );
    const lastCreditedAt = sorted[0]?.credited_at ?? null;

    const forecast = buildForecast(
      account.balance,
      account.interest_rate,
      account.compound_frequency,
      lastCreditedAt,
      account.start_date ?? null,
      account.created_at,
      12
    );

    res.json({ success: true, data: { records: records || [], forecast } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch interest records' });
  }
};

// POST /fire/savings/:id/interest
export const addInterest = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<InterestRecord>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;
    const { amount, credited_at, notes } = req.body;

    if (amount === undefined || amount === null || !credited_at) {
      throw new AppError('amount and credited_at are required', 400);
    }
    if (Number(amount) <= 0) {
      throw new AppError('amount must be greater than 0', 400);
    }

    const { data: account } = await supabaseAdmin
      .from('savings_accounts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!account) throw new AppError('Savings account not found', 404);

    const { data, error } = await supabaseAdmin
      .from('interest_records')
      .insert({ account_id: id, amount: Number(amount), credited_at, notes: notes || null })
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to add interest record', 500);

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to add interest record' });
  }
};

// DELETE /fire/savings/:id/interest/:recordId
export const deleteInterest = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ id: string }>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id, recordId } = req.params;

    // Verify account ownership
    const { data: account } = await supabaseAdmin
      .from('savings_accounts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!account) throw new AppError('Savings account not found', 404);

    const { error: deleteError } = await supabaseAdmin
      .from('interest_records')
      .delete()
      .eq('id', recordId)
      .eq('account_id', id);
    if (deleteError) throw new AppError('Failed to delete interest record', 500);

    res.json({ success: true, data: { id: recordId } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete interest record' });
  }
};
