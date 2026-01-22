import { supabaseAdmin } from '../config/supabase';

interface ConvertibleAmount {
  amount?: number;
  balance?: number;
  current_balance?: number;
  currency: string;
  skip_balance_conversion?: boolean; // For stock/ETF assets where balance = shares, not money
}

interface ConvertedFields {
  converted_amount?: number;
  converted_balance?: number;
  exchange_rate?: number;
  converted_currency?: string;
}

interface ExchangeRate {
  code: string;
  rate: number;
}

// ═══════════════════════════════════════════════════════════════
// Exchange Rate Cache (daily cache with race condition protection)
// ═══════════════════════════════════════════════════════════════

interface ExchangeRateCache {
  rates: Map<string, number>;
  date: string; // YYYY-MM-DD format
}

let exchangeRateCache: ExchangeRateCache | null = null;
let fetchPromise: Promise<Map<string, number>> | null = null;

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Fetch all exchange rates from database and update cache
 */
async function fetchAndCacheExchangeRates(): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('currency_exchange')
    .select('code, rate');

  if (error) {
    console.error('Error fetching exchange rates:', error);
    return new Map();
  }

  const rateMap = new Map<string, number>();
  (data || []).forEach((rate: ExchangeRate) => {
    rateMap.set(rate.code.toLowerCase(), rate.rate);
  });

  // Update cache
  exchangeRateCache = {
    rates: rateMap,
    date: getTodayDate(),
  };

  return rateMap;
}

/**
 * Get cached exchange rates, fetching from DB if cache is stale (not today)
 * Uses promise lock to prevent race condition with parallel calls
 */
async function getCachedExchangeRates(): Promise<Map<string, number>> {
  const today = getTodayDate();

  // Return cached rates if cache exists and is from today
  if (exchangeRateCache && exchangeRateCache.date === today) {
    return exchangeRateCache.rates;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    return fetchPromise;
  }

  // Start fetching and store the promise
  fetchPromise = fetchAndCacheExchangeRates().finally(() => {
    fetchPromise = null; // Clear after completion
  });

  return fetchPromise;
}

/**
 * Get user preferences for currency conversion
 */
export async function getUserPreferences(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select('preferred_currency, convert_all_to_preferred')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching user preferences:', error);
    return null;
  }

  return data || { preferred_currency: 'USD', convert_all_to_preferred: false };
}

/**
 * Fetch exchange rates for given currency codes (uses daily cache)
 */
export async function getExchangeRates(currencyCodes: string[]): Promise<Map<string, number>> {
  if (currencyCodes.length === 0) {
    return new Map();
  }

  // Get all cached rates (fetches from DB if cache is stale)
  const allRates = await getCachedExchangeRates();

  // Filter to only requested currencies
  const lowerCodes = currencyCodes.map(c => c.toLowerCase());
  const rateMap = new Map<string, number>();

  lowerCodes.forEach(code => {
    const rate = allRates.get(code);
    if (rate !== undefined) {
      rateMap.set(code, rate);
    }
  });

  return rateMap;
}

/**
 * Convert amount from one currency to another
 * Exchange rates are stored as: 1 USD = X foreign currency
 * To convert foreign to USD: amount / rate
 * To convert USD to foreign: amount * rate
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rateMap: Map<string, number>
): { converted: number; rate: number } | null {
  const fromCode = fromCurrency.toLowerCase();
  const toCode = toCurrency.toLowerCase();

  // Same currency, no conversion needed
  if (fromCode === toCode) {
    return { converted: amount, rate: 1 };
  }

  const fromRate = fromCode === 'usd' ? 1 : rateMap.get(fromCode);
  const toRate = toCode === 'usd' ? 1 : rateMap.get(toCode);

  if (fromRate === undefined || toRate === undefined) {
    return null; // Rate not available
  }

  // Convert to USD first, then to target currency
  const amountInUsd = fromCode === 'usd' ? amount : amount / fromRate;
  const converted = toCode === 'usd' ? amountInUsd : amountInUsd * toRate;
  const effectiveRate = fromRate / toRate;

  return { converted, rate: effectiveRate };
}

/**
 * Add converted fields to a single item (flow, asset, or debt)
 */
