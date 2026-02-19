import { Request, Response } from 'express';
import * as findata from '../utils/findata-client';

interface StockPrice {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
}

/**
 * Get real-time stock prices for multiple symbols
 * GET /api/fire/stock-prices?symbols=AAPL,GOOGL,MSFT
 */
export const getStockPrices = async (req: Request, res: Response) => {
  try {
    const { symbols } = req.query;

    if (!symbols || typeof symbols !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'symbols query parameter is required',
      });
    }

    const symbolList = symbols
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    if (symbolList.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid symbols provided',
      });
    }

    if (symbolList.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 symbols allowed per request',
      });
    }

    // Fetch prices from findata service
    const priceData = await findata.fetchStockPrices(symbolList);

    // Convert to expected format
    const results: Record<string, StockPrice> = {};
    for (const [symbol, data] of Object.entries(priceData)) {
      if (data.price !== null) {
        results[symbol] = {
          symbol,
          price: data.price,
          previousClose: data.previous_close,
          change: data.change,
          changePercent: data.change_percent,
          currency: data.currency,
        };
      }
    }

    return res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('Error fetching stock prices:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch stock prices',
    });
  }
};
