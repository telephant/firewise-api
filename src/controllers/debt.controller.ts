import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Debt, DebtFilters } from '../types';
import { AppError } from '../middleware/error';
import { addConvertedFieldsToArray, addConvertedFieldsToSingle } from '../utils/currency-conversion';

/**
 * Get all debts for the authenticated user
 */
export const getDebts = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ debts: Debt[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { page = '1', limit = '50', status, debt_type, property_asset_id } = req.query as unknown as DebtFilters & { page: string; limit: string; property_asset_id?: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('debts')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (debt_type) {
      query = query.eq('debt_type', debt_type);
    }

    if (property_asset_id) {
      query = query.eq('property_asset_id', property_asset_id);
    }

    query = query.range(offset, offset + limitNum - 1);

    const { data: debts, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch debts', 500);
    }

    // Add currency conversion fields if user has convert_all_to_preferred enabled
    const debtsWithConversion = await addConvertedFieldsToArray(debts || [], userId);

    res.json({
      success: true,
      data: {
        debts: debtsWithConversion,
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch debts' });
  }
};

/**
 * Get a single debt by ID
 */
export const getDebt = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Debt>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: debt, error } = await supabaseAdmin
      .from('debts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !debt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    // Add currency conversion fields if user has convert_all_to_preferred enabled
    const debtWithConversion = await addConvertedFieldsToSingle(debt, userId);

    res.json({
      success: true,
      data: debtWithConversion,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch debt' });
  }
};

/**
 * Create a new debt
 */
export const createDebt = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Debt>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const {
      name,
      debt_type,
      currency,
      principal,
      interest_rate,
      term_months,
      start_date,
      monthly_payment,
      property_asset_id,
      metadata,
    } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    if (!principal || isNaN(parseFloat(principal)) || parseFloat(principal) <= 0) {
      res.status(400).json({ success: false, error: 'Principal amount is required and must be positive' });
      return;
    }

    const validDebtTypes = ['mortgage', 'personal_loan', 'credit_card', 'student_loan', 'auto_loan', 'other'];
    if (debt_type && !validDebtTypes.includes(debt_type)) {
      res.status(400).json({ success: false, error: 'Invalid debt type' });
      return;
    }

    // Verify property_asset_id belongs to user if provided
    if (property_asset_id) {
      const { data: propertyAsset, error: assetError } = await supabaseAdmin
        .from('assets')
        .select('id')
        .eq('id', property_asset_id)
        .eq('user_id', userId)
        .single();

      if (assetError || !propertyAsset) {
        res.status(400).json({ success: false, error: 'Property asset not found' });
        return;
      }
    }

    const principalAmount = parseFloat(principal);

    const { data: debt, error } = await supabaseAdmin
      .from('debts')
      .insert({
        user_id: userId,
        name: name.trim(),
        debt_type: debt_type || 'other',
        currency: currency || 'USD',
        principal: principalAmount,
        current_balance: principalAmount, // Initial balance equals principal
        interest_rate: interest_rate ? parseFloat(interest_rate) : null,
        term_months: term_months ? parseInt(term_months, 10) : null,
        start_date: start_date || null,
        monthly_payment: monthly_payment ? parseFloat(monthly_payment) : null,
        property_asset_id: property_asset_id || null,
        status: 'active', // Set default status to active
        metadata: metadata || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ success: false, error: 'A debt with this name already exists' });
        return;
      }
      throw new AppError('Failed to create debt', 500);
    }

    res.status(201).json({ success: true, data: debt });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create debt' });
  }
};

/**
 * Update an existing debt
 */
export const updateDebt = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Debt>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const {
      name,
      debt_type,
      currency,
      principal,
      current_balance,
      interest_rate,
      term_months,
      start_date,
      monthly_payment,
      property_asset_id,
      status,
      metadata,
    } = req.body;

    // Check if debt exists and belongs to user
    const { data: existingDebt, error: fetchError } = await supabaseAdmin
      .from('debts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingDebt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name !== undefined) updates.name = name.trim();
    if (debt_type !== undefined) updates.debt_type = debt_type;
    if (currency !== undefined) updates.currency = currency;
    if (principal !== undefined) updates.principal = parseFloat(principal);
    if (current_balance !== undefined) {
      updates.current_balance = parseFloat(current_balance);
      updates.balance_updated_at = new Date().toISOString();
      // Auto-update status based on balance
      if (parseFloat(current_balance) <= 0) {
        updates.status = 'paid_off';
        updates.paid_off_date = new Date().toISOString().split('T')[0];
      }
    }
    if (interest_rate !== undefined) updates.interest_rate = interest_rate ? parseFloat(interest_rate) : null;
    if (term_months !== undefined) updates.term_months = term_months ? parseInt(term_months, 10) : null;
    if (start_date !== undefined) updates.start_date = start_date || null;
    if (monthly_payment !== undefined) updates.monthly_payment = monthly_payment ? parseFloat(monthly_payment) : null;
    if (property_asset_id !== undefined) updates.property_asset_id = property_asset_id || null;
    if (status !== undefined) updates.status = status;
    if (metadata !== undefined) updates.metadata = metadata;

    const { data: debt, error } = await supabaseAdmin
      .from('debts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ success: false, error: 'A debt with this name already exists' });
        return;
      }
      throw new AppError('Failed to update debt', 500);
    }

    res.json({ success: true, data: debt });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to update debt' });
  }
};

