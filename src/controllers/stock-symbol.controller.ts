import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse } from '../types';

/**
 * Symbol Search Controller
 *
 * Uses Yahoo Finance search API for real-time symbol lookup.
 * Supports stocks, ETFs, futures, crypto, and more.
 */

interface YahooQuote {
  symbol: string;
  shortname: string;
  longname?: string;
  quoteType: string;
  exchange: string;
  exchDisp: string;
  sector?: string;
  industry?: string;
  isYahooFinance: boolean;
  logoUrl?: string;
}

interface YahooSearchResponse {
  quotes: YahooQuote[];
  count: number;
}

// Asset types we support
export type SymbolType = 'stock' | 'etf' | 'future' | 'crypto' | 'index' | 'currency' | 'other';

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

// Map Yahoo quoteType to our type
function mapQuoteType(yahooType: string | undefined): SymbolType {
  const type = yahooType?.toUpperCase();
  switch (type) {
    case 'EQUITY':
      return 'stock';
    case 'ETF':
      return 'etf';
    case 'FUTURE':
      return 'future';
    case 'CRYPTOCURRENCY':
      return 'crypto';
    case 'INDEX':
      return 'index';
    case 'CURRENCY':
      return 'currency';
    default:
      return 'other';
  }
}

// Map single type to Yahoo quotesTypes param
function mapSingleTypeToYahoo(type: string): string | undefined {
  switch (type) {
    case 'stock':
      return 'EQUITY';
    case 'etf':
      return 'ETF';
    case 'future':
      return 'FUTURE';
    case 'crypto':
      return 'CRYPTOCURRENCY';
    case 'index':
      return 'INDEX';
    case 'currency':
      return 'CURRENCY';
    default:
      return undefined;
  }
}

// Map our type(s) to Yahoo quotesTypes param - supports comma-separated types
function mapToYahooQuotesTypes(types: string): string | undefined {
  if (!types || types === 'all') return undefined;

  // Handle comma-separated types (e.g., "stock,etf")
  const typeList = types.split(',').map((t) => t.trim());
  const yahooTypes = typeList
    .map((t) => mapSingleTypeToYahoo(t))
    .filter((t): t is string => t !== undefined);

  return yahooTypes.length > 0 ? yahooTypes.join(',') : undefined;
}

// Map region to allowed exchange codes
// Yahoo's region param is for locale, not filtering - we filter by exchange
const REGION_EXCHANGES: Record<string, string[]> = {
  US: ['NMS', 'NYQ', 'PCX', 'NGM', 'NCM', 'BTS', 'ASE'], // NASDAQ, NYSE, NYSE Arca, etc.
  SG: ['SES'], // Singapore Exchange
  HK: ['HKG'], // Hong Kong Stock Exchange
  UK: ['LSE', 'IOB'], // London Stock Exchange
  JP: ['TYO', 'JPX'], // Tokyo Stock Exchange
  CN: ['SHH', 'SHZ'], // Shanghai, Shenzhen
  // Add more as needed
};

function getExchangesForRegion(region: string): string[] | undefined {
  return REGION_EXCHANGES[region.toUpperCase()];
}

/**
 * Search symbols using Yahoo Finance
 * GET /api/symbols/ticker-search?q=AAPL&region=US&type=stock,etf&limit=10
 *
 * Query params:
 *   - q: Search query (required, min 1 char)
 *   - region: Market region ('US', 'HK', 'UK', etc., default 'US')
 *   - type: Filter by type(s), comma-separated ('stock', 'etf', 'future', 'crypto', 'index', 'currency', 'all')
 *           Example: type=stock,etf for stocks and ETFs
 *   - limit: Max results (default 10, max 20)
 */
export const searchSymbols = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ symbols: SymbolResponse[]; total: number }>>
): Promise<void> => {
  try {
    const { q = '', region = 'US', type = 'all', limit = '10' } = req.query as {
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
    const quotesTypes = mapToYahooQuotesTypes(type);

    // Build Yahoo Finance search URL
    const params = new URLSearchParams({
      q: searchTerm,
      lang: 'en-US',
      region: region.toUpperCase(),
      quotesCount: String(maxResults * 3 + 10), // Request extra to account for region/type filtering
      newsCount: '0',
      listsCount: '0',
      enableFuzzyQuery: 'false',
      quotesQueryId: 'tss_match_phrase_query',
      enableLogoUrl: 'true',
    });

    // Add quotesTypes if filtering by type
    if (quotesTypes) {
      params.set('quotesTypes', quotesTypes);
    }

    const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?${params.toString()}`;

    const response = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance API returned ${response.status}`);
    }

    const data = (await response.json()) as YahooSearchResponse;

    // Transform results
    let results: SymbolResponse[] = (data.quotes || [])
      .filter((quote) => quote.isYahooFinance)
      .map((quote) => ({
        symbol: quote.symbol,
        name: quote.shortname || quote.longname || quote.symbol,
        longName: quote.longname,
        type: mapQuoteType(quote.quoteType),
        exchange: quote.exchange,
        exchangeDisplay: quote.exchDisp || quote.exchange,
        sector: quote.sector,
        industry: quote.industry,
        logoUrl: quote.logoUrl,
      }));

    // Filter by region's exchanges
    const allowedExchanges = getExchangesForRegion(region);
    if (allowedExchanges) {
      results = results.filter((r) => allowedExchanges.includes(r.exchange));
    }

    // Additional client-side filtering if types specified (handles comma-separated)
    if (type && type !== 'all') {
      const allowedTypes = new Set(type.split(',').map((t) => t.trim()));
      results = results.filter((r) => allowedTypes.has(r.type));
    }

    // Limit results
    results = results.slice(0, maxResults);

    res.json({
      success: true,
      data: { symbols: results, total: results.length },
    });
  } catch (error) {
    console.error('Symbol search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search symbols',
    });
  }
};