export function addConvertedFields<T extends ConvertibleAmount>(
  item: T,
  preferredCurrency: string,
  rateMap: Map<string, number>
): T & ConvertedFields {
  const result = { ...item } as T & ConvertedFields;
  const itemCurrency = item.currency;
  const isSameCurrency = itemCurrency.toLowerCase() === preferredCurrency.toLowerCase();

  // Convert amount (for flows)
  if (item.amount !== undefined) {
    if (isSameCurrency) {
      result.converted_amount = item.amount;
      result.exchange_rate = 1;
      result.converted_currency = preferredCurrency;
    } else {
      const conversion = convertAmount(item.amount, itemCurrency, preferredCurrency, rateMap);
      if (conversion) {
        result.converted_amount = Math.round(conversion.converted * 100) / 100;
        result.exchange_rate = conversion.rate;
        result.converted_currency = preferredCurrency;
      }
    }
  }

  // Convert balance (for assets)
  // Skip for stock/ETF where balance = shares, not money
  if (item.balance !== undefined && !item.skip_balance_conversion) {
    if (isSameCurrency) {
      result.converted_balance = item.balance;
      result.exchange_rate = 1;
      result.converted_currency = preferredCurrency;
    } else {
      const conversion = convertAmount(item.balance, itemCurrency, preferredCurrency, rateMap);
      if (conversion) {
        result.converted_balance = Math.round(conversion.converted * 100) / 100;
        result.exchange_rate = conversion.rate;
        result.converted_currency = preferredCurrency;
      }
    }
  }

  // Convert current_balance (for debts)
  if (item.current_balance !== undefined) {
    if (isSameCurrency) {
      result.converted_balance = item.current_balance;
      result.exchange_rate = 1;
      result.converted_currency = preferredCurrency;
    } else {
      const conversion = convertAmount(item.current_balance, itemCurrency, preferredCurrency, rateMap);
      if (conversion) {
        result.converted_balance = Math.round(conversion.converted * 100) / 100;
        result.exchange_rate = conversion.rate;
        result.converted_currency = preferredCurrency;
      }
    }
  }

  return result;
}

/**
 * Add converted fields to an array of items
 * Always adds converted_balance for calculations (e.g., Net Worth)
 * The convert_all_to_preferred setting only affects display preference
 */
export async function addConvertedFieldsToArray<T extends ConvertibleAmount>(
  items: T[],
  userId: string
): Promise<(T & ConvertedFields)[]> {
  // Get user preferences
  const prefs = await getUserPreferences(userId);
  if (!prefs) {
    return items as (T & ConvertedFields)[];
  }

  // Always convert to preferred currency (needed for calculations like Net Worth)
  const preferredCurrency = prefs.preferred_currency || 'USD';

  // Collect all unique currencies
  const currencies = new Set<string>();
  currencies.add(preferredCurrency.toLowerCase());
  items.forEach(item => {
    if (item.currency) {
      currencies.add(item.currency.toLowerCase());
    }
  });

  // Fetch exchange rates
  const rateMap = await getExchangeRates(Array.from(currencies));

  // Add converted fields to each item
  return items.map(item => addConvertedFields(item, preferredCurrency, rateMap));
}

/**
 * Add converted fields to a single item
 * Always adds converted_balance for calculations
 */
export async function addConvertedFieldsToSingle<T extends ConvertibleAmount>(
  item: T,
  userId: string
): Promise<T & ConvertedFields> {
  // Get user preferences
  const prefs = await getUserPreferences(userId);
  if (!prefs) {
    return item as T & ConvertedFields;
  }

  // Always convert to preferred currency
  const preferredCurrency = prefs.preferred_currency || 'USD';

  // Collect currencies
  const currencies = [preferredCurrency.toLowerCase()];
  if (item.currency) {
    currencies.push(item.currency.toLowerCase());
  }

  // Fetch exchange rates
  const rateMap = await getExchangeRates(currencies);

  return addConvertedFields(item, preferredCurrency, rateMap);
}

// ═══════════════════════════════════════════════════════════════
// Batch Currency Conversion Utilities
// ═══════════════════════════════════════════════════════════════

export interface MoneyEntry {
  amount: number;
  currency: string;
}

export interface ConvertedMoneyEntry extends MoneyEntry {
  converted: number;
}

/**
 * Convert multiple money entries to a target currency and return converted values
 * Handles fetching exchange rates automatically
 */
export async function convertEntries(
  entries: MoneyEntry[],
  targetCurrency: string
): Promise<ConvertedMoneyEntry[]> {
  if (entries.length === 0) {
    return [];
  }

  // Collect all unique currencies
  const currencies = new Set<string>([targetCurrency.toLowerCase()]);
  entries.forEach(entry => {
    if (entry.currency) {
      currencies.add(entry.currency.toLowerCase());
    }
  });

  // Fetch exchange rates
  const rateMap = await getExchangeRates(Array.from(currencies));

  // Convert each entry
  return entries.map(entry => {
    const result = convertAmount(entry.amount, entry.currency, targetCurrency, rateMap);
    return {
      ...entry,
      converted: result ? result.converted : entry.amount,
    };
  });
}

/**
 * Convert multiple money entries to a target currency and return the sum
 * Handles fetching exchange rates automatically
 */
export async function sumWithConversion(
  entries: MoneyEntry[],
  targetCurrency: string
): Promise<number> {
  const converted = await convertEntries(entries, targetCurrency);
  return converted.reduce((sum, entry) => sum + entry.converted, 0);
}
