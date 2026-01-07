import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse } from '../types';
import * as fs from 'fs';
import * as path from 'path';

interface StockSymbol {
  symbol: string;
  security_name: string;
}

interface StockSymbolResponse {
  symbol: string;
  name: string;
}

// Cache for loaded symbols
let usSymbolsCache: StockSymbol[] | null = null;

/**
 * Load US stock symbols from JSON file (cached)
 */
const loadUsSymbols = (): StockSymbol[] => {
  if (usSymbolsCache) {
    return usSymbolsCache;
  }

  try {
    const filePath = path.join(__dirname, '../../data/us-stock/symbols.json');
    const data = fs.readFileSync(filePath, 'utf-8');
    usSymbolsCache = JSON.parse(data) as StockSymbol[];
    console.log(`Loaded ${usSymbolsCache.length} US stock symbols`);
    return usSymbolsCache;
  } catch (error) {
    console.error('Failed to load US stock symbols:', error);
    return [];
  }
};

/**
 * Search US stock symbols
 * GET /api/stock-symbols/us?search=AAPL
 */
export const searchUsSymbols = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ symbols: StockSymbolResponse[]; total: number }>>
): Promise<void> => {
  try {
    const { search = '', limit = '20' } = req.query as { search?: string; limit?: string };
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
    const searchTerm = search.trim().toUpperCase();

    if (!searchTerm) {
      res.json({
        success: true,
        data: { symbols: [], total: 0 },
      });
      return;
    }

    const allSymbols = loadUsSymbols();

    // Single pass: categorize into symbol matches vs name-only matches
    const symbolMatches: StockSymbol[] = [];
    const nameMatches: StockSymbol[] = [];

    for (const s of allSymbols) {
      const upperSymbol = s.symbol.toUpperCase();
      if (upperSymbol.startsWith(searchTerm)) {
        symbolMatches.push(s);
      } else if (s.security_name.toUpperCase().includes(searchTerm)) {
        nameMatches.push(s);
      }
    }

    // Sort symbol matches: exact first, then alphabetically
    symbolMatches.sort((a, b) => {
      const aExact = a.symbol.toUpperCase() === searchTerm;
      const bExact = b.symbol.toUpperCase() === searchTerm;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });

    // Sort name matches alphabetically
    nameMatches.sort((a, b) => a.symbol.localeCompare(b.symbol));

    // Combine: symbol matches first, then name matches (limit applied)
    const matches = [...symbolMatches, ...nameMatches].slice(0, limitNum);

    const result: StockSymbolResponse[] = matches.map((s) => ({
      symbol: s.symbol,
      name: s.security_name,
    }));

    res.json({
      success: true,
      data: { symbols: result, total: matches.length },
    });
  } catch (error) {
    console.error('Error searching US symbols:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search stock symbols',
    });
  }
};
