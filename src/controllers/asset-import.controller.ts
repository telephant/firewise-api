import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, AssetType } from '../types';
import { AppError } from '../middleware/error';

// Agent service URL (same as runway agent - now multi-agent service)
const AGENT_SERVICE_URL = process.env.RUNWAY_AGENT_URL || 'http://localhost:8000';

// Types matching agent service schemas
interface ExtractedAsset {
  name: string;
  type: AssetType;
  ticker: string | null;
  shares: number;
  currency: string;
  market: string | null;
  current_price: number | null;
  total_value: number | null;
  confidence: number;
}

interface SourceInfo {
  broker: string | null;
  statement_date: string | null;
  account_type: string | null;
}

interface AgentImportResponse {
  assets: ExtractedAsset[];
  source_info: SourceInfo;
  warnings: string[];
  confidence: number;
}

// Response to frontend includes existing assets info
interface AnalyzeImportResponse {
  extracted: ExtractedAsset[];
  source_info: SourceInfo;
  warnings: string[];
  confidence: number;
  existing_tickers: Record<string, { asset_id: string; name: string; balance: number }>;
}

// Types for confirm endpoint
type DuplicateAction = 'skip' | 'update' | 'create';

interface AssetToImport {
  name: string;
  type: AssetType;
  ticker: string | null;
  shares: number;
  currency: string;
  market: string | null;
}

interface ConfirmImportRequest {
  assets: AssetToImport[];
  duplicate_actions: Record<string, DuplicateAction>; // ticker -> action
}

interface ConfirmImportResponse {
  created: number;
  updated: number;
  skipped: number;
  assets: Asset[];
}

/**
 * Analyze import file
 * POST /api/fire/assets/import/analyze
 *
 * Body: { file: string (base64), fileType: 'pdf' | 'csv' | 'xlsx', fileName?: string }
 */
export const analyzeImport = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<AnalyzeImportResponse>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { file, fileType, fileName } = req.body;

    if (!file || !fileType) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: file and fileType',
      });
      return;
    }

    if (!['pdf', 'csv', 'xlsx'].includes(fileType)) {
      res.status(400).json({
        success: false,
        error: 'Unsupported file type. Supported: pdf, csv, xlsx',
      });
      return;
    }

    // Call agent service for extraction
    const agentResponse = await callImportAgent(file, fileType, fileName);

    // Get existing assets with tickers to check for duplicates
    const { data: existingAssets } = await supabaseAdmin
      .from('assets')
      .select('id, name, ticker, balance')
      .eq('user_id', userId)
      .not('ticker', 'is', null);

    // Build map of existing tickers
    const existingTickers: Record<string, { asset_id: string; name: string; balance: number }> = {};
    (existingAssets || []).forEach((asset) => {
      if (asset.ticker) {
        existingTickers[asset.ticker.toUpperCase()] = {
          asset_id: asset.id,
          name: asset.name,
          balance: asset.balance,
        };
      }
    });

    res.json({
      success: true,
      data: {
        extracted: agentResponse.assets,
        source_info: agentResponse.source_info,
        warnings: agentResponse.warnings,
        confidence: agentResponse.confidence,
        existing_tickers: existingTickers,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in analyzeImport:', err);
    res.status(500).json({ success: false, error: 'Failed to analyze import file' });
  }
};

/**
 * Confirm and create assets from import
 * POST /api/fire/assets/import/confirm
 *
 * Body: { assets: AssetToImport[], duplicate_actions: Record<ticker, 'skip' | 'update' | 'create'> }
 */
export const confirmImport = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ConfirmImportResponse>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { assets, duplicate_actions }: ConfirmImportRequest = req.body;

    if (!assets || !Array.isArray(assets) || assets.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No assets provided to import',
      });
      return;
    }

    // Get existing assets with tickers
    const { data: existingAssets } = await supabaseAdmin
      .from('assets')
      .select('id, ticker, balance')
      .eq('user_id', userId)
      .not('ticker', 'is', null);

    const existingByTicker = new Map<string, { id: string; balance: number }>();
    (existingAssets || []).forEach((asset) => {
      if (asset.ticker) {
        existingByTicker.set(asset.ticker.toUpperCase(), { id: asset.id, balance: asset.balance });
      }
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const createdAssets: Asset[] = [];

    for (const asset of assets) {
      const tickerKey = asset.ticker?.toUpperCase();
      const existing = tickerKey ? existingByTicker.get(tickerKey) : null;
      const action = tickerKey && duplicate_actions?.[tickerKey] ? duplicate_actions[tickerKey] : 'create';

      if (existing && action === 'skip') {
        skipped++;
        continue;
      }

      if (existing && action === 'update') {
        // Update existing asset's balance (shares)
        const { error } = await supabaseAdmin
          .from('assets')
          .update({
            balance: asset.shares,
            balance_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (error) {
          console.error('Error updating asset:', error);
          continue;
        }
        updated++;
      } else {
        // Create new asset
        const newAsset = {
          user_id: userId,
          name: asset.name,
          type: asset.type,
          ticker: asset.ticker,
          currency: asset.currency,
          market: asset.market,
          balance: asset.shares,
          balance_updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabaseAdmin
          .from('assets')
          .insert(newAsset)
          .select()
          .single();

        if (error) {
          console.error('Error creating asset:', error);
          continue;
        }

        created++;
        createdAssets.push(data as Asset);
      }
    }

    res.json({
      success: true,
      data: {
        created,
        updated,
        skipped,
        assets: createdAssets,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in confirmImport:', err);
    res.status(500).json({ success: false, error: 'Failed to import assets' });
  }
};

/**
 * Call the import agent service
 */
async function callImportAgent(
  fileContent: string,
  fileType: string,
  fileName?: string
): Promise<AgentImportResponse> {
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/import/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_content: fileContent,
        file_type: fileType,
        file_name: fileName,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Import agent service error:', errorText);
      throw new AppError(`Import agent error: ${response.status}`, 500);
    }

    return (await response.json()) as AgentImportResponse;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Failed to call import agent service:', err);
    throw new AppError('Failed to connect to import agent service', 500);
  }
}
