import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, PaymentMethod } from '../types';
import { AppError } from '../middleware/error';

export const getPaymentMethods = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PaymentMethod[]>>
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { data: paymentMethods, error } = await supabaseAdmin
      .from('payment_methods')
      .select('*')
      .or(`created_by.eq.${userId},created_by.is.null`)
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
    const userId = req.user!.id;
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('payment_methods')
      .select('id')
      .eq('name', name.trim())
      .eq('created_by', userId)
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
        created_by: userId,
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
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: paymentMethod, error: fetchError } = await supabaseAdmin
      .from('payment_methods')
      .select('created_by')
      .eq('id', id)
      .single();

    if (fetchError || !paymentMethod) {
      res.status(404).json({ success: false, error: 'Payment method not found' });
      return;
    }

    if (paymentMethod.created_by !== userId) {
      res.status(403).json({ success: false, error: 'Cannot delete this payment method' });
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