/**
 * Delete a debt (only if no flows reference it)
 */
export const deleteDebt = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Check if debt exists and belongs to user
    const { data: existingDebt, error: fetchError } = await supabaseAdmin
      .from('debts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingDebt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    // Check if any flows reference this debt
    const { data: flows, error: flowsError } = await supabaseAdmin
      .from('flows')
      .select('id')
      .eq('debt_id', id)
      .limit(1);

    if (flowsError) {
      throw new AppError('Failed to check debt usage', 500);
    }

    if (flows && flows.length > 0) {
      res.status(400).json({
        success: false,
        error: 'Cannot delete debt with existing payments. Delete the payment flows first.',
      });
      return;
    }

    const { error } = await supabaseAdmin.from('debts').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete debt', 500);
    }

    res.json({ success: true, message: 'Debt deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete debt' });
  }
};

/**
 * Get all payments for a specific debt
 */
export const getDebtPayments = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ payments: unknown[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Verify debt belongs to user
    const { data: debt, error: debtError } = await supabaseAdmin
      .from('debts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (debtError || !debt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    const { data: payments, error, count } = await supabaseAdmin
      .from('flows')
      .select('*', { count: 'exact' })
      .eq('debt_id', id)
      .eq('category', 'pay_debt')
      .order('date', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch payments', 500);
    }

    res.json({
      success: true,
      data: {
        payments: payments || [],
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch payments' });
  }
};

/**
 * Get amortization schedule for a debt
 */
export const getDebtAmortization = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ schedule: AmortizationEntry[]; summary: AmortizationSummary }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: debt, error } = await supabaseAdmin
      .from('debts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !debt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    // Calculate amortization schedule if we have the required data
    if (!debt.principal || !debt.interest_rate || !debt.term_months) {
      res.status(400).json({
        success: false,
        error: 'Debt must have principal, interest rate, and term to calculate amortization',
      });
      return;
    }

    const schedule = calculateAmortizationSchedule(
      debt.principal,
      debt.interest_rate,
      debt.term_months,
      debt.start_date
    );

    const totalInterest = schedule.reduce((sum, entry) => sum + entry.interest, 0);
    const totalPaid = schedule.reduce((sum, entry) => sum + entry.payment, 0);

    res.json({
      success: true,
      data: {
        schedule,
        summary: {
          principal: debt.principal,
          totalInterest,
          totalPaid,
          monthlyPayment: debt.monthly_payment || schedule[0]?.payment || 0,
          payoffDate: schedule[schedule.length - 1]?.date || null,
        },
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to calculate amortization' });
  }
};

// Types for amortization
interface AmortizationEntry {
  month: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

interface AmortizationSummary {
  principal: number;
  totalInterest: number;
  totalPaid: number;
  monthlyPayment: number;
  payoffDate: string | null;
}

// Helper function to calculate amortization schedule
function calculateAmortizationSchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  startDate?: string | null
): AmortizationEntry[] {
  const monthlyRate = annualRate / 12;
  const monthlyPayment =
    (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
    (Math.pow(1 + monthlyRate, termMonths) - 1);

  const schedule: AmortizationEntry[] = [];
  let balance = principal;
  let currentDate = startDate ? new Date(startDate) : new Date();

  for (let month = 1; month <= termMonths && balance > 0; month++) {
    const interest = balance * monthlyRate;
    const principalPaid = Math.min(monthlyPayment - interest, balance);
    balance = Math.max(0, balance - principalPaid);

    schedule.push({
      month,
      date: currentDate.toISOString().split('T')[0],
      payment: Math.round((interest + principalPaid) * 100) / 100,
      principal: Math.round(principalPaid * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    });

    // Move to next month
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return schedule;
}
