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
exports.searchSymbols = void 0;
const findata = __importStar(require("../utils/findata-client"));
/**
 * Search symbols using findata service
 * GET /api/symbols/ticker-search?q=AAPL&region=US&type=stock,etf&limit=10
 *
 * Query params:
 *   - q: Search query (required, min 1 char)
 *   - region: Market region ('US', 'HK', 'UK', 'SG', 'JP', 'CN', etc.)
 *   - type: Filter by type ('stock', 'etf', 'future', 'crypto', 'index', 'currency', 'fund')
 *   - limit: Max results (default 10, max 20)
 */
const searchSymbols = async (req, res) => {
    try {
        const { q = '', region, type, limit = '10' } = req.query;
        const searchTerm = q.trim();
        if (!searchTerm) {
            res.json({
                success: true,
                data: { symbols: [], total: 0 },
            });
            return;
        }
        const maxResults = Math.min(parseInt(limit, 10) || 10, 20);
        // Handle comma-separated types - use first one for findata API
        let searchType;
        if (type && type !== 'all') {
            const types = type.split(',').map((t) => t.trim());
            searchType = types[0]; // Use first type for API call
        }
        // Fetch from findata service
        const results = await findata.searchSymbols(searchTerm, {
            region: region,
            type: searchType,
            limit: maxResults * 2, // Request extra for client-side filtering
        });
        // Transform to expected format
        let symbols = results.map((r) => ({
            symbol: r.symbol,
            name: r.short_name || r.long_name || r.symbol,
            longName: r.long_name || undefined,
            type: r.quote_type || 'other',
            exchange: r.exchange || '',
            exchangeDisplay: r.exchange_display || r.exchange || '',
            sector: r.sector || undefined,
            industry: r.industry || undefined,
        }));
        // Additional client-side filtering if multiple types specified
        if (type && type !== 'all' && type.includes(',')) {
            const allowedTypes = new Set(type.split(',').map((t) => t.trim()));
            symbols = symbols.filter((s) => allowedTypes.has(s.type));
        }
        // Limit results
        symbols = symbols.slice(0, maxResults);
        res.json({
            success: true,
            data: { symbols, total: symbols.length },
        });
    }
    catch (error) {
        console.error('Symbol search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search symbols',
        });
    }
};
exports.searchSymbols = searchSymbols;
//# sourceMappingURL=stock-symbol.controller.js.map