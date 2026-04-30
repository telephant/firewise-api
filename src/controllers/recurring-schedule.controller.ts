import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import {
  AuthenticatedRequest,
  ApiResponse,
  RecurringSchedule,
  RecurringScheduleFilters,
  ProcessRecurringResult,
  TransactionTemplate,
  ScheduleFrequency,
} from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';

/**
 * Get all recurring schedules for the authenticated user
 */
export const getSchedules = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ schedules: RecurringSchedule[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { page = '1', limit = '50', is_active, frequency } = req.query as unknown as RecurringScheduleFilters & {
      page: string;
      limit: string;
    };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build query with family/personal context
    let query = supabaseAdmin
      .from('recurring_schedules')
      .select('*', { count: 'exact' })
      .order('next_run_date', { ascending: true });

    // Apply ownership filter
    query = query.eq('belong_id', viewContext.belongId);

    if (is_active !== undefined) {
      query = query.eq('is_active', String(is_active) === 'true');
    }

    if (frequency) {
      query = query.eq('frequency', frequency);
    }

    query = query.range(offset, offset + limitNum - 1);

    const { data: schedules, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch recurring schedules', 500);
    }

    res.json({
      success: true,
      data: {
        schedules: schedules || [],
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch recurring schedules' });
  }
};

/**
 * Get a single recurring schedule by ID
 */
export const getSchedule = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<RecurringSchedule>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Build query with family/personal context
    const { data: schedule, error } = await supabaseAdmin
      .from('recurring_schedules')
      .select('*')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (error || !schedule) {
      res.status(404).json({ success: false, error: 'Recurring schedule not found' });
      return;
    }

    res.json({
      success: true,
      data: schedule,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch recurring schedule' });
  }
};

/**
 * Create a new recurring schedule
 */
export const createSchedule = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<RecurringSchedule>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { source_transaction_id, frequency, next_run_date, transaction_template } = req.body;

    // Validation
    const validFrequencies: ScheduleFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    if (!frequency || !validFrequencies.includes(frequency)) {
      res.status(400).json({ success: false, error: 'Invalid frequency' });
      return;
    }

    if (!next_run_date) {
      res.status(400).json({ success: false, error: 'Next run date is required' });
      return;
    }

    if (!transaction_template || typeof transaction_template !== 'object') {
      res.status(400).json({ success: false, error: 'Transaction template is required' });
      return;
    }

    // Validate transaction_template structure
    const template = transaction_template as TransactionTemplate;
    if (!template.type || !template.amount || !template.currency) {
      res.status(400).json({ success: false, error: 'Transaction template must have type, amount, and currency' });
      return;
    }

    // Verify source_transaction_id belongs to user/family if provided
    if (source_transaction_id) {
      const { data: sourceTransaction, error: txError } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('id', source_transaction_id)
        .eq('belong_id', viewContext.belongId)
        .single();

      if (txError || !sourceTransaction) {
        res.status(400).json({ success: false, error: 'Source transaction not found' });
        return;
      }
    }

    const { data: schedule, error } = await supabaseAdmin
      .from('recurring_schedules')
      .insert({
        user_id: viewContext.userId,
        belong_id: viewContext.belongId,
        source_transaction_id: source_transaction_id || null,
        frequency,
        next_run_date,
        is_active: true,
        transaction_template,
      })
      .select()
      .single();

    if (error) {
      throw new AppError('Failed to create recurring schedule', 500);
    }

    res.status(201).json({ success: true, data: schedule });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create recurring schedule' });
  }
};

/**
 * Update an existing recurring schedule
 */
export const updateSchedule = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<RecurringSchedule>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;
    const { frequency, next_run_date, is_active, transaction_template } = req.body;

    // Check if schedule exists and belongs to user/family
    const { data: existingSchedule, error: fetchError } = await supabaseAdmin
      .from('recurring_schedules')
      .select('id')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (fetchError || !existingSchedule) {
      res.status(404).json({ success: false, error: 'Recurring schedule not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (frequency !== undefined) {
      const validFrequencies: ScheduleFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
      if (!validFrequencies.includes(frequency)) {
        res.status(400).json({ success: false, error: 'Invalid frequency' });
        return;
      }
      updates.frequency = frequency;
    }

    if (next_run_date !== undefined) updates.next_run_date = next_run_date;
    if (is_active !== undefined) updates.is_active = is_active;
    if (transaction_template !== undefined) updates.transaction_template = transaction_template;

    const { data: schedule, error } = await supabaseAdmin
      .from('recurring_schedules')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new AppError('Failed to update recurring schedule', 500);
    }

    res.json({ success: true, data: schedule });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to update recurring schedule' });
  }
};

/**
 * Delete a recurring schedule
 */
export const deleteSchedule = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if schedule exists and belongs to user/family
    const { data: existingSchedule, error: fetchError } = await supabaseAdmin
      .from('recurring_schedules')
      .select('id')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (fetchError || !existingSchedule) {
      res.status(404).json({ success: false, error: 'Recurring schedule not found' });
      return;
    }

    const { error } = await supabaseAdmin.from('recurring_schedules').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete recurring schedule', 500);
    }

    res.json({ success: true, message: 'Recurring schedule deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete recurring schedule' });
  }
};

/**
 * Get all transactions generated by a specific schedule
 */
