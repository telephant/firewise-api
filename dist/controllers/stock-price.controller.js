"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockPrices = void 0;
const findata = __importStar(require("../utils/findata-client"));
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
        // Fetch prices from findata service
        const priceData = await findata.fetchStockPrices(symbolList);
        // Convert to expected format
        const results = {};
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
//# sourceMappingURL=stock-price.controller.js.map