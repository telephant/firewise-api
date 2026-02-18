import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext, applyOwnershipFilter, applyOwnershipFilterWithId, buildOwnershipValues, ViewContext } from '../utils/family-context';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Asset Transaction Controller
 *
 * Handles all asset-related transactions:
 * - invest: Buy stocks, ETFs, crypto, bonds, real estate
 * - sell: Sell existing investments
 * - transfer: Move money between accounts
 * - add: Create new asset with initial balance
 *
 * Each transaction:
 * 1. Validates input
 * 2. Updates asset balances directly
 * 3. Logs to flow table for audit
 */

// Share-based asset types (balance = shares count)
const SHARE_BASED_TYPES = ['stock', 'etf', 'crypto'];

// ETF and crypto ticker detection
const ETF_TICKERS = new Set([
  'QQQ', 'SPY', 'VOO', 'VTI', 'IVV', 'VEA', 'IEFA', 'VWO', 'IBIT', 'AGG',
  'BND', 'VNQ', 'GLD', 'SLV', 'TQQQ', 'SQQQ', 'ARKK', 'XLF', 'XLE', 'XLK',
  'DIA', 'IWM', 'EEM', 'HYG', 'LQD', 'TLT', 'SCHD', 'JEPI', 'JEPQ',
]);

const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'ATOM',
  'XRP', 'DOGE', 'SHIB', 'LTC', 'BCH', 'XLM', 'ALGO', 'FIL', 'NEAR', 'APT',
]);

function detectAssetType(ticker: string): string {
  const upper = ticker.toUpperCase();
  if (ETF_TICKERS.has(upper)) return 'etf';
  if (CRYPTO_TICKERS.has(upper)) return 'crypto';
  return 'stock';
}

interface TransactionRequest {
  type: 'invest' | 'sell' | 'transfer' | 'add';

  // For invest/sell
  ticker?: string;
  shares?: number;
  asset_type?: 'stock' | 'etf' | 'crypto' | 'bond' | 'real_estate';

  // For transfer
  from_asset_id?: string;
  to_asset_id?: string;

  // For add (new asset)
  name?: string;

  // Common
  amount: number;
  currency?: string;
  date?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface TransactionResult {
  transaction_id: string;
  asset?: Asset;
  from_asset?: Asset;
  to_asset?: Asset;
}

/**
 * POST /api/fire/assets/transaction
 *
 * Unified endpoint for all asset transactions
 */
export const createTransaction = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<TransactionResult>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const ownershipValues = buildOwnershipValues(viewContext);

    const {
      type,
      ticker,
      shares,
      asset_type,
      from_asset_id,
      to_asset_id,
      name,
      amount,
      currency = 'USD',
      date,
      description,
      metadata,
    } = req.body as TransactionRequest;

    // Validate type
    if (!type || !['invest', 'sell', 'transfer', 'add'].includes(type)) {
      res.status(400).json({
        success: false,
        error: 'Valid type is required: invest, sell, transfer, or add'
      });
      return;
    }

    // Validate amount (allow 0 for invest - e.g., metals with unknown cost)
    if (amount === undefined || amount === null || isNaN(amount)) {
      res.status(400).json({ success: false, error: 'Valid amount is required' });
      return;
    }
    if (type !== 'invest' && amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount is required' });
      return;
    }

    const flowDate = date || new Date().toISOString().split('T')[0];
    let result: TransactionResult;

    switch (type) {
      case 'invest':
        result = await handleInvest(req, {
          ticker, shares, asset_type, from_asset_id, to_asset_id, amount, currency, flowDate, description,
          metadata, ownershipValues, viewContext,
        });
        break;
      case 'sell':
        result = await handleSell(req, {
          ticker, shares, from_asset_id, to_asset_id, amount, currency, flowDate, description,
          metadata, ownershipValues, viewContext,
        });
        break;
      case 'transfer':
        result = await handleTransfer(req, {
          from_asset_id, to_asset_id, amount, currency, flowDate, description,
          metadata, ownershipValues, viewContext,
        });
        break;
      case 'add':
        result = await handleAdd(req, {
          name, ticker, asset_type, amount, currency, flowDate, description,
          metadata, ownershipValues, viewContext,
        });
        break;
      default:
        res.status(400).json({ success: false, error: 'Invalid transaction type' });
        return;
    }

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('Transaction error:', err);
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to process transaction' });
  }
};

