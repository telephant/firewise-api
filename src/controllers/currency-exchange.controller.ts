import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';

interface CurrencyExchange {
  code: string;
  name: string;
  rate: number;
}

/**
 * Search currencies from the global currency_exchange table
 * GET /currency-exchange/search?q=usd&limit=20
 */
export const searchCurrencies = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<CurrencyExchange[]>>
): Promise<void> => {
  try {
    const { q, limit = '20' } = req.query as { q?: string; limit?: string };
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);

    let query = supabaseAdmin
      .from('currency_exchange')
      .select('code, name, rate')
      .order('code', { ascending: true })
      .limit(limitNum);

    if (q && typeof q === 'string' && q.trim()) {
      const search = q.trim().toLowerCase();
      // Search by code or name (case-insensitive)
      query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error searching currencies:', error);
      res.status(500).json({ success: false, error: 'Failed to search currencies' });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Error in searchCurrencies:', err);
    res.status(500).json({ success: false, error: 'Failed to search currencies' });
  }
};

/**
 * Get a single currency by code
 * GET /currency-exchange/:code
 */
export const getCurrency = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<CurrencyExchange>>
): Promise<void> => {
  try {
    const { code } = req.params;

    const { data, error } = await supabaseAdmin
      .from('currency_exchange')
      .select('code, name, rate')
      .eq('code', code.toLowerCase())
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Currency not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error in getCurrency:', err);
    res.status(500).json({ success: false, error: 'Failed to get currency' });
  }
};
