import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Currency } from '../types';
import { AppError } from '../middleware/error';

export const getCurrencies = async (
  _req: AuthenticatedRequest,
  res: Response<ApiResponse<Currency[]>>
): Promise<void> => {
  try {
    const { data: currencies, error } = await supabaseAdmin
      .from('currencies')
      .select('*')
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
      .single();

    if (existing) {
      res.status(400).json({ success: false, error: 'Currency code already exists' });
      return;
    }

    const { data: currency, error } = await supabaseAdmin
      .from('currencies')
      .insert({
        code: code.toUpperCase().trim(),
        name: name.trim(),
        rate: rateNum,
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
