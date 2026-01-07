/**
 * Update Currency Task
 *
 * Fetches latest exchange rates and currency names from fawazahmed0/exchange-api
 * and updates the currency_exchange table in the database.
 *
 * API: https://github.com/fawazahmed0/exchange-api
 * - 200+ currencies (fiat, crypto, metals)
 * - No API key required
 * - No rate limits
 * - Updated daily
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface RatesApiResponse {
  date: string;
  usd: Record<string, number>;
}

// Currency names API returns: { "usd": "US Dollar", "eur": "Euro", ... }
type CurrencyNamesResponse = Record<string, string>;

export class UpdateCurrencyTask {
  // Rates API (USD-based)
  private readonly RATES_PRIMARY_URL =
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
  private readonly RATES_FALLBACK_URL =
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json';

  // Currency names API
  private readonly NAMES_PRIMARY_URL =
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.json';
  private readonly NAMES_FALLBACK_URL =
    'https://latest.currency-api.pages.dev/v1/currencies.json';

  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
      );
    }

    // Use service role to bypass RLS
    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async run(): Promise<void> {
    // Fetch rates first to get the API date
    console.log('Fetching exchange rates...');
    const { rates, date: apiDate } = await this.fetchRates();

    // Check the current date in the database
    console.log('Checking database date...');
    const dbDate = await this.getDbDate();

    if (dbDate) {
      console.log(`API date: ${apiDate}, DB date: ${dbDate}`);

      // Compare dates - if DB date is same or newer, skip update
      if (dbDate >= apiDate) {
        console.log('Database is already up to date. Skipping update.');
        return;
      }
    } else {
      console.log(`API date: ${apiDate}, DB date: (none)`);
    }

    // Fetch names and update database
    console.log('Fetching currency names...');
    const names = await this.fetchNames();

    const currencyCount = Object.keys(rates).length;
    const namesCount = Object.keys(names).length;
    console.log(`Received ${currencyCount} rates, ${namesCount} names`);

    console.log('Updating database...');
    await this.updateDatabase(rates, names, apiDate);

    console.log(`Successfully updated ${currencyCount} currencies`);
  }

  private async getDbDate(): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('currency_exchange')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.date;
  }

  private async fetchRates(): Promise<{ rates: Record<string, number>; date: string }> {
    // Try primary URL first
    try {
      console.log(`  Fetching rates from primary URL...`);
      const response = await fetch(this.RATES_PRIMARY_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RatesApiResponse;
      return { rates: data.usd, date: data.date };
    } catch (error) {
      console.warn(`  Primary rates URL failed: ${error}`);
    }

    // Fallback to secondary URL
    try {
      console.log(`  Fetching rates from fallback URL...`);
      const response = await fetch(this.RATES_FALLBACK_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RatesApiResponse;
      return { rates: data.usd, date: data.date };
    } catch (error) {
      console.error(`  Fallback rates URL failed: ${error}`);
      throw new Error('Failed to fetch exchange rates from both primary and fallback URLs');
    }
  }

  private async fetchNames(): Promise<Record<string, string>> {
    // Try primary URL first
    try {
      console.log(`  Fetching names from primary URL...`);
      const response = await fetch(this.NAMES_PRIMARY_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as CurrencyNamesResponse;
    } catch (error) {
      console.warn(`  Primary names URL failed: ${error}`);
    }

    // Fallback to secondary URL
    try {
      console.log(`  Fetching names from fallback URL...`);
      const response = await fetch(this.NAMES_FALLBACK_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as CurrencyNamesResponse;
    } catch (error) {
      console.warn(`  Fallback names URL failed: ${error}`);
      // Names are optional, return empty if both fail
      return {};
    }
  }

  private async updateDatabase(
    rates: Record<string, number>,
    names: Record<string, string>,
    date: string
  ): Promise<void> {
    // Prepare batch upsert data with both rate and name
    const now = new Date().toISOString();
    const upsertData = Object.entries(rates).map(([code, rate]) => ({
      code: code.toLowerCase(),
      name: names[code.toLowerCase()] || null,
      rate,
      date,
      updated_at: now,
    }));

    // Batch upsert in chunks of 500 to avoid request size limits
    const BATCH_SIZE = 500;
    let updated = 0;

    for (let i = 0; i < upsertData.length; i += BATCH_SIZE) {
      const batch = upsertData.slice(i, i + BATCH_SIZE);

      const { error } = await this.supabase
        .from('currency_exchange')
        .upsert(batch, { onConflict: 'code' });

      if (error) {
        throw new Error(`Database upsert failed: ${error.message}`);
      }

      updated += batch.length;
      console.log(`  Upserted ${updated}/${upsertData.length} currencies`);
    }
  }
}
