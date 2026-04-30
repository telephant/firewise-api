/**
 * Price Cache Cleanup Task
 *
 * Weekly cleanup. Deletes price_cache records older than 7 days.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

export class PriceCacheCleanupTask {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async run(): Promise<void> {
    console.log('Starting price cache cleanup...');

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

    const { error, count } = await this.supabase
      .from('price_cache')
      .delete({ count: 'exact' })
      .lt('date', cutoffDate);

    if (error) throw new Error(`Price cache cleanup failed: ${error.message}`);
    console.log(`Deleted ${count} stale price cache entries older than ${cutoffDate}`);
  }
}
