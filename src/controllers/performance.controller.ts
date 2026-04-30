import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getViewContext } from '../utils/family-context';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { fetchStockPrices } from '../utils/findata-client';

const SHARE_BASED_TYPES = ['stock', 'etf', 'crypto', 'metals', 'real_estate'];

interface PerformanceAsset {
  asset_id: string;
  name: string;
  ticker: string | null;
  type: string;
  currency: string;
  shares_held: number;
  avg_cost_basis: number;
  current_price: number | null;
  cost_basis_total: number;
  market_value: number;
  realized_pl: number;
  unrealized_pl: number;
  total_pl: number;
  total_pl_percent: number;
}

interface PerformanceSummary {
  total_realized_pl: number;
  total_unrealized_pl: number;
  total_pl: number;
  total_cost_basis: number;
  total_market_value: number;
}

interface PerformanceData {
  summary: PerformanceSummary;
  assets: PerformanceAsset[];
  currency: string;
}

/**
 * GET /api/fire/performance
 *
 * Returns realized P/L (from sell transactions) and unrealized P/L (current price vs avg cost).
 * Both buy and sell transactions use `asset_id` for the investment asset.
 */
export const getPerformance = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PerformanceData>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    // User preferences for currency conversion
    const preferences = await getUserPreferences(userId);
    const preferredCurrency = preferences?.preferred_currency || 'USD';
    const shouldConvert = preferences?.convert_all_to_preferred || false;

    // Fetch share-based assets (include balance=0 for fully sold assets)
    let assetsQuery = supabaseAdmin
      .from('assets')
      .select('id, name, ticker, type, currency, balance')
      .in('type', SHARE_BASED_TYPES);
    assetsQuery = assetsQuery.eq('belong_id', viewContext.belongId);
    const { data: assets, error: assetsError } = await assetsQuery;

    if (assetsError) {
      console.error('Failed to fetch assets:', assetsError);
      res.status(500).json({ success: false, error: 'Failed to fetch performance data' });
      return;
    }

    if (!assets || assets.length === 0) {
      res.json({
        success: true,
        data: {
          summary: { total_realized_pl: 0, total_unrealized_pl: 0, total_pl: 0, total_cost_basis: 0, total_market_value: 0 },
          assets: [],
          currency: shouldConvert ? preferredCurrency : 'USD',
        },
      });
      return;
    }

    const assetIds = assets.map((a) => a.id);

    // Fetch ALL transactions for these assets in one query
    // Both buy (category='invest') and sell (category='sell') use asset_id for the investment asset
    let txQuery = supabaseAdmin
      .from('transactions')
      .select('asset_id, category, amount, shares, currency, metadata')
      .in('asset_id', assetIds)
      .in('category', ['invest', 'sell']);
    txQuery = txQuery.eq('belong_id', viewContext.belongId);
    const { data: transactions } = await txQuery;

    // Fetch current market prices for held assets
    const tickers = assets
      .filter((a) => a.ticker && a.balance > 0)
      .map((a) => a.ticker!);
    const uniqueTickers = [...new Set(tickers)];
    const priceData = uniqueTickers.length > 0 ? await fetchStockPrices(uniqueTickers) : {};

    // Exchange rates for currency conversion
    const currencies = new Set<string>([preferredCurrency.toLowerCase()]);
    assets.forEach((a) => currencies.add((a.currency || 'USD').toLowerCase()));
    const rateMap = shouldConvert ? await getExchangeRates(Array.from(currencies)) : new Map<string, number>();

    const convert = (amount: number, from: string): number => {
      if (!shouldConvert || from.toLowerCase() === preferredCurrency.toLowerCase()) return amount;
      return convertAmount(amount, from, preferredCurrency, rateMap)?.converted ?? amount;
    };

    // Aggregate per asset: buy totals and realized P/L
    const buyMap = new Map<string, { totalAmount: number; totalShares: number }>();
    const realizedPlMap = new Map<string, number>();

    for (const tx of (transactions || [])) {
      const id = tx.asset_id;
      if (!id) continue;
      const txCurrency = tx.currency || 'USD';

      if (tx.category === 'invest') {
        // Buy transaction: accumulate cost and shares
        const shares = tx.shares || 0;
        if (shares > 0) {
          const prev = buyMap.get(id) || { totalAmount: 0, totalShares: 0 };
          buyMap.set(id, {
            totalAmount: prev.totalAmount + convert(tx.amount, txCurrency),
            totalShares: prev.totalShares + shares,
          });
        }
      } else if (tx.category === 'sell') {
        // Sell transaction: accumulate realized P/L from metadata
        const pl = (tx.metadata as { realized_pl?: number } | null)?.realized_pl || 0;
        realizedPlMap.set(id, (realizedPlMap.get(id) || 0) + convert(pl, txCurrency));
      }
    }

    // Build per-asset performance
    const performanceAssets: PerformanceAsset[] = [];

    for (const asset of assets) {
      const sharesHeld = asset.balance || 0;
      const assetCurrency = asset.currency || 'USD';
      const buyData = buyMap.get(asset.id);
      const realizedPl = realizedPlMap.get(asset.id) || 0;
      const totalInvested = buyData?.totalAmount || 0;

      // Skip assets with no trading activity
      if (sharesHeld === 0 && realizedPl === 0 && totalInvested === 0) continue;

      const avgCostBasis = buyData && buyData.totalShares > 0
        ? buyData.totalAmount / buyData.totalShares
        : 0;

      // Current market price
      let currentPrice: number | null = null;
      if (asset.ticker && priceData[asset.ticker.toUpperCase()]) {
        const pd = priceData[asset.ticker.toUpperCase()];
        currentPrice = pd.price !== null ? convert(pd.price, pd.currency || assetCurrency) : null;
      }

      const costBasisTotal = avgCostBasis * sharesHeld;
      const marketValue = currentPrice !== null ? currentPrice * sharesHeld : costBasisTotal;
      const unrealizedPl = sharesHeld > 0 && currentPrice !== null
        ? (currentPrice - avgCostBasis) * sharesHeld
        : 0;
      const totalPl = realizedPl + unrealizedPl;
      const totalPlPercent = totalInvested > 0 ? (totalPl / totalInvested) * 100 : 0;

      performanceAssets.push({
        asset_id: asset.id,
        name: asset.name,
        ticker: asset.ticker,
        type: asset.type,
        currency: shouldConvert ? preferredCurrency : assetCurrency,
        shares_held: sharesHeld,
        avg_cost_basis: avgCostBasis,
        current_price: currentPrice,
        cost_basis_total: costBasisTotal,
        market_value: marketValue,
        realized_pl: realizedPl,
        unrealized_pl: unrealizedPl,
        total_pl: totalPl,
        total_pl_percent: totalPlPercent,
      });
    }

    // Sort: held assets first (by market value desc), then sold (by realized P/L desc)
    performanceAssets.sort((a, b) => {
      if (a.shares_held > 0 && b.shares_held === 0) return -1;
      if (a.shares_held === 0 && b.shares_held > 0) return 1;
      if (a.shares_held > 0) return b.market_value - a.market_value;
      return Math.abs(b.realized_pl) - Math.abs(a.realized_pl);
    });

    const summary: PerformanceSummary = {
      total_realized_pl: performanceAssets.reduce((sum, a) => sum + a.realized_pl, 0),
      total_unrealized_pl: performanceAssets.reduce((sum, a) => sum + a.unrealized_pl, 0),
      total_pl: performanceAssets.reduce((sum, a) => sum + a.total_pl, 0),
      total_cost_basis: performanceAssets.reduce((sum, a) => sum + a.cost_basis_total, 0),
      total_market_value: performanceAssets.reduce((sum, a) => sum + a.market_value, 0),
    };

    res.json({
      success: true,
      data: { summary, assets: performanceAssets, currency: shouldConvert ? preferredCurrency : 'USD' },
    });
  } catch (err) {
    console.error('getPerformance error:', err);
    res.status(500).json({ success: false, error: 'Failed to get performance data' });
  }
};
