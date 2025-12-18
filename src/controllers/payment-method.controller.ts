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