/**
 * Handle invest (buy) transaction
 * - Find or create asset by ticker
 * - Decrease from_asset_id balance (cash)
 * - Increase asset balance (shares)
 * - Log to flow
 */
async function handleInvest(
  req: AuthenticatedRequest,
  params: {
    ticker?: string;
    shares?: number;
    asset_type?: string;
    from_asset_id?: string;
    to_asset_id?: string;
    amount: number;
    currency: string;
    flowDate: string;
    description?: string;
    metadata?: Record<string, unknown>;
    ownershipValues: Record<string, unknown>;
    viewContext: ViewContext;
  }
): Promise<TransactionResult> {
  const {
    ticker, shares, asset_type, from_asset_id, to_asset_id, amount, currency, flowDate, description,
    ownershipValues, viewContext,
  } = params;

  // Validate required fields - either ticker or to_asset_id required
  if (!ticker && !to_asset_id) {
    throw new AppError('Invest requires ticker or to_asset_id', 400);
  }
  if (shares === undefined || shares <= 0) {
    throw new AppError('Invest requires positive shares/quantity', 400);
  }

  let asset: Asset;

  // If to_asset_id is provided, use that asset directly (e.g., metals, pre-created assets)
  if (to_asset_id) {
    const assetQuery = applyOwnershipFilterWithId(
      supabaseAdmin.from('assets').select('*'),
      to_asset_id,
      viewContext
    );
    const { data: existingAsset } = await assetQuery.single();
    if (!existingAsset) {
      throw new AppError('Target asset not found', 400);
    }
    asset = existingAsset;
  } else {
    // Find or create asset by ticker
    const tickerUpper = ticker!.toUpperCase();

    let assetQuery = supabaseAdmin
      .from('assets')
      .select('*')
      .eq('ticker', tickerUpper);
    assetQuery = applyOwnershipFilter(assetQuery, viewContext);
    const { data: existingAsset } = await assetQuery.single();

    if (existingAsset) {
      asset = existingAsset;
    } else {
      // Auto-create asset
      const detectedType = asset_type || detectAssetType(tickerUpper);
      const { data: newAsset, error: createError } = await supabaseAdmin
        .from('assets')
        .insert({
          ...ownershipValues,
          name: tickerUpper,
          ticker: tickerUpper,
          type: detectedType,
          currency: currency,
          balance: 0,
        })
        .select()
        .single();

      if (createError || !newAsset) {
        throw new AppError('Failed to create asset', 500);
      }
      asset = newAsset;
    }
  }

  // Get display name for description
  const assetDisplayName = ticker?.toUpperCase() || asset.ticker || asset.name;

  // Decrease from_asset (cash) balance if provided
  let fromAsset: Asset | undefined;
  if (from_asset_id) {
    const fromAssetQuery = applyOwnershipFilterWithId(
      supabaseAdmin.from('assets').select('*'),
      from_asset_id,
      viewContext
    );
    const { data: fa } = await fromAssetQuery.single();
    if (!fa) {
      throw new AppError('From asset not found', 400);
    }
    fromAsset = fa;

    // Convert amount if currencies differ
    let deductAmount = amount;
    if (currency.toLowerCase() !== (fa.currency || 'USD').toLowerCase()) {
      const rateMap = await getExchangeRates([currency.toLowerCase(), (fa.currency || 'USD').toLowerCase()]);
      const conversion = convertAmount(amount, currency, fa.currency || 'USD', rateMap);
      if (conversion) {
        deductAmount = conversion.converted;
      }
    }

    // Prevent negative balance
    const newBalance = Math.max(0, Number(fa.balance) - deductAmount);
    await supabaseAdmin
      .from('assets')
      .update({ balance: newBalance, balance_updated_at: new Date().toISOString() })
      .eq('id', from_asset_id);
  }

  // Increase asset (shares) balance
  const newAssetBalance = Number(asset.balance) + shares;
  const { data: updatedAsset } = await supabaseAdmin
    .from('assets')
    .update({ balance: newAssetBalance, balance_updated_at: new Date().toISOString() })
    .eq('id', asset.id)
    .select()
    .single();

  // Log to transactions table
  const pricePerShare = shares > 0 && amount > 0 ? amount / shares : null;
  const { data: transaction, error: txError } = await supabaseAdmin
    .from('transactions')
    .insert({
      belong_id: ownershipValues.belong_id,
      type: 'buy',
      category: 'invest',
      amount: amount,
      currency: currency,
      date: flowDate,
      asset_id: asset.id,  // Primary: the investment
      source_asset_id: from_asset_id || null,  // Cash account used
      shares: shares,
      price_per_share: pricePerShare,
      description: description || `Buy ${shares} ${assetDisplayName}`,
      metadata: { ...params.metadata, ticker: asset.ticker || assetDisplayName },
    })
    .select()
    .single();

  if (txError) {
    throw new AppError('Failed to log transaction', 500);
  }

  return {
    transaction_id: transaction.id,
    asset: updatedAsset || asset,
    from_asset: fromAsset,
  };
}

