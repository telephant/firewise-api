import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { Dividend } from '../types/portfolio';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Verify that a portfolio belongs to the current user/family context.
 */
async function verifyPortfolioOwnership(portfolioId: string, belongId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('portfolios')
    .select('id')
    .eq('id', portfolioId)
    .eq('belong_id', belongId)
    .single();

  if (!data) {
    throw new AppError('Portfolio not found', 404);
  }
}

// GET /api/portfolios/:id/dividends
// Query params: year?, month?
export const listDividends = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Dividend[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const { year, month } = req.query;

    let query = supabaseAdmin
      .from('dividends')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('ex_date', { ascending: false });

    if (year) {
      const y = String(year);
      query = query.gte('ex_date', `${y}-01-01`).lte('ex_date', `${y}-12-31`);
    }

    if (month && year) {
      const y = String(year);
      const m = String(month).padStart(2, '0');
      const daysInMonth = new Date(Number(y), Number(m), 0).getDate();
      query = query
        .gte('ex_date', `${y}-${m}-01`)
        .lte('ex_date', `${y}-${m}-${daysInMonth}`);
    }

    const { data, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch dividends', 500);
    }

    const dividendList = data || [];

    if (dividendList.length > 0) {
      // Collect unique currencies
      const currencies = new Set<string>(['usd']);
      dividendList.forEach(d => currencies.add((d.currency || 'USD').toLowerCase()));

      const rateMap = await getExchangeRates(Array.from(currencies));

      function toUSD(amount: number, fromCurrency: string): number {
        if (fromCurrency.toLowerCase() === 'usd') return amount;
        const result = convertAmount(amount, fromCurrency, 'USD', rateMap);
        return result ? result.converted : amount;
      }

      const enriched = dividendList.map(d => ({
        ...d,
        amount_usd: toUSD(d.total_amount || 0, d.currency || 'USD'),
      }));

      res.json({ success: true, data: enriched });
      return;
    }

    res.json({ success: true, data: [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch dividends' });
  }
};

// POST /api/portfolios/:id/dividends — manual entry
export const createDividend = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Dividend>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const {
      ticker,
      shares_at_exdate,
      amount_per_share,
      total_amount,
      currency,
      tax_rate,
      ex_date,
      pay_date,
    } = req.body;

    if (!ticker || amount_per_share === undefined || total_amount === undefined || !currency || !ex_date) {
      throw new AppError(
        'ticker, amount_per_share, total_amount, currency, and ex_date are required',
        400
      );
    }

    const taxRate = Number(tax_rate) || 0;
    const taxWithheld = Number(total_amount) * (taxRate / 100);

    const { data, error } = await supabaseAdmin
      .from('dividends')
      .insert({
        portfolio_id: portfolioId,
        ticker: ticker.toUpperCase(),
        shares_at_exdate: shares_at_exdate !== undefined ? Number(shares_at_exdate) : 0,
        amount_per_share: Number(amount_per_share),
        total_amount: Number(total_amount),
        currency,
        tax_rate: taxRate,
        tax_withheld: taxWithheld,
        ex_date,
        pay_date: pay_date || null,
        source: 'manual',
      })
      .select()
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new AppError('A dividend entry for this ticker and ex-date already exists', 409);
      }
      throw new AppError('Failed to create dividend', 500);
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create dividend' });
  }
};

// PUT /api/portfolios/:id/dividends/:dividendId
export const updateDividend = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Dividend>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;
    const dividendId = req.params.dividendId;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const {
      ticker,
      shares_at_exdate,
      amount_per_share,
      total_amount,
      currency,
      tax_rate,
      ex_date,
      pay_date,
    } = req.body;

    const updates: Record<string, unknown> = {};
    if (ticker !== undefined) updates.ticker = ticker.toUpperCase();
    if (shares_at_exdate !== undefined) updates.shares_at_exdate = Number(shares_at_exdate);
    if (amount_per_share !== undefined) updates.amount_per_share = Number(amount_per_share);
    if (total_amount !== undefined) updates.total_amount = Number(total_amount);
    if (currency !== undefined) updates.currency = currency;
    if (tax_rate !== undefined) {
      updates.tax_rate = Number(tax_rate);
      // Recalculate tax_withheld if total_amount is also being updated or use current
      const base = total_amount !== undefined ? Number(total_amount) : undefined;
      if (base !== undefined) {
        updates.tax_withheld = base * (Number(tax_rate) / 100);
      }
    }
    if (ex_date !== undefined) updates.ex_date = ex_date;
    if (pay_date !== undefined) updates.pay_date = pay_date;

    const { data, error } = await supabaseAdmin
      .from('dividends')
      .update(updates)
      .eq('id', dividendId)
      .eq('portfolio_id', portfolioId)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Dividend not found', 404);
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update dividend' });
  }
};

// DELETE /api/portfolios/:id/dividends/:dividendId
export const deleteDividend = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<null>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;
    const dividendId = req.params.dividendId;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const { error } = await supabaseAdmin
      .from('dividends')
      .delete()
      .eq('id', dividendId)
      .eq('portfolio_id', portfolioId);

    if (error) {
      throw new AppError('Failed to delete dividend', 500);
    }

    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete dividend' });
  }
};
