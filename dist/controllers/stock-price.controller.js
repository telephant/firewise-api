"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockPrices = void 0;
// Cache for stock prices (5 minute TTL)
const priceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
/**
 * Get real-time stock prices for multiple symbols
 * GET /api/fire/stock-prices?symbols=AAPL,GOOGL,MSFT
 */
const getStockPrices = async (req, res) => {
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
        const now = Date.now();
        const results = {};
        const symbolsToFetch = [];
        // Check cache first
        for (const symbol of symbolList) {
            const cached = priceCache.get(symbol);
            if (cached && now - cached.timestamp < CACHE_TTL) {
                results[symbol] = cached.data;
            }
            else {
                symbolsToFetch.push(symbol);
            }
        }
        // Fetch prices for symbols not in cache
        if (symbolsToFetch.length > 0) {
            const fetchPromises = symbolsToFetch.map((symbol) => fetchStockPrice(symbol));
            const fetchedPrices = await Promise.allSettled(fetchPromises);
            fetchedPrices.forEach((result, index) => {
                const symbol = symbolsToFetch[index];
                if (result.status === 'fulfilled' && result.value) {
                    results[symbol] = result.value;
                    priceCache.set(symbol, { data: result.value, timestamp: now });
                }
            });
        }
        return res.json({
            success: true,
            data: results,
        });
    }
    catch (error) {
        console.error('Error fetching stock prices:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch stock prices',
        });
    }
};
exports.getStockPrices = getStockPrices;
async function fetchStockPrice(symbol) {
    try {
        const now = Math.floor(Date.now() / 1000);
        const oneDayAgo = now - 86400;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${oneDayAgo}&period2=${now}&interval=1d&includePrePost=false&events=div%7Csplit&lang=en-US&region=US`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });
        if (!response.ok) {
            console.error(`Yahoo Finance API error for ${symbol}: ${response.status}`);
            return null;
        }
        const data = (await response.json());
        if (data.chart.error || !data.chart.result?.[0]) {
            console.error(`No data for symbol ${symbol}`);
            return null;
        }
        const meta = data.chart.result[0].meta;
        const price = meta.regularMarketPrice;
        const previousClose = meta.previousClose;
        const change = price - previousClose;
        const changePercent = (change / previousClose) * 100;
        return {
            symbol,
            price,
            previousClose,
            change,
            changePercent,
            currency: meta.currency || 'USD',
        };
    }
    catch (error) {
        console.error(`Error fetching price for ${symbol}:`, error);
        return null;
    }
}
//# sourceMappingURL=stock-price.controller.js.map