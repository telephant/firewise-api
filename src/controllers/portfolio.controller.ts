import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { Portfolio } from '../types/portfolio';

// GET /api/portfolios — list portfolios for current user/family
export const listPortfolios = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Portfolio[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);

    const { data, error } = await supabaseAdmin
      .from('portfolios')
      .select('*')
      .eq('belong_id', ctx.belongId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch portfolios', 500);
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch portfolios' });
  }
};

// POST /api/portfolios — create portfolio
export const createPortfolio = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Portfolio>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { name, currency, description } = req.body;

    if (!name || !currency) {
      throw new AppError('name and currency are required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('portfolios')
      .insert({
        belong_id: ctx.belongId,
        name,
        currency,
        description: description || null,
      })
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Failed to create portfolio', 500);
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create portfolio' });
  }
};

// GET /api/portfolios/:id — get single portfolio (verify belong_id)
export const getPortfolio = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Portfolio>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('portfolios')
      .select('*')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (error || !data) {
      throw new AppError('Portfolio not found', 404);
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch portfolio' });
  }
};

// PUT /api/portfolios/:id — update portfolio
export const updatePortfolio = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Portfolio>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;
    const { name, currency, description } = req.body;

    // Verify ownership first
    const { data: existing } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!existing) {
      throw new AppError('Portfolio not found', 404);
    }

    const updates: Partial<Portfolio> = {};
    if (name !== undefined) updates.name = name;
    if (currency !== undefined) updates.currency = currency;
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabaseAdmin
      .from('portfolios')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Failed to update portfolio', 500);
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update portfolio' });
  }
};

// DELETE /api/portfolios/:id — delete portfolio
export const deletePortfolio = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<null>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { id } = req.params;

    // Verify ownership first
    const { data: existing } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', id)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!existing) {
      throw new AppError('Portfolio not found', 404);
    }

    const { error } = await supabaseAdmin.from('portfolios').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete portfolio', 500);
    }

    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete portfolio' });
  }
};