/**
 * Handle sell transaction
 * - Find asset by ticker or from_asset_id
 * - Decrease asset balance (shares)
 * - Increase to_asset_id balance (cash proceeds)
 * - Log to flow
 */
async function handleSell(
  req: AuthenticatedRequest,
  params: {
    ticker?: string;
    shares?: number;
    from_asset_id?: string;
    to_asset_id?: string;
    amount: number;
    currency: string;
    flowDate: string;
    description?: string;
    metadata?: Record<string, unknown>;
    ownershipValues: Record<string, unknown>;
    viewContext: ViewContext;
  }
): Promise<TransactionResult> {
  const {
    ticker, shares, from_asset_id, to_asset_id, amount, currency, flowDate, description,
    ownershipValues, viewContext,
  } = params;

  // Validate required fields
  if (shares === undefined || shares <= 0) {
    throw new AppError('Sell requires positive shares', 400);
  }
  if (!ticker && !from_asset_id) {
    throw new AppError('Sell requires ticker or from_asset_id', 400);
  }

  // Find the asset to sell
  let asset: Asset;
  if (from_asset_id) {
    const assetQuery = applyOwnershipFilterWithId(
      supabaseAdmin.from('assets').select('*'),
      from_asset_id,
      viewContext
    );
    const { data: a } = await assetQuery.single();
    if (!a) {
      throw new AppError('Asset not found', 400);
    }
    asset = a;
  } else {
    const tickerUpper = ticker!.toUpperCase();
    let assetQuery = supabaseAdmin
      .from('assets')
      .select('*')
      .eq('ticker', tickerUpper);
    assetQuery = applyOwnershipFilter(assetQuery, viewContext);
    const { data: a } = await assetQuery.single();
    if (!a) {
      throw new AppError(`Asset ${tickerUpper} not found`, 400);
    }
    asset = a;
  }

  // Check sufficient shares
  if (Number(asset.balance) < shares) {
    throw new AppError(`Insufficient shares. Have ${asset.balance}, trying to sell ${shares}`, 400);
  }

  // Decrease asset (shares) balance (prevent negative)
  const newAssetBalance = Math.max(0, Number(asset.balance) - shares);
  const { data: updatedAsset } = await supabaseAdmin
    .from('assets')
    .update({ balance: newAssetBalance, balance_updated_at: new Date().toISOString() })
    .eq('id', asset.id)
    .select()
    .single();

  // Increase to_asset (cash) balance if provided
  let toAsset: Asset | undefined;
  if (to_asset_id) {
    const toAssetQuery = applyOwnershipFilterWithId(
      supabaseAdmin.from('assets').select('*'),
      to_asset_id,
      viewContext
    );
    const { data: ta } = await toAssetQuery.single();
    if (!ta) {
      throw new AppError('To asset not found', 400);
    }
    toAsset = ta;

    // Convert amount if currencies differ
    let addAmount = amount;
    if (currency.toLowerCase() !== (ta.currency || 'USD').toLowerCase()) {
      const rateMap = await getExchangeRates([currency.toLowerCase(), (ta.currency || 'USD').toLowerCase()]);
      const conversion = convertAmount(amount, currency, ta.currency || 'USD', rateMap);
      if (conversion) {
        addAmount = conversion.converted;
      }
    }

    const newBalance = Number(ta.balance) + addAmount;
    await supabaseAdmin
      .from('assets')
      .update({ balance: newBalance, balance_updated_at: new Date().toISOString() })
      .eq('id', to_asset_id);
  }

  // Log to transactions table
  const pricePerShare = shares > 0 && amount > 0 ? amount / shares : null;
  const { data: transaction, error: txError } = await supabaseAdmin
    .from('transactions')
    .insert({
      belong_id: ownershipValues.belong_id,
      type: 'sell',
      category: 'sell',
      amount: amount,
      currency: currency,
      date: flowDate,
      asset_id: asset.id,  // Primary: the investment being sold
      source_asset_id: to_asset_id || null,  // Cash account receiving proceeds
      shares: shares,
      price_per_share: pricePerShare,
      description: description || `Sell ${shares} ${asset.ticker || asset.name}`,
      metadata: { ...params.metadata, ticker: asset.ticker },
    })
    .select()
    .single();

  if (txError) {
    throw new AppError('Failed to log transaction', 500);
  }

  return {
    transaction_id: transaction.id,
    asset: updatedAsset || asset,
    to_asset: toAsset,
  };
}

