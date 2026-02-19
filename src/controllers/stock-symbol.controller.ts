import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse } from '../types';
import * as findata from '../utils/findata-client';

/**
 * Symbol Search Controller
 *
 * Uses firewise-findata service for symbol lookup.
 * Supports stocks, ETFs, futures, crypto, and more.
 */

export type SymbolType = 'stock' | 'etf' | 'future' | 'crypto' | 'index' | 'currency' | 'fund' | 'other';

interface SymbolResponse {
  symbol: string;
  name: string;
  longName?: string;
  type: SymbolType;
  exchange: string;
  exchangeDisplay: string;
  sector?: string;
  industry?: string;
  logoUrl?: string;
}

/**
 * Search symbols using findata service
 * GET /api/symbols/ticker-search?q=AAPL&region=US&type=stock,etf&limit=10
 *
 * Query params:
 *   - q: Search query (required, min 1 char)
 *   - region: Market region ('US', 'HK', 'UK', 'SG', 'JP', 'CN', etc.)
 *   - type: Filter by type ('stock', 'etf', 'future', 'crypto', 'index', 'currency', 'fund')
 *   - limit: Max results (default 10, max 20)
 */
export const searchSymbols = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ symbols: SymbolResponse[]; total: number }>>
): Promise<void> => {
  try {
    const { q = '', region, type, limit = '10' } = req.query as {
      q?: string;
      region?: string;
      type?: string;
      limit?: string;
    };

    const searchTerm = q.trim();

    if (!searchTerm) {
      res.json({
        success: true,
        data: { symbols: [], total: 0 },
      });
      return;
    }

    const maxResults = Math.min(parseInt(limit, 10) || 10, 20);

    // Handle comma-separated types - use first one for findata API
    let searchType: string | undefined;
    if (type && type !== 'all') {
      const types = type.split(',').map((t) => t.trim());
      searchType = types[0]; // Use first type for API call
    }

    // Fetch from findata service
    const results = await findata.searchSymbols(searchTerm, {
      region: region,
      type: searchType,
      limit: maxResults * 2, // Request extra for client-side filtering
    });

    // Transform to expected format
    let symbols: SymbolResponse[] = results.map((r) => ({
      symbol: r.symbol,
      name: r.short_name || r.long_name || r.symbol,
      longName: r.long_name || undefined,
      type: (r.quote_type as SymbolType) || 'other',
      exchange: r.exchange || '',
      exchangeDisplay: r.exchange_display || r.exchange || '',
      sector: r.sector || undefined,
      industry: r.industry || undefined,
    }));

    // Additional client-side filtering if multiple types specified
    if (type && type !== 'all' && type.includes(',')) {
      const allowedTypes = new Set(type.split(',').map((t) => t.trim()));
      symbols = symbols.filter((s) => allowedTypes.has(s.type));
    }

    // Limit results
    symbols = symbols.slice(0, maxResults);

    res.json({
      success: true,
      data: { symbols, total: symbols.length },
    });
  } catch (error) {
    console.error('Symbol search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search symbols',
    });
  }
};
