import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Currency } from '../types';
import { AppError } from '../middleware/error';

export const getCurrencies = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Currency[]>>
): Promise<void> => {
  try {
    const { ledgerId } = req.params;

    const { data: currencies, error } = await supabaseAdmin
      .from('currencies')
      .select('*')
      .eq('ledger_id', ledgerId)
      .order('code', { ascending: true });

    if (error) {
      throw new AppError('Failed to fetch currencies', 500);
    }

    res.json({ success: true, data: currencies || [] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch currencies' });
  }
};

export const createCurrency = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Currency>>
): Promise<void> => {
  try {
    const { ledgerId } = req.params;
    const userId = req.user!.id;
    const { code, name, rate } = req.body;

    if (!code || typeof code !== 'string' || code.trim().length !== 3) {
      res.status(400).json({ success: false, error: 'Valid 3-letter currency code is required' });
      return;
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Currency name is required' });
      return;
    }

    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive rate is required' });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('currencies')
      .select('id')
      .eq('code', code.toUpperCase().trim())
      .eq('ledger_id', ledgerId)
      .single();

    if (existing) {
      res.status(400).json({ success: false, error: 'Currency code already exists in this ledger' });
      return;
    }

    const { data: currency, error } = await supabaseAdmin
      .from('currencies')
      .insert({
        code: code.toUpperCase().trim(),
        name: name.trim(),
        rate: rateNum,
        ledger_id: ledgerId,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !currency) {
      throw new AppError('Failed to create currency', 500);
    }

    res.status(201).json({ success: true, data: currency });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create currency' });
  }
};

export const deleteCurrency = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const { ledgerId, id } = req.params;

    const { data: currency, error: fetchError } = await supabaseAdmin
      .from('currencies')
      .select('ledger_id')
      .eq('id', id)
      .eq('ledger_id', ledgerId)
      .single();

    if (fetchError || !currency) {
      res.status(404).json({ success: false, error: 'Currency not found' });
      return;
    }

    const { error } = await supabaseAdmin.from('currencies').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete currency', 500);
    }

    res.json({ success: true, message: 'Currency deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete currency' });
  }
};