/**
 * Handle transfer transaction
 * - Decrease from_asset balance
 * - Increase to_asset balance
 * - Log to flow
 */
async function handleTransfer(
  req: AuthenticatedRequest,
  params: {
    from_asset_id?: string;
    to_asset_id?: string;
    amount: number;
    currency: string;
    flowDate: string;
    description?: string;
    metadata?: Record<string, unknown>;
    ownershipValues: Record<string, unknown>;
    viewContext: ViewContext;
  }
): Promise<TransactionResult> {
  const {
    from_asset_id, to_asset_id, amount, currency, flowDate, description,
    ownershipValues, viewContext,
  } = params;

  // Validate required fields
  if (!from_asset_id || !to_asset_id) {
    throw new AppError('Transfer requires both from_asset_id and to_asset_id', 400);
  }
  if (from_asset_id === to_asset_id) {
    throw new AppError('Cannot transfer to the same asset', 400);
  }

  // Fetch both assets
  const [fromAssetResult, toAssetResult] = await Promise.all([
    applyOwnershipFilterWithId(supabaseAdmin.from('assets').select('*'), from_asset_id, viewContext).single(),
    applyOwnershipFilterWithId(supabaseAdmin.from('assets').select('*'), to_asset_id, viewContext).single(),
  ]);

  if (!fromAssetResult.data) {
    throw new AppError('From asset not found', 400);
  }
  if (!toAssetResult.data) {
    throw new AppError('To asset not found', 400);
  }

  const fromAsset = fromAssetResult.data;
  const toAsset = toAssetResult.data;

  // Get exchange rates if needed
  const currencies = new Set<string>([
    currency.toLowerCase(),
    (fromAsset.currency || 'USD').toLowerCase(),
    (toAsset.currency || 'USD').toLowerCase(),
  ]);
  const rateMap = await getExchangeRates(Array.from(currencies));

  // Decrease from_asset balance
  let fromDeduct = amount;
  if (currency.toLowerCase() !== (fromAsset.currency || 'USD').toLowerCase()) {
    const conversion = convertAmount(amount, currency, fromAsset.currency || 'USD', rateMap);
    if (conversion) fromDeduct = conversion.converted;
  }
  const newFromBalance = Math.max(0, Number(fromAsset.balance) - fromDeduct);

  // Increase to_asset balance
  let toAdd = amount;
  if (currency.toLowerCase() !== (toAsset.currency || 'USD').toLowerCase()) {
    const conversion = convertAmount(amount, currency, toAsset.currency || 'USD', rateMap);
    if (conversion) toAdd = conversion.converted;
  }
  const newToBalance = Number(toAsset.balance) + toAdd;

  // Update both assets
  await Promise.all([
    supabaseAdmin.from('assets').update({ balance: newFromBalance, balance_updated_at: new Date().toISOString() }).eq('id', from_asset_id),
    supabaseAdmin.from('assets').update({ balance: newToBalance, balance_updated_at: new Date().toISOString() }).eq('id', to_asset_id),
  ]);

  // Log transfer as TWO transactions linked by transfer_id
  const transferId = crypto.randomUUID();

  // Transaction 1: Expense from source
  const { data: txOut, error: txOutError } = await supabaseAdmin
    .from('transactions')
    .insert({
      belong_id: ownershipValues.belong_id,
      type: 'expense',
      category: 'transfer',
      amount: amount,
      currency: currency,
      date: flowDate,
      asset_id: from_asset_id,  // Primary: source account
      source_asset_id: to_asset_id,  // Reference to destination
      description: description || `Transfer to ${toAsset.name}`,
      metadata: { ...params.metadata, transfer_id: transferId, transfer_type: 'out' },
    })
    .select()
    .single();

  if (txOutError) {
    throw new AppError('Failed to log transaction', 500);
  }

  // Transaction 2: Income to destination
  const { data: txIn, error: txInError } = await supabaseAdmin
    .from('transactions')
    .insert({
      belong_id: ownershipValues.belong_id,
      type: 'income',
      category: 'transfer',
      amount: amount,
      currency: currency,
      date: flowDate,
      asset_id: to_asset_id,  // Primary: destination account
      source_asset_id: from_asset_id,  // Reference to source
      description: description || `Transfer from ${fromAsset.name}`,
      metadata: { ...params.metadata, transfer_id: transferId, transfer_type: 'in' },
    })
    .select()
    .single();

  if (txInError) {
    throw new AppError('Failed to log transaction', 500);
  }

  return {
    transaction_id: txOut.id,
    from_asset: { ...fromAsset, balance: newFromBalance },
    to_asset: { ...toAsset, balance: newToBalance },
  };
}

