import { Request, Response } from 'express';
import { COMMODITY_CONFIG, COMMODITY_TICKERS, UNIT_LABELS } from '../config/commodities';
import { fetchStockPrices } from '../utils/findata-client';
import { ApiResponse } from '../types';

export interface CommodityInfo {
  ticker: string;
  name: string;
  unit: string;
  unitLabel: string;
  currency: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

// GET /fire/commodities
export const listCommodities = async (
  _req: Request,
  res: Response<ApiResponse<CommodityInfo[]>>
): Promise<void> => {
  try {
    const prices = await fetchStockPrices([...COMMODITY_TICKERS]);

    const commodities: CommodityInfo[] = COMMODITY_TICKERS.map(ticker => {
      const config = COMMODITY_CONFIG[ticker];
      const priceData = prices[ticker];
      return {
        ticker,
        name: config.name,
        unit: config.unit,
        unitLabel: UNIT_LABELS[config.unit],
        currency: config.currency,
        price: priceData?.price ?? null,
        change: priceData?.change ?? null,
        changePercent: priceData?.change_percent ?? null,
      };
    });

    res.json({ success: true, data: commodities });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch commodity prices' });
  }
};
