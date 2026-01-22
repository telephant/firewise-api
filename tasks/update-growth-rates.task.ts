/**
 * Update Growth Rates Task
 *
 * Fetches historical stock data from Yahoo Finance and calculates
 * 5-year and 10-year annualized growth rates (CAGR) for all assets with tickers.
 *
 * The growth rates are stored in the asset's metadata.growth_rates field:
 * {
 *   growth_rates: {
 *     "5y": 0.12,    // 12% annual growth over 5 years
 *     "10y": 0.08,   // 8% annual growth over 10 years
 *     updated_at: "2025-01-17T..."
 *   }
 * }
 *
 * Run: npm run task:update-growth-rates
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        currency: string;
        symbol: string;
      };
      timestamp: number[];
      indicators: {
        adjclose: Array<{
          adjclose: number[];
        }>;
      };
    }>;
    error: null | { code: string; description: string };
  };
}

interface GrowthRates {
  '5y': number | null;
  '10y': number | null;
  updated_at: string;
}

interface Asset {
  id: string;
  ticker: string;
  name: string;
}

export class UpdateGrowthRatesTask {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async run(): Promise<void> {
    // 1. Get all unique tickers from assets
    console.log('Fetching assets with tickers...');
    const assets = await this.getAssetsWithTickers();
    console.log(`Found ${assets.length} assets with tickers`);

    if (assets.length === 0) {
      console.log('No assets with tickers found. Skipping.');
      return;
    }

    // 2. Group by ticker to avoid duplicate API calls
    const tickerMap = new Map<string, Asset[]>();
    for (const asset of assets) {
      const ticker = asset.ticker.toUpperCase();
      if (!tickerMap.has(ticker)) {
        tickerMap.set(ticker, []);
      }
      tickerMap.get(ticker)!.push(asset);
    }

    console.log(`Unique tickers: ${tickerMap.size}`);

    // 3. Fetch growth rates for each ticker
    let successCount = 0;
    let errorCount = 0;

    for (const [ticker, assetList] of tickerMap) {
      console.log(`  Fetching ${ticker}...`);

      try {
        const growthRates = await this.fetchGrowthRates(ticker);

        if (growthRates) {
          // Update all assets with this ticker
          for (const asset of assetList) {
            await this.updateAssetGrowthRates(asset, growthRates);
          }
          console.log(`    ✓ ${ticker}: 5y=${this.formatRate(growthRates['5y'])}, 10y=${this.formatRate(growthRates['10y'])}`);
          successCount++;
        } else {
          console.log(`    ✗ ${ticker}: No data available`);
          errorCount++;
        }
      } catch (error) {
        console.log(`    ✗ ${ticker}: ${error}`);
        errorCount++;
      }

      // Small delay to avoid rate limiting
      await this.delay(200);
    }

    console.log(`\nCompleted: ${successCount} success, ${errorCount} errors`);
  }

  private formatRate(rate: number | null): string {
    if (rate === null) return 'N/A';
    return `${(rate * 100).toFixed(1)}%`;
  }

  private async getAssetsWithTickers(): Promise<Asset[]> {
    const { data, error } = await this.supabase
      .from('assets')
      .select('id, ticker, name')
      .not('ticker', 'is', null)
      .neq('ticker', '');

    if (error) {
      throw new Error(`Failed to fetch assets: ${error.message}`);
    }

    return data || [];
  }

  private async fetchGrowthRates(ticker: string): Promise<GrowthRates | null> {
    const now = Math.floor(Date.now() / 1000);
    const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60;
    const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;

    // Fetch 10 years of data (covers both 5y and 10y)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${tenYearsAgo}&period2=${now}&interval=1mo&includePrePost=false&lang=en-US&region=US`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as YahooChartResponse;

    if (data.chart.error || !data.chart.result?.[0]) {
      return null;
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const prices = result.indicators?.adjclose?.[0]?.adjclose;

    if (!timestamps || !prices || timestamps.length < 2) {
      return null;
    }

    // Calculate growth rates
    const currentPrice = prices[prices.length - 1];

    // Find 5-year price
    let fiveYearRate: number | null = null;
    const fiveYearIndex = timestamps.findIndex(t => t >= fiveYearsAgo);
    if (fiveYearIndex >= 0 && prices[fiveYearIndex]) {
      const fiveYearPrice = prices[fiveYearIndex];
      const years = (timestamps[timestamps.length - 1] - timestamps[fiveYearIndex]) / (365 * 24 * 60 * 60);
      if (years >= 1 && fiveYearPrice > 0) {
        fiveYearRate = Math.pow(currentPrice / fiveYearPrice, 1 / years) - 1;
      }
    }

    // Find 10-year price
    let tenYearRate: number | null = null;
    if (timestamps[0] <= tenYearsAgo + 365 * 24 * 60 * 60 && prices[0]) {
      const tenYearPrice = prices[0];
      const years = (timestamps[timestamps.length - 1] - timestamps[0]) / (365 * 24 * 60 * 60);
      if (years >= 1 && tenYearPrice > 0) {
        tenYearRate = Math.pow(currentPrice / tenYearPrice, 1 / years) - 1;
      }
    }

    return {
      '5y': fiveYearRate !== null ? Math.round(fiveYearRate * 10000) / 10000 : null,
      '10y': tenYearRate !== null ? Math.round(tenYearRate * 10000) / 10000 : null,
      updated_at: new Date().toISOString(),
    };
  }

  private async updateAssetGrowthRates(asset: Asset, growthRates: GrowthRates): Promise<void> {
    const { error } = await this.supabase
      .from('assets')
      .update({ growth_rates: growthRates })
      .eq('id', asset.id);

    if (error) {
      throw new Error(`Failed to update asset ${asset.id}: ${error.message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