/**
 * Handle add (new asset with initial balance) transaction
 * - Create new asset
 * - Set initial balance
 * - Log to flow
 */
async function handleAdd(
  req: AuthenticatedRequest,
  params: {
    name?: string;
    ticker?: string;
    asset_type?: string;
    amount: number;
    currency: string;
    flowDate: string;
    description?: string;
    metadata?: Record<string, unknown>;
    ownershipValues: Record<string, unknown>;
    viewContext: ViewContext;
  }
): Promise<TransactionResult> {
  const {
    name, ticker, asset_type, amount, currency, flowDate, description,
    ownershipValues,
  } = params;

  // Validate required fields
  const assetName = name || ticker;
  if (!assetName) {
    throw new AppError('Add requires name or ticker', 400);
  }

  // Determine asset type
  let finalAssetType = asset_type || 'cash';
  if (ticker && !asset_type) {
    finalAssetType = detectAssetType(ticker);
  }

  // Create the asset
  const { data: asset, error: assetError } = await supabaseAdmin
    .from('assets')
    .insert({
      ...ownershipValues,
      name: assetName,
      ticker: ticker?.toUpperCase() || null,
      type: finalAssetType,
      currency: currency,
      balance: amount,
      balance_updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (assetError) {
    if (assetError.code === '23505') {
      throw new AppError('An asset with this name already exists', 400);
    }
    throw new AppError('Failed to create asset', 500);
  }

  // Log to transactions table
  const { data: transaction, error: txError } = await supabaseAdmin
    .from('transactions')
    .insert({
      belong_id: ownershipValues.belong_id,
      type: 'income',
      category: 'initial_balance',
      amount: amount,
      currency: currency,
      date: flowDate,
      asset_id: asset.id,  // Primary: the new asset
      description: description || `Add ${assetName} with initial balance`,
      metadata: params.metadata || null,
    })
    .select()
    .single();

  if (txError) {
    throw new AppError('Failed to log transaction', 500);
  }

  return {
    transaction_id: transaction.id,
    asset: asset,
  };
}
