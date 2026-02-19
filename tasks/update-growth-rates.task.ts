/**
 * Update Growth Rates Task
 *
 * Fetches CAGR (5-year and 10-year growth rates) from findata service
 * for all assets with tickers.
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
 * Data source: firewise-findata service (yfinance)
 * Run: npm run task:update-growth-rates
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as findata from '../src/utils/findata-client';

dotenv.config();

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

    // 3. Fetch growth rates using batch API
    const tickers = Array.from(tickerMap.keys());
    console.log('Fetching CAGR data from findata...');

    try {
      const cagrData = await findata.fetchCAGRBatch(tickers);

      let successCount = 0;
      let errorCount = 0;

      for (const [ticker, assetList] of tickerMap) {
        const data = cagrData[ticker];

        if (data && (data.cagr_5y !== null || data.cagr_10y !== null)) {
          const growthRates: GrowthRates = {
            '5y': data.cagr_5y,
            '10y': data.cagr_10y,
            updated_at: new Date().toISOString(),
          };

          // Update all assets with this ticker
          for (const asset of assetList) {
            await this.updateAssetGrowthRates(asset, growthRates);
          }
          console.log(`  ✓ ${ticker}: 5y=${this.formatRate(growthRates['5y'])}, 10y=${this.formatRate(growthRates['10y'])}`);
          successCount++;
        } else {
          console.log(`  ✗ ${ticker}: No data available`);
          errorCount++;
        }
      }

      console.log(`\nCompleted: ${successCount} success, ${errorCount} errors`);
    } catch (error) {
      console.error('Failed to fetch CAGR data:', error);
    }
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

  private async updateAssetGrowthRates(asset: Asset, growthRates: GrowthRates): Promise<void> {
    const { error } = await this.supabase
      .from('assets')
      .update({ growth_rates: growthRates })
      .eq('id', asset.id);

    if (error) {
      throw new Error(`Failed to update asset ${asset.id}: ${error.message}`);
    }
  }
}
