import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, PaymentMethod } from '../types';
import { AppError } from '../middleware/error';

export const getPaymentMethods = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PaymentMethod[]>>
): Promise<void> => {
  try {
    const { ledgerId } = req.params;

    const { data: paymentMethods, error } = await supabaseAdmin
      .from('payment_methods')
      .select('*')
      .eq('ledger_id', ledgerId)
      .order('name', { ascending: true });

    if (error) {
      throw new AppError('Failed to fetch payment methods', 500);
    }

    res.json({ success: true, data: paymentMethods || [] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch payment methods' });
  }
};

export const createPaymentMethod = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PaymentMethod>>
): Promise<void> => {
  try {
    const { ledgerId } = req.params;
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('payment_methods')
      .select('id')
      .eq('name', name.trim())
      .eq('ledger_id', ledgerId)
      .single();

    if (existing) {
      res.status(400).json({ success: false, error: 'Payment method already exists' });
      return;
    }

    const { data: paymentMethod, error } = await supabaseAdmin
      .from('payment_methods')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        ledger_id: ledgerId,
      })
      .select()
      .single();

    if (error || !paymentMethod) {
      throw new AppError('Failed to create payment method', 500);
    }

    res.status(201).json({ success: true, data: paymentMethod });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create payment method' });
  }
};

export const updatePaymentMethod = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PaymentMethod>>
): Promise<void> => {
  try {
    const { ledgerId, id } = req.params;
    const { name, description } = req.body;

    // Check if payment method exists
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('payment_methods')
      .select('*')
      .eq('id', id)
      .eq('ledger_id', ledgerId)
      .single();

    if (fetchError || !existing) {
      res.status(404).json({ success: false, error: 'Payment method not found' });
      return;
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    // Check if another payment method with the same name exists
    if (name !== undefined) {
      const { data: duplicate } = await supabaseAdmin
        .from('payment_methods')
        .select('id')
        .eq('name', name.trim())
        .eq('ledger_id', ledgerId)
        .neq('id', id)
        .single();

      if (duplicate) {
        res.status(400).json({ success: false, error: 'Payment method name already exists' });
        return;
      }
    }

    const updateData: Partial<PaymentMethod> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;

    const { data: paymentMethod, error } = await supabaseAdmin
      .from('payment_methods')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !paymentMethod) {
      throw new AppError('Failed to update payment method', 500);
    }

    res.json({ success: true, data: paymentMethod });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to update payment method' });
  }
};

export const getPaymentMethodUsage = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ count: number }>>
): Promise<void> => {
  try {
    const { ledgerId, id } = req.params;

    // Verify payment method exists and belongs to ledger
    const { data: paymentMethod, error: fetchError } = await supabaseAdmin
      .from('payment_methods')
      .select('id')
      .eq('id', id)
      .eq('ledger_id', ledgerId)
      .single();

    if (fetchError || !paymentMethod) {
      res.status(404).json({ success: false, error: 'Payment method not found' });
      return;
    }

    // Count expenses using this payment method
    const { count, error } = await supabaseAdmin
      .from('expenses')
      .select('*', { count: 'exact', head: true })
      .eq('payment_method_id', id);

    if (error) {
      throw new AppError('Failed to get payment method usage', 500);
    }

    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to get payment method usage' });
  }
};

export const deletePaymentMethod = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const { ledgerId, id } = req.params;

    const { data: paymentMethod, error: fetchError } = await supabaseAdmin
      .from('payment_methods')
      .select('ledger_id')
      .eq('id', id)
      .eq('ledger_id', ledgerId)
      .single();

    if (fetchError || !paymentMethod) {
      res.status(404).json({ success: false, error: 'Payment method not found' });
      return;
    }

    // Set payment_method_id to null for all expenses using this payment method
    await supabaseAdmin
      .from('expenses')
      .update({ payment_method_id: null })
      .eq('payment_method_id', id);

    const { error } = await supabaseAdmin.from('payment_methods').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete payment method', 500);
    }

    res.json({ success: true, message: 'Payment method deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete payment method' });
  }
};
