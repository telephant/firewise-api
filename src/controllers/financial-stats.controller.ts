import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getFinancialStats, FinancialStats, clearFinancialStatsCache } from '../utils/financial-stats';
import { getViewContext } from '../utils/family-context';

/**
 * Get Financial Stats
 * Returns cached expense/income statistics for dashboard components
 */
export const getStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FinancialStats>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const viewContext = await getViewContext(req);

    // Check if force refresh is requested
    const forceRefresh = req.query.refresh === 'true';

    const stats = await getFinancialStats(viewContext, forceRefresh);

    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('Error in getFinancialStats:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch financial stats' });
  }
};

/**
 * Clear Financial Stats Cache
 * Called when flows/debts are updated
 */
export const clearCache = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ cleared: boolean }>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const viewContext = await getViewContext(req);
    clearFinancialStatsCache(viewContext);

    res.json({
      success: true,
      data: { cleared: true },
    });
  } catch (err) {
    console.error('Error clearing cache:', err);
    res.status(500).json({ success: false, error: 'Failed to clear cache' });
  }
};
