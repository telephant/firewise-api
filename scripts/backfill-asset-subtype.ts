/**
 * Backfill asset_subtype for existing trades.
 *
 * Logic:
 *  - asset_type = 'commodity' → asset_subtype = 'commodity'
 *  - otherwise → query findata /stock/price/:ticker for quote_type
 *
 * Usage:
 *   npx ts-node scripts/backfill-asset-subtype.ts
 *
 * Safe to re-run: only updates rows where asset_subtype IS NULL.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FINDATA_URL = process.env.FINDATA_URL || 'http://localhost:8002';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MARKET_TO_SUFFIX: Record<string, string> = {
  US: '', SGX: '.SI', HK: '.HK', CN: '.SS',
  JP: '.T', UK: '.L', AU: '.AX', CA: '.TO',
  DE: '.DE', FR: '.PA', TW: '.TW', KR: '.KS',
};

function toYfTicker(ticker: string, market: string): string {
  const suffix = MARKET_TO_SUFFIX[market.toUpperCase()];
  if (suffix === undefined) return `${ticker}.${market}`;
  return `${ticker}${suffix}`;
}

const QUOTE_TYPE_MAP: Record<string, string> = {
  stock: 'stock', etf: 'etf', crypto: 'crypto',
  fund: 'fund', other: 'other',
};

async function fetchQuoteType(yfTicker: string): Promise<string | null> {
  try {
    const res = await fetch(`${FINDATA_URL}/stock/price/${encodeURIComponent(yfTicker)}`);
    if (!res.ok) return null;
    const data = await res.json() as { quote_type?: string | null };
    const qt = data.quote_type?.toLowerCase();
    return qt ? (QUOTE_TYPE_MAP[qt] ?? 'other') : null;
  } catch {
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Fetching trades with NULL asset_subtype...');

  const { data: trades, error } = await supabase
    .from('trades')
    .select('id, ticker, market, asset_type')
    .is('asset_subtype', null);

  if (error) {
    console.error('Failed to fetch trades:', error.message);
    process.exit(1);
  }

  if (!trades || trades.length === 0) {
    console.log('No trades to backfill.');
    return;
  }

  console.log(`Found ${trades.length} trades to backfill.`);

  // Deduplicate by (ticker, market) to minimise findata calls
  const seen = new Map<string, string>(); // yfTicker → asset_subtype
  const commodityTickers = ['GC=F', 'SI=F', 'PL=F', 'CL=F'];

  let updated = 0;
  let failed = 0;

  for (const trade of trades) {
    let subtype: string;

    if (trade.asset_type === 'commodity' || commodityTickers.includes(trade.ticker.toUpperCase())) {
      subtype = 'commodity';
    } else {
      const yfTicker = toYfTicker(trade.ticker, trade.market);

      if (seen.has(yfTicker)) {
        subtype = seen.get(yfTicker)!;
      } else {
        process.stdout.write(`  Querying ${yfTicker}... `);
        const qt = await fetchQuoteType(yfTicker);
        subtype = qt ?? 'stock'; // fallback: treat unknown as stock
        seen.set(yfTicker, subtype);
        console.log(subtype);
        await sleep(200); // be gentle with findata
      }
    }

    const { error: updateError } = await supabase
      .from('trades')
      .update({ asset_subtype: subtype })
      .eq('id', trade.id);

    if (updateError) {
      console.error(`  ✗ Failed to update trade ${trade.id}:`, updateError.message);
      failed++;
    } else {
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
