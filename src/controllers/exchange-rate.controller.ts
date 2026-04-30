import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';

interface ExchangeRatesResponse {
  base: string;
  rates: Record<string, number>;
}

// GET /api/exchange-rates?base=USD&codes=HKD,TWD,EUR
export const getExchangeRates = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ExchangeRatesResponse>>
): Promise<void> => {
  try {
    // Auth required (no ownership check needed)
    await getViewContext(req);

    const baseParam = (req.query.base as string) || 'USD';
    const codesParam = req.query.codes as string | undefined;

    const base = baseParam.toUpperCase();
    const requestedCodes = codesParam
      ? codesParam.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
      : [];

    // Fetch all relevant currencies (base + requested targets)
    const allCodes = Array.from(new Set([base, ...requestedCodes])).map((c) => c.toLowerCase());

    const { data, error } = await supabaseAdmin
      .from('currency_exchange')
      .select('code, rate')
      .in('code', allCodes);

    if (error) {
      throw new AppError('Failed to fetch exchange rates', 500);
    }

    const rateMap = new Map<string, number>();
    for (const row of data || []) {
      rateMap.set((row.code as string).toUpperCase(), row.rate as number);
    }

    const baseRate = rateMap.get(base);
    if (baseRate == null) {
      throw new AppError(`Base currency "${base}" not found`, 404);
    }

    // Compute rates relative to base
    const rates: Record<string, number> = {};
    const targets = requestedCodes.length > 0 ? requestedCodes : Array.from(rateMap.keys()).filter((c) => c !== base);

    for (const code of targets) {
      if (code === base) continue;
      const targetRate = rateMap.get(code);
      if (targetRate == null) {
        throw new AppError(`Currency "${code}" not found`, 404);
      }
      rates[code] = targetRate / baseRate;
    }

    res.json({ success: true, data: { base, rates } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch exchange rates' });
  }
};
