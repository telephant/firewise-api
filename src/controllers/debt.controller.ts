import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Debt, DebtFilters, Asset } from '../types';
import { AppError } from '../middleware/error';
import { addConvertedFieldsToArray, addConvertedFieldsToSingle, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { getViewContext } from '../utils/family-context';

/**
 * Get all debts for the authenticated user
 */
export const getDebts = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ debts: Debt[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { page = '1', limit = '50', status, debt_type, property_asset_id } = req.query as unknown as DebtFilters & { page: string; limit: string; property_asset_id?: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build query with family/personal context
    let query = supabaseAdmin
      .from('debts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Apply ownership filter
    query = query.eq('belong_id', viewContext.belongId);

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
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Build query with family/personal context
    const { data: debt, error } = await supabaseAdmin
      .from('debts')
      .select('*')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
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
    const viewContext = await getViewContext(req);
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

    // Verify property_asset_id belongs to user/family if provided
    if (property_asset_id) {
      const { data: propertyAsset, error: assetError } = await supabaseAdmin
        .from('assets')
        .select('id')
        .eq('id', property_asset_id)
        .eq('belong_id', viewContext.belongId)
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
        user_id: viewContext.userId,
        belong_id: viewContext.belongId,
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
    const viewContext = await getViewContext(req);
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

    // Check if debt exists and belongs to user/family
    const { data: existingDebt, error: fetchError } = await supabaseAdmin
      .from('debts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
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
 * Delete a debt
 */
export const deleteDebt = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if debt exists and belongs to user/family
    const { data: existingDebt, error: fetchError } = await supabaseAdmin
      .from('debts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (fetchError || !existingDebt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    // Flow is now an audit log - debts can be deleted freely
    // Flow references will be set to NULL (ON DELETE SET NULL)
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
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Verify debt belongs to user/family
    const { data: debt, error: debtError } = await supabaseAdmin
      .from('debts')
      .select('id')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (debtError || !debt) {
      res.status(404).json({ success: false, error: 'Debt not found' });
      return;
    }

    const { data: payments, error, count } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('debt_id', id)
      .eq('type', 'debt_payment')
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
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Build query with family/personal context
    const { data: debt, error } = await supabaseAdmin
      .from('debts')
      .select('*')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
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

/**
 * POST /api/fire/debts/transaction
 *
 * Unified debt transaction endpoint:
 * - create: Create a new debt (optionally disburse to cash)
 * - pay: Make a debt payment
 */
interface DebtTransactionRequest {
  type: 'create' | 'pay';

  // For create
  name?: string;
  debt_type?: 'mortgage' | 'personal_loan' | 'credit_card' | 'student_loan' | 'auto_loan' | 'other';
  principal?: number;
  interest_rate?: number;
  term_months?: number;
  start_date?: string; // Loan start date
  monthly_payment?: number; // Pre-calculated monthly payment
  disburse_to_asset_id?: string; // Optional: cash account to receive loan proceeds

  // For pay
  debt_id?: string;
  from_asset_id?: string; // Cash account for payment
  recurring_frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'; // For recurring payments

  // Common
  amount: number;
  currency?: string;
  date?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface DebtTransactionResult {
  transaction_id?: string;
  debt: Debt;
  from_asset?: Asset;
  to_asset?: Asset;
  schedule_id?: string;
}

export const createDebtTransaction = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DebtTransactionResult>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const ownershipValues = { user_id: viewContext.userId, belong_id: viewContext.belongId };

    const {
      type,
      name,
      debt_type,
      principal,
      interest_rate,
      term_months,
      start_date,
      monthly_payment,
      disburse_to_asset_id,
      debt_id,
      from_asset_id,
      recurring_frequency,
      amount,
      currency = 'USD',
      date,
      description,
      metadata,
    } = req.body as DebtTransactionRequest;

    // Validate type
    if (!type || !['create', 'pay'].includes(type)) {
      res.status(400).json({
        success: false,
        error: 'Valid type is required: create or pay'
      });
      return;
    }

    // Validate amount
    if (amount === undefined || amount === null || isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount is required' });
      return;
    }

    const flowDate = date || new Date().toISOString().split('T')[0];

    if (type === 'create') {
      // Create new debt
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ success: false, error: 'Name is required for debt creation' });
        return;
      }

      const validDebtTypes = ['mortgage', 'personal_loan', 'credit_card', 'student_loan', 'auto_loan', 'other'];
      if (debt_type && !validDebtTypes.includes(debt_type)) {
        res.status(400).json({ success: false, error: 'Invalid debt type' });
        return;
      }

      const principalAmount = principal || amount;

      // Create the debt
      const { data: debt, error: debtError } = await supabaseAdmin
        .from('debts')
        .insert({
          ...ownershipValues,
          name: name.trim(),
          debt_type: debt_type || 'other',
          currency: currency,
          principal: principalAmount,
          current_balance: principalAmount,
          interest_rate: interest_rate || null,
          term_months: term_months || null,
          start_date: start_date || null,
          monthly_payment: monthly_payment || null,
          status: 'active',
        })
        .select()
        .single();

      if (debtError) {
        if (debtError.code === '23505') {
          res.status(400).json({ success: false, error: 'A debt with this name already exists' });
          return;
        }
        throw new AppError('Failed to create debt', 500);
      }

      // Optionally disburse to cash account
      let toAsset: Asset | undefined;
      let flowId: string | undefined;

      if (disburse_to_asset_id) {
        const { data: ta, error: taError } = await supabaseAdmin
          .from('assets')
          .select('*')
          .eq('id', disburse_to_asset_id)
          .eq('belong_id', viewContext.belongId)
          .single();
        if (taError || !ta) {
          res.status(400).json({ success: false, error: 'Disburse asset not found' });
          return;
        }
        toAsset = ta;

        // Convert if currencies differ
        let addAmount = principalAmount;
        if (currency.toLowerCase() !== (ta.currency || 'USD').toLowerCase()) {
          const rateMap = await getExchangeRates([currency.toLowerCase(), (ta.currency || 'USD').toLowerCase()]);
          const conversion = convertAmount(principalAmount, currency, ta.currency || 'USD', rateMap);
          if (conversion) addAmount = conversion.converted;
        }

        // Update asset balance
        const newBalance = Number(ta.balance) + addAmount;
        await supabaseAdmin
          .from('assets')
          .update({ balance: newBalance, balance_updated_at: new Date().toISOString() })
          .eq('id', disburse_to_asset_id);

        // Log disbursement transaction
        const { data: transaction, error: txError } = await supabaseAdmin
          .from('transactions')
          .insert({
            belong_id: ownershipValues.belong_id,
            type: 'loan',
            category: 'loan_disbursement',
            amount: principalAmount,
            currency: currency,
            date: flowDate,
            asset_id: disburse_to_asset_id,
            debt_id: debt.id,
            description: description || `Loan disbursement: ${name}`,
            metadata: metadata || null,
          })
          .select()
          .single();

        if (txError) {
          console.error('Disbursement transaction error:', txError);
        } else {
          flowId = transaction.id;
        }
      }

      res.status(201).json({
        success: true,
        data: {
          transaction_id: flowId,
          debt: debt,
          to_asset: toAsset,
        },
      });

    } else if (type === 'pay') {
      // Make debt payment
      if (!debt_id) {
        res.status(400).json({ success: false, error: 'debt_id is required for payment' });
        return;
      }

      // Fetch the debt
      const { data: debt, error: debtError } = await supabaseAdmin
        .from('debts')
        .select('*')
        .eq('id', debt_id)
        .eq('belong_id', viewContext.belongId)
        .single();

      if (debtError || !debt) {
        res.status(400).json({ success: false, error: 'Debt not found' });
        return;
      }

      // Decrease from_asset (cash) if provided
      let fromAsset: Asset | undefined;
      if (from_asset_id) {
        const { data: fa, error: faError } = await supabaseAdmin
          .from('assets')
          .select('*')
          .eq('id', from_asset_id)
          .eq('belong_id', viewContext.belongId)
          .single();
        if (faError || !fa) {
          res.status(400).json({ success: false, error: 'From asset not found' });
          return;
        }
        fromAsset = fa;

        // Convert if currencies differ
        let deductAmount = amount;
        if (currency.toLowerCase() !== (fa.currency || 'USD').toLowerCase()) {
          const rateMap = await getExchangeRates([currency.toLowerCase(), (fa.currency || 'USD').toLowerCase()]);
          const conversion = convertAmount(amount, currency, fa.currency || 'USD', rateMap);
          if (conversion) deductAmount = conversion.converted;
        }

        // Update asset balance (prevent negative balance)
        const newBalance = Math.max(0, Number(fa.balance) - deductAmount);
        await supabaseAdmin
          .from('assets')
          .update({ balance: newBalance, balance_updated_at: new Date().toISOString() })
          .eq('id', from_asset_id);
      }

      // Update debt balance
      let paymentInDebtCurrency = amount;
      if (currency.toLowerCase() !== (debt.currency || 'USD').toLowerCase()) {
        const rateMap = await getExchangeRates([currency.toLowerCase(), (debt.currency || 'USD').toLowerCase()]);
        const conversion = convertAmount(amount, currency, debt.currency || 'USD', rateMap);
        if (conversion) paymentInDebtCurrency = conversion.converted;
      }

      const newDebtBalance = Math.max(0, Number(debt.current_balance) - paymentInDebtCurrency);
      const debtUpdates: Record<string, unknown> = {
        current_balance: newDebtBalance,
        balance_updated_at: new Date().toISOString(),
      };

      // Auto-update status if paid off
      if (newDebtBalance <= 0) {
        debtUpdates.status = 'paid_off';
        debtUpdates.paid_off_date = flowDate;
      }

      const { data: updatedDebt, error: updateError } = await supabaseAdmin
        .from('debts')
        .update(debtUpdates)
        .eq('id', debt_id)
        .select()
        .single();

      if (updateError) {
        throw new AppError('Failed to update debt balance', 500);
      }

      // Log payment transaction
      const { data: transaction, error: txError } = await supabaseAdmin
        .from('transactions')
        .insert({
          belong_id: ownershipValues.belong_id,
          type: 'debt_payment',
          category: 'pay_debt',
          amount: amount,
          currency: currency,
          date: flowDate,
          asset_id: from_asset_id || null,  // Cash account used for payment
          debt_id: debt_id,
          description: description || `Payment to ${debt.name}`,
          metadata: metadata || null,
        })
        .select()
        .single();

      if (txError) {
        throw new AppError('Failed to log payment', 500);
      }

      // Create recurring schedule if frequency is set
      let scheduleId: string | undefined;
      console.log('[DebtPayment] recurring_frequency:', recurring_frequency);
      if (recurring_frequency) {
        // Calculate next run date based on frequency
        const nextDate = new Date(flowDate);
        switch (recurring_frequency) {
          case 'weekly':
            nextDate.setDate(nextDate.getDate() + 7);
            break;
          case 'biweekly':
            nextDate.setDate(nextDate.getDate() + 14);
            break;
          case 'monthly':
            nextDate.setMonth(nextDate.getMonth() + 1);
            break;
          case 'quarterly':
            nextDate.setMonth(nextDate.getMonth() + 3);
            break;
          case 'yearly':
            nextDate.setFullYear(nextDate.getFullYear() + 1);
            break;
        }

        const { data: schedule, error: scheduleError } = await supabaseAdmin
          .from('recurring_schedules')
          .insert({
            ...ownershipValues,
            source_transaction_id: transaction.id,
            frequency: recurring_frequency,
            next_run_date: nextDate.toISOString().split('T')[0],
            is_active: true,
            transaction_template: {
              type: 'debt_payment',
              amount: amount,
              currency: currency,
              from_asset_id: from_asset_id || null,
              to_asset_id: null,
              debt_id: debt_id,
              category: 'pay_debt',
              description: description || `Payment to ${debt.name}`,
              expense_category_id: null,
              metadata: metadata || null,
            },
          })
          .select()
          .single();

        if (scheduleError) {
          console.error('[DebtPayment] Failed to create recurring schedule:', scheduleError);
          console.error('[DebtPayment] Schedule data was:', {
            ...ownershipValues,
            frequency: recurring_frequency,
            next_run_date: nextDate.toISOString().split('T')[0],
          });
          // Don't fail the whole request, just log the error
        } else {
          console.log('[DebtPayment] Created recurring schedule:', schedule?.id);
          scheduleId = schedule?.id;
        }
      }

      res.status(201).json({
        success: true,
        data: {
          transaction_id: transaction.id,
          debt: updatedDebt,
          from_asset: fromAsset,
          schedule_id: scheduleId,
        },
      });
    }
  } catch (err) {
    console.error('Debt transaction error:', err);
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to process debt transaction' });
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
