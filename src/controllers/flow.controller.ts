import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import {
  AuthenticatedRequest,
  ApiResponse,
  Flow,
  FlowWithDetails,
  FlowFilters,
  FlowStatsResponse,
  Asset,
  FlowExpenseCategory,
  FlowTemplate,
  ScheduleFrequency,
} from '../types';
import { AppError } from '../middleware/error';
import { addConvertedFieldsToArray, addConvertedFieldsToSingle, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { getViewContext, applyOwnershipFilter, applyOwnershipFilterWithId, buildOwnershipValues } from '../utils/family-context';

// Note: Asset/debt balances are managed explicitly by the application
// Balance triggers were removed in migration 034_remove_balance_triggers.sql

/**
 * Get all flows for the authenticated user
 */
export const getFlows = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ flows: FlowWithDetails[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const {
      page = '1',
      limit = '20',
      type,
      start_date,
      end_date,
      asset_id,
      needs_review,
      exclude_category,
    } = req.query as unknown as FlowFilters & { page: string; limit: string; needs_review?: string; exclude_category?: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 500); // Increased max limit
    const offset = (pageNum - 1) * limitNum;

    // Build query with family/personal context
    let query = supabaseAdmin
      .from('flows')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // Apply ownership filter (family or personal)
    query = applyOwnershipFilter(query, viewContext);

    if (type) query = query.eq('type', type);
    if (start_date) query = query.gte('date', start_date);
    if (end_date) query = query.lte('date', end_date);
    if (asset_id) {
      query = query.or(`from_asset_id.eq.${asset_id},to_asset_id.eq.${asset_id}`);
    }
    if (needs_review === 'true') query = query.eq('needs_review', true);
    if (exclude_category) query = query.neq('category', exclude_category);

    query = query.range(offset, offset + limitNum - 1);

    const { data: flows, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch flows', 500);
    }

    // Get related assets
    const assetIds = new Set<string>();
    const categoryIds = new Set<string>();
    (flows || []).forEach((flow) => {
      if (flow.from_asset_id) assetIds.add(flow.from_asset_id);
      if (flow.to_asset_id) assetIds.add(flow.to_asset_id);
      if (flow.flow_expense_category_id) categoryIds.add(flow.flow_expense_category_id);
    });

    // Fetch assets and expense categories in parallel
    const [assetsResult, categoriesResult] = await Promise.all([
      assetIds.size > 0
        ? supabaseAdmin.from('assets').select('*').in('id', Array.from(assetIds))
        : Promise.resolve({ data: [] }),
      categoryIds.size > 0
        ? supabaseAdmin.from('flow_expense_categories').select('*').in('id', Array.from(categoryIds))
        : Promise.resolve({ data: [] }),
    ]);

    const assetMap = new Map<string, Asset>((assetsResult.data || []).map((a) => [a.id, a]));
    const categoryMap = new Map<string, FlowExpenseCategory>((categoriesResult.data || []).map((c) => [c.id, c]));

    const flowsWithDetails: FlowWithDetails[] = (flows || []).map((flow) => ({
      ...flow,
      from_asset: flow.from_asset_id ? assetMap.get(flow.from_asset_id) || null : null,
      to_asset: flow.to_asset_id ? assetMap.get(flow.to_asset_id) || null : null,
      flow_expense_category: flow.flow_expense_category_id ? categoryMap.get(flow.flow_expense_category_id) || null : null,
    }));

    // Add currency conversion fields if user has convert_all_to_preferred enabled
    const flowsWithConversion = await addConvertedFieldsToArray(flowsWithDetails, userId);

    res.json({
      success: true,
      data: {
        flows: flowsWithConversion,
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch flows' });
  }
};

/**
 * Get a single flow by ID
 */
export const getFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowWithDetails>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Build query with family/personal context
    let query = supabaseAdmin.from('flows').select('*');
    query = applyOwnershipFilterWithId(query, id, viewContext);

    const { data: flow, error } = await query.single();

    if (error || !flow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    // Get related assets and expense category
    const [fromAsset, toAsset, expenseCategory] = await Promise.all([
      flow.from_asset_id
        ? supabaseAdmin.from('assets').select('*').eq('id', flow.from_asset_id).single()
        : { data: null },
      flow.to_asset_id
        ? supabaseAdmin.from('assets').select('*').eq('id', flow.to_asset_id).single()
        : { data: null },
      flow.flow_expense_category_id
        ? supabaseAdmin.from('flow_expense_categories').select('*').eq('id', flow.flow_expense_category_id).single()
        : { data: null },
    ]);

    const flowWithDetails = {
      ...flow,
      from_asset: fromAsset.data || null,
      to_asset: toAsset.data || null,
      flow_expense_category: expenseCategory.data || null,
    };

    // Add currency conversion fields if user has convert_all_to_preferred enabled
    const flowWithConversion = await addConvertedFieldsToSingle(flowWithDetails, userId);

    res.json({
      success: true,
      data: flowWithConversion,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch flow' });
  }
};

/**
 * Create a new flow
 * Validates flow type constraints:
 * - income: to_asset_id must exist, from_asset_id optional (e.g., for dividends linking to stock)
 * - expense: from_asset_id must exist, to_asset_id must be null
 * - transfer: both from_asset_id and to_asset_id must exist
 */
export const createFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Flow>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const {
      type,
      amount,
      currency,
      from_asset_id,
      to_asset_id,
      debt_id,
      category,
      date,
      description,
      recurring_frequency,
      flow_expense_category_id,
      metadata,
      needs_review,
      adjust_balances, // If true, adjusts related asset balances with currency conversion
    } = req.body;

    // Validate required fields
    if (!type || !['income', 'expense', 'transfer', 'other'].includes(type)) {
      res.status(400).json({ success: false, error: 'Valid flow type is required (income, expense, transfer, other)' });
      return;
    }

    if (amount === undefined || amount === null || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount is required' });
      return;
    }

    // Validate recurring_frequency if provided
    const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    if (recurring_frequency && !VALID_FREQUENCIES.includes(recurring_frequency)) {
      res.status(400).json({ success: false, error: 'Invalid recurring frequency' });
      return;
    }

    // Validate flow type constraints
    // Income: to_asset_id required, from_asset_id optional (e.g., dividends can link to stock)
    if (type === 'income') {
      if (!to_asset_id) {
        res.status(400).json({ success: false, error: 'Income flows must have a to_asset_id' });
        return;
      }
    } else if (type === 'expense') {
      if (!from_asset_id) {
        res.status(400).json({ success: false, error: 'Expense flows must have a from_asset_id' });
        return;
      }
      if (to_asset_id) {
        res.status(400).json({ success: false, error: 'Expense flows cannot have a to_asset_id' });
        return;
      }
    } else if (type === 'transfer') {
      if (!from_asset_id || !to_asset_id) {
        res.status(400).json({ success: false, error: 'Transfer flows must have both from_asset_id and to_asset_id' });
        return;
      }
      if (from_asset_id === to_asset_id) {
        res.status(400).json({ success: false, error: 'Cannot transfer to the same asset' });
        return;
      }
    }

    // Verify assets, debt, and expense category belong to user/family (parallel checks)
    // Simple validation using belong_id filter
    const [fromAssetResult, toAssetResult, debtResult, expenseCategoryResult] = await Promise.all([
      from_asset_id
        ? applyOwnershipFilterWithId(supabaseAdmin.from('assets').select('id'), from_asset_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
      to_asset_id
        ? applyOwnershipFilterWithId(supabaseAdmin.from('assets').select('id'), to_asset_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
      debt_id
        ? applyOwnershipFilterWithId(supabaseAdmin.from('debts').select('id'), debt_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
      flow_expense_category_id
        ? applyOwnershipFilterWithId(supabaseAdmin.from('flow_expense_categories').select('id'), flow_expense_category_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
    ]);

    if (from_asset_id && !fromAssetResult.data) {
      res.status(400).json({ success: false, error: 'From asset not found or does not belong to user' });
      return;
    }

    if (to_asset_id && !toAssetResult.data) {
      res.status(400).json({ success: false, error: 'To asset not found or does not belong to user' });
      return;
    }

    if (debt_id && !debtResult.data) {
      res.status(400).json({ success: false, error: 'Debt not found or does not belong to user' });
      return;
    }

    if (flow_expense_category_id && !expenseCategoryResult.data) {
      res.status(400).json({ success: false, error: 'Expense category not found or does not belong to user' });
      return;
    }

    // Get ownership values based on view mode (personal or family)
    const ownershipValues = buildOwnershipValues(viewContext);

    // Create recurring schedule FIRST if recurring_frequency is set (for consistency)
    let scheduleId: string | null = null;
    if (recurring_frequency && recurring_frequency !== 'none') {
      const flowDate = date || new Date().toISOString().split('T')[0];
      const nextRunDate = calculateNextRunDate(flowDate, recurring_frequency as ScheduleFrequency);

      const flowTemplate: FlowTemplate = {
        type,
        amount: parseFloat(amount),
        currency: currency || 'USD',
        from_asset_id: from_asset_id || null,
        to_asset_id: to_asset_id || null,
        debt_id: debt_id || null,
        category: category?.trim() || null,
        description: description?.trim() || null,
        flow_expense_category_id: flow_expense_category_id || null,
        metadata: metadata || null,
      };

      const { data: schedule, error: scheduleError } = await supabaseAdmin
        .from('recurring_schedules')
        .insert({
          ...ownershipValues,
          source_flow_id: null, // Will update after flow is created
          frequency: recurring_frequency,
          next_run_date: nextRunDate,
          is_active: true,
          flow_template: flowTemplate,
        })
        .select()
        .single();

      if (scheduleError || !schedule) {
        console.error('Schedule create error:', scheduleError);
        throw new AppError('Failed to create recurring schedule', 500);
      }

      scheduleId = schedule.id;
    }

    // Now create the flow with schedule_id included
    const { data: flow, error } = await supabaseAdmin
      .from('flows')
      .insert({
        ...ownershipValues,
        type,
        amount: parseFloat(amount),
        currency: currency || 'USD',
        from_asset_id: from_asset_id || null,
        to_asset_id: to_asset_id || null,
        debt_id: debt_id || null,
        category: category?.trim() || null,
        date: date || new Date().toISOString().split('T')[0],
        description: description?.trim() || null,
        flow_expense_category_id: flow_expense_category_id || null,
        metadata: metadata || null,
        needs_review: needs_review || false,
        schedule_id: scheduleId,
      })
      .select()
      .single();

    if (error) {
      console.error('Flow create error:', error);
      // If flow creation fails and we created a schedule, clean it up
      if (scheduleId) {
        await supabaseAdmin.from('recurring_schedules').delete().eq('id', scheduleId);
      }
      throw new AppError('Failed to create flow', 500);
    }

    // Update schedule with source_flow_id now that we have the flow id
    if (scheduleId) {
      await supabaseAdmin
        .from('recurring_schedules')
        .update({ source_flow_id: flow.id })
        .eq('id', scheduleId);
    }

    // Adjust asset balances if requested
    if (adjust_balances) {
      const flowAmount = parseFloat(amount);
      const flowCurrency = currency || 'USD';
      const flowShares = metadata?.shares ? parseFloat(metadata.shares as string) : null;

      // Share-based asset types use shares for balance, not currency amount
      const SHARE_BASED_TYPES = ['stock', 'etf', 'crypto'];

      // Collect all asset IDs that need to be updated
      const assetIds: string[] = [];
      if (from_asset_id) assetIds.push(from_asset_id);
      if (to_asset_id) assetIds.push(to_asset_id);

      if (assetIds.length > 0) {
        // Fetch all assets with their currencies and types
        const { data: assets } = await supabaseAdmin
          .from('assets')
          .select('id, balance, currency, type')
          .in('id', assetIds);

        const assetMap = new Map(assets?.map(a => [a.id, a]) || []);

        // Collect all currencies for exchange rates
        const currencies = new Set<string>([flowCurrency.toLowerCase()]);
        assets?.forEach(a => currencies.add((a.currency || 'USD').toLowerCase()));

        // Get exchange rates
        const rateMap = await getExchangeRates(Array.from(currencies));

        // Helper to update asset balance
        // For share-based assets (stock, etf, crypto): uses shares count
        // For currency-based assets: uses amount with currency conversion
        const updateAssetBalance = async (assetId: string, delta: number, isShareBased: boolean, sharesDelta: number | null) => {
          const asset = assetMap.get(assetId);
          if (!asset) return;

          // For share-based assets, use shares directly (no currency conversion)
          if (isShareBased && sharesDelta !== null) {
            const newBalance = Number(asset.balance) + sharesDelta;
            await supabaseAdmin
              .from('assets')
              .update({ balance: newBalance, updated_at: new Date().toISOString() })
              .eq('id', assetId);
            return;
          }

          // For currency-based assets, convert if needed
          const assetCurrency = asset.currency || 'USD';
          let convertedDelta = delta;

          // Convert delta from flow currency to asset currency if different
          if (flowCurrency.toLowerCase() !== assetCurrency.toLowerCase()) {
            const conversion = convertAmount(Math.abs(delta), flowCurrency, assetCurrency, rateMap);
            if (conversion) {
              convertedDelta = delta >= 0 ? conversion.converted : -conversion.converted;
            }
          }

          const newBalance = Number(asset.balance) + convertedDelta;
          await supabaseAdmin
            .from('assets')
            .update({ balance: newBalance, updated_at: new Date().toISOString() })
            .eq('id', assetId);
        };

        // Handle balance adjustments based on flow type
        if (type === 'income') {
          // Income increases to_asset balance
          if (to_asset_id) {
            const toAsset = assetMap.get(to_asset_id);
            const isShareBased = toAsset && SHARE_BASED_TYPES.includes(toAsset.type);
            await updateAssetBalance(to_asset_id, flowAmount, isShareBased || false, flowShares);
          }
        } else if (type === 'expense') {
          // Expense decreases from_asset balance
          if (from_asset_id) {
            const fromAsset = assetMap.get(from_asset_id);
            const isShareBased = fromAsset && SHARE_BASED_TYPES.includes(fromAsset.type);
            await updateAssetBalance(from_asset_id, -flowAmount, isShareBased || false, flowShares ? -flowShares : null);
          }
        } else if (type === 'transfer') {
          // Transfer: from_asset decreases, to_asset increases
          const updates: Promise<void>[] = [];
          if (from_asset_id) {
            const fromAsset = assetMap.get(from_asset_id);
            const isShareBased = fromAsset && SHARE_BASED_TYPES.includes(fromAsset.type);
            updates.push(updateAssetBalance(from_asset_id, -flowAmount, isShareBased || false, flowShares ? -flowShares : null));
          }
          if (to_asset_id) {
            const toAsset = assetMap.get(to_asset_id);
            const isShareBased = toAsset && SHARE_BASED_TYPES.includes(toAsset.type);
            updates.push(updateAssetBalance(to_asset_id, flowAmount, isShareBased || false, flowShares));
          }
          await Promise.all(updates);
        }
      }
    }

    res.status(201).json({ success: true, data: flow });
  } catch (err) {
    console.error('Flow create unexpected error:', err);
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create flow' });
  }
};

/**
 * Update an existing flow
 * Optionally adjusts related asset balances when amount changes
 */
export const updateFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Flow>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;
    const {
      type,
      amount,
      currency,
      from_asset_id,
      to_asset_id,
      debt_id,
      category,
      date,
      description,
      recurring_frequency,
      flow_expense_category_id,
      metadata,
      needs_review,
      adjust_balances, // New flag to adjust related asset balances
    } = req.body;

    // Check if flow exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('flows').select('*');
    checkQuery = applyOwnershipFilterWithId(checkQuery, id, viewContext);

    const { data: existingFlow, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingFlow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    // Build updates
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const newType = type !== undefined ? type : existingFlow.type;
    const newFromAssetId = from_asset_id !== undefined ? from_asset_id : existingFlow.from_asset_id;
    const newToAssetId = to_asset_id !== undefined ? to_asset_id : existingFlow.to_asset_id;

    // Validate flow type constraints if type or asset references are being updated
    // Income: to_asset_id required, from_asset_id optional (e.g., dividends can link to stock)
    if (type !== undefined || from_asset_id !== undefined || to_asset_id !== undefined) {
      if (newType === 'income') {
        if (!newToAssetId) {
          res.status(400).json({ success: false, error: 'Income flows must have a to_asset_id' });
          return;
        }
      } else if (newType === 'expense') {
        if (!newFromAssetId) {
          res.status(400).json({ success: false, error: 'Expense flows must have a from_asset_id' });
          return;
        }
        if (newToAssetId) {
          res.status(400).json({ success: false, error: 'Expense flows cannot have a to_asset_id' });
          return;
        }
      } else if (newType === 'transfer') {
        if (!newFromAssetId || !newToAssetId) {
          res.status(400).json({ success: false, error: 'Transfer flows must have both from_asset_id and to_asset_id' });
          return;
        }
        if (newFromAssetId === newToAssetId) {
          res.status(400).json({ success: false, error: 'Cannot transfer to the same asset' });
          return;
        }
      }
    }

    // Verify new assets, debt, and expense category belong to user/family (parallel checks)
    const checkFromAsset = from_asset_id !== undefined && from_asset_id !== null;
    const checkToAsset = to_asset_id !== undefined && to_asset_id !== null;
    const checkDebt = debt_id !== undefined && debt_id !== null;
    const checkExpenseCategory = flow_expense_category_id !== undefined && flow_expense_category_id !== null;

    // Simple validation using belong_id filter
    const [fromAssetResult, toAssetResult, debtResult, expenseCategoryResult] = await Promise.all([
      checkFromAsset
        ? applyOwnershipFilterWithId(supabaseAdmin.from('assets').select('id'), from_asset_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
      checkToAsset
        ? applyOwnershipFilterWithId(supabaseAdmin.from('assets').select('id'), to_asset_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
      checkDebt
        ? applyOwnershipFilterWithId(supabaseAdmin.from('debts').select('id'), debt_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
      checkExpenseCategory
        ? applyOwnershipFilterWithId(supabaseAdmin.from('flow_expense_categories').select('id'), flow_expense_category_id, viewContext).single()
        : Promise.resolve({ data: { id: null } }),
    ]);

    if (checkFromAsset && !fromAssetResult.data) {
      res.status(400).json({ success: false, error: 'From asset not found or does not belong to user' });
      return;
    }

    if (checkToAsset && !toAssetResult.data) {
      res.status(400).json({ success: false, error: 'To asset not found or does not belong to user' });
      return;
    }

    if (checkDebt && !debtResult.data) {
      res.status(400).json({ success: false, error: 'Debt not found or does not belong to user' });
      return;
    }

    if (checkExpenseCategory && !expenseCategoryResult.data) {
      res.status(400).json({ success: false, error: 'Expense category not found or does not belong to user' });
      return;
    }

    if (type !== undefined) updates.type = type;
    if (amount !== undefined) updates.amount = parseFloat(amount);
    if (currency !== undefined) updates.currency = currency;
    if (from_asset_id !== undefined) updates.from_asset_id = from_asset_id || null;
    if (to_asset_id !== undefined) updates.to_asset_id = to_asset_id || null;
    if (debt_id !== undefined) updates.debt_id = debt_id || null;
    if (category !== undefined) updates.category = category?.trim() || null;
    if (date !== undefined) updates.date = date;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (flow_expense_category_id !== undefined) updates.flow_expense_category_id = flow_expense_category_id || null;
    if (metadata !== undefined) updates.metadata = metadata;
    if (needs_review !== undefined) updates.needs_review = needs_review;

    // Handle recurring schedule BEFORE updating flow (for consistency)
    if (recurring_frequency && recurring_frequency !== 'none') {
      const flowDate = date || existingFlow.date;
      const nextRunDate = calculateNextRunDate(flowDate, recurring_frequency as ScheduleFrequency);

      const flowTemplate: FlowTemplate = {
        type: type || existingFlow.type,
        amount: amount !== undefined ? parseFloat(amount) : existingFlow.amount,
        currency: currency || existingFlow.currency || 'USD',
        from_asset_id: from_asset_id !== undefined ? from_asset_id : existingFlow.from_asset_id,
        to_asset_id: to_asset_id !== undefined ? to_asset_id : existingFlow.to_asset_id,
        debt_id: debt_id !== undefined ? debt_id : existingFlow.debt_id,
        category: category !== undefined ? category?.trim() || null : existingFlow.category,
        description: description !== undefined ? description?.trim() || null : existingFlow.description,
        flow_expense_category_id: flow_expense_category_id !== undefined ? flow_expense_category_id : existingFlow.flow_expense_category_id,
        metadata: metadata !== undefined ? metadata : existingFlow.metadata,
      };

      if (existingFlow.schedule_id) {
        // Update existing schedule
        const { error: scheduleError } = await supabaseAdmin
          .from('recurring_schedules')
          .update({
            frequency: recurring_frequency,
            next_run_date: nextRunDate,
            flow_template: flowTemplate,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingFlow.schedule_id);

        if (scheduleError) {
          console.error('Schedule update error:', scheduleError);
          throw new AppError('Failed to update recurring schedule', 500);
        }
      } else {
        // Create new schedule first with ownership values
        const ownershipValues = buildOwnershipValues(viewContext);
        const { data: schedule, error: scheduleError } = await supabaseAdmin
          .from('recurring_schedules')
          .insert({
            ...ownershipValues,
            source_flow_id: id,
            frequency: recurring_frequency,
            next_run_date: nextRunDate,
            is_active: true,
            flow_template: flowTemplate,
          })
          .select()
          .single();

        if (scheduleError || !schedule) {
          console.error('Schedule create error:', scheduleError);
          throw new AppError('Failed to create recurring schedule', 500);
        }

        // Include schedule_id in the flow update
        updates.schedule_id = schedule.id;
      }
    }

    // Now update the flow (including schedule_id if new schedule was created)
    const { data: flow, error } = await supabaseAdmin
      .from('flows')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Flow update error:', error);
      throw new AppError('Failed to update flow', 500);
    }

    // Adjust asset balances if requested and amount changed
    if (adjust_balances && amount !== undefined) {
      const oldAmount = Number(existingFlow.amount);
      const newAmount = parseFloat(amount);
      const difference = newAmount - oldAmount;
      const flowCurrency = existingFlow.currency || 'USD';

      if (difference !== 0) {
        // Collect all asset IDs that need to be updated
        const assetIds: string[] = [];
        if (existingFlow.from_asset_id) assetIds.push(existingFlow.from_asset_id);
        if (existingFlow.to_asset_id) assetIds.push(existingFlow.to_asset_id);

        // Fetch all assets with their currencies
        const { data: assets } = await supabaseAdmin
          .from('assets')
          .select('id, balance, currency')
          .in('id', assetIds);

        const assetMap = new Map(assets?.map(a => [a.id, a]) || []);

        // Collect all currencies for exchange rates
        const currencies = new Set<string>([flowCurrency.toLowerCase()]);
        assets?.forEach(a => currencies.add((a.currency || 'USD').toLowerCase()));

        // Get exchange rates
        const rateMap = await getExchangeRates(Array.from(currencies));

        // Helper to update asset balance with currency conversion
        const updateAssetBalance = async (assetId: string, delta: number) => {
          const asset = assetMap.get(assetId);
          if (!asset) return;

          const assetCurrency = asset.currency || 'USD';
          let convertedDelta = delta;

          // Convert delta from flow currency to asset currency if different
          if (flowCurrency.toLowerCase() !== assetCurrency.toLowerCase()) {
            const conversion = convertAmount(Math.abs(delta), flowCurrency, assetCurrency, rateMap);
            if (conversion) {
              convertedDelta = delta >= 0 ? conversion.converted : -conversion.converted;
            }
          }

          const newBalance = Number(asset.balance) + convertedDelta;
          await supabaseAdmin
            .from('assets')
            .update({ balance: newBalance, updated_at: new Date().toISOString() })
            .eq('id', assetId);
        };

        // Handle balance adjustments based on flow type
        // Income: money goes TO to_asset (increase balance)
        // Expense: money goes FROM from_asset (decrease balance)
        // Transfer: money goes FROM from_asset TO to_asset

        const flowType = existingFlow.type;

        if (flowType === 'income') {
          // Income increases to_asset balance
          // If amount increased, add more to to_asset
          if (existingFlow.to_asset_id) {
            await updateAssetBalance(existingFlow.to_asset_id, difference);
          }
        } else if (flowType === 'expense') {
          // Expense decreases from_asset balance
          // If expense amount increased, subtract more from from_asset
          if (existingFlow.from_asset_id) {
            await updateAssetBalance(existingFlow.from_asset_id, -difference);
          }
        } else if (flowType === 'transfer') {
          // Transfer: from_asset decreases, to_asset increases
          // If amount increased, subtract more from from_asset and add more to to_asset
          const updates: Promise<void>[] = [];
          if (existingFlow.from_asset_id) {
            updates.push(updateAssetBalance(existingFlow.from_asset_id, -difference));
          }
          if (existingFlow.to_asset_id) {
            updates.push(updateAssetBalance(existingFlow.to_asset_id, difference));
          }
          await Promise.all(updates);
        }
      }
    }

    res.json({ success: true, data: flow });
  } catch (err) {
    console.error('Flow update unexpected error:', err);
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to update flow' });
  }
};

/**
 * Delete a flow
 */
export const deleteFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if flow exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('flows').select('id');
    checkQuery = applyOwnershipFilterWithId(checkQuery, id, viewContext);

    const { data: existingFlow, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingFlow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    const { error } = await supabaseAdmin.from('flows').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete flow', 500);
    }

    res.json({ success: true, message: 'Flow deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete flow' });
  }
};

/**
 * Get flow statistics for a date range
 */
export const getFlowStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowStatsResponse>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { start_date, end_date, currency = 'USD' } = req.query as {
      start_date?: string;
      end_date?: string;
      currency?: string;
    };

    // Default to current month if no dates provided
    const now = new Date();
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const startDate = start_date || defaultStartDate;
    const endDate = end_date || defaultEndDate;

    // Get all flows in the date range (excluding adjustments which are balance corrections)
    let query = supabaseAdmin
      .from('flows')
      .select('type, amount, currency, category')
      .gte('date', startDate)
      .lte('date', endDate)
      .neq('category', 'adjustment');

    // Apply ownership filter (family or personal)
    query = applyOwnershipFilter(query, viewContext);

    const { data: flows, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch flow stats', 500);
    }

    // Calculate totals (simplified - assumes same currency for now)
    let totalIncome = 0;
    let totalExpense = 0;
    let totalTransfer = 0;

    (flows || []).forEach((flow) => {
      const amount = Number(flow.amount);
      if (flow.type === 'income') totalIncome += amount;
      else if (flow.type === 'expense') totalExpense += amount;
      else if (flow.type === 'transfer') totalTransfer += amount;
    });

    res.json({
      success: true,
      data: {
        total_income: totalIncome,
        total_expense: totalExpense,
        total_transfer: totalTransfer,
        net_flow: totalIncome - totalExpense,
        currency,
        start_date: startDate,
        end_date: endDate,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch flow stats' });
  }
};

/**
 * Mark a flow as reviewed (sets needs_review to false)
 */
export const markFlowReviewed = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Flow>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if flow exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('flows').select('id');
    checkQuery = applyOwnershipFilterWithId(checkQuery, id, viewContext);

    const { data: existingFlow, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingFlow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    const { data: flow, error } = await supabaseAdmin
      .from('flows')
      .update({ needs_review: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new AppError('Failed to mark flow as reviewed', 500);
    }

    res.json({ success: true, data: flow });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to mark flow as reviewed' });
  }
};

/**
 * Get count of flows needing review
 */
export const getFlowsNeedingReviewCount = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ count: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    let query = supabaseAdmin
      .from('flows')
      .select('*', { count: 'exact', head: true })
      .eq('needs_review', true);

    // Apply ownership filter (family or personal)
    query = applyOwnershipFilter(query, viewContext);

    const { count, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch review count', 500);
    }

    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch review count' });
  }
};

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