export const getScheduleFlows = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ transactions: unknown[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Verify schedule belongs to user/family
    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('recurring_schedules')
      .select('id')
      .eq('id', id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (scheduleError || !schedule) {
      res.status(404).json({ success: false, error: 'Recurring schedule not found' });
      return;
    }

    const { data: transactions, error, count } = await supabaseAdmin
      .from('transactions')
      .select('*', {
        count: 'exact',
      })
      .eq('schedule_id', id)
      .order('date', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch schedule transactions', 500);
    }

    res.json({
      success: true,
      data: {
        transactions: transactions || [],
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch schedule transactions' });
  }
};

/**
 * Process all due recurring schedules - creates flows and adjusts balances
 * This is the main endpoint called by the cron job
 */
export const processRecurring = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ProcessRecurringResult>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const today = new Date().toISOString().split('T')[0];

    // Find all active schedules due to run (next_run_date <= today) for this user/family
    let query = supabaseAdmin
      .from('recurring_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);

    // Apply ownership filter
    query = query.eq('belong_id', viewContext.belongId);

    const { data: dueSchedules, error: fetchError } = await query;

    if (fetchError) {
      throw new AppError('Failed to fetch due schedules', 500);
    }

    const result: ProcessRecurringResult = {
      processed: 0,
      created_transactions: [],
      errors: [],
    };

    if (!dueSchedules || dueSchedules.length === 0) {
      res.json({ success: true, data: result });
      return;
    }

    // (ownership values are taken from each schedule's own belong_id/user_id)

    // Process each due schedule
    for (const schedule of dueSchedules) {
      try {
        const template = schedule.transaction_template as TransactionTemplate;

        // Create the transaction with same ownership as the schedule (using belong_id model)
        const { data: newTransaction, error: txError } = await supabaseAdmin
          .from('transactions')
          .insert({
            user_id: schedule.user_id,
            belong_id: schedule.belong_id,
            type: template.type,
            amount: template.amount,
            currency: template.currency,
            asset_id: template.to_asset_id || template.from_asset_id,
            source_asset_id: template.from_asset_id,
            debt_id: template.debt_id,
            category: template.category,
            date: schedule.next_run_date,
            description: template.description,
            expense_category_id: template.expense_category_id,
            schedule_id: schedule.id,
            metadata: template.metadata,
            needs_review: false,
          })
          .select()
          .single();

        if (txError || !newTransaction) {
          result.errors.push({ schedule_id: schedule.id, error: 'Failed to create transaction' });
          continue;
        }

        result.created_transactions.push(newTransaction.id);

        // Adjust asset balances based on flow type
        await adjustAssetBalances(template, schedule.next_run_date);

        // Calculate next run date
        const nextDate = calculateNextRunDate(schedule.next_run_date, schedule.frequency as ScheduleFrequency);

        // Update schedule with new next_run_date and last_run_date
        await supabaseAdmin
          .from('recurring_schedules')
          .update({
            next_run_date: nextDate,
            last_run_date: schedule.next_run_date,
            updated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id);

        result.processed++;
      } catch (scheduleErr) {
        result.errors.push({
          schedule_id: schedule.id,
          error: scheduleErr instanceof Error ? scheduleErr.message : 'Unknown error',
        });
      }
    }

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to process recurring schedules' });
  }
};

/**
 * Adjust asset balances based on transaction template
 */
async function adjustAssetBalances(template: TransactionTemplate, date: string): Promise<void> {
  const amount = template.amount;

  switch (template.type) {
    case 'income':
      // Income: add to asset
      if (template.to_asset_id) {
        await updateAssetBalance(template.to_asset_id, amount);
      }
      break;

    case 'expense':
      // Expense: subtract from asset
      if (template.from_asset_id) {
        await updateAssetBalance(template.from_asset_id, -amount);
      }
      break;

    case 'buy':
      // Buy: subtract from source (cash)
      if (template.from_asset_id) {
        await updateAssetBalance(template.from_asset_id, -amount);
      }
      break;

    case 'sell':
      // Sell: add to destination (cash)
      if (template.to_asset_id) {
        await updateAssetBalance(template.to_asset_id, amount);
      }
      break;

    case 'debt_payment':
      // Debt payment: subtract from asset, reduce debt
      if (template.from_asset_id) {
        await updateAssetBalance(template.from_asset_id, -amount);
      }
      if (template.debt_id) {
        await updateDebtBalance(template.debt_id, -amount);
      }
      break;
  }
}

/**
 * Update asset balance by delta amount
 */
async function updateAssetBalance(assetId: string, delta: number): Promise<void> {
  // Get current balance
  const { data: asset, error: fetchError } = await supabaseAdmin
    .from('assets')
    .select('balance')
    .eq('id', assetId)
    .single();

  if (fetchError || !asset) return;

  const newBalance = (asset.balance || 0) + delta;

  await supabaseAdmin
    .from('assets')
    .update({
      balance: newBalance,
      balance_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId);
}

/**
 * Update debt balance by delta amount
 */
async function updateDebtBalance(debtId: string, delta: number): Promise<void> {
  const { data: debt, error: fetchError } = await supabaseAdmin
    .from('debts')
    .select('current_balance')
    .eq('id', debtId)
    .single();

  if (fetchError || !debt) return;

  const newBalance = Math.max(0, (debt.current_balance || 0) + delta);

  const updates: Record<string, unknown> = {
    current_balance: newBalance,
    balance_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Auto-update status if paid off
  if (newBalance <= 0) {
    updates.status = 'paid_off';
    updates.paid_off_date = new Date().toISOString().split('T')[0];
  }

  await supabaseAdmin.from('debts').update(updates).eq('id', debtId);
}

/**
 * Calculate the next run date based on frequency
 */
function calculateNextRunDate(currentDate: string, frequency: ScheduleFrequency): string {
  const date = new Date(currentDate);

  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'biweekly':
      date.setDate(date.getDate() + 14);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }

  return date.toISOString().split('T')[0];
}
