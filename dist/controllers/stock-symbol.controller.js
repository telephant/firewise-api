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
exports.searchUsSymbols = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Cache for loaded symbols
let usSymbolsCache = null;
/**
 * Load US stock symbols from JSON file (cached)
 */
const loadUsSymbols = () => {
    if (usSymbolsCache) {
        return usSymbolsCache;
    }
    try {
        const filePath = path.join(__dirname, '../../data/us-stock/symbols.json');
        const data = fs.readFileSync(filePath, 'utf-8');
        usSymbolsCache = JSON.parse(data);
        console.log(`Loaded ${usSymbolsCache.length} US stock symbols`);
        return usSymbolsCache;
    }
    catch (error) {
        console.error('Failed to load US stock symbols:', error);
        return [];
    }
};
/**
 * Search US stock symbols
 * GET /api/stock-symbols/us?search=AAPL
 */
const searchUsSymbols = async (req, res) => {
    try {
        const { search = '', limit = '20' } = req.query;
        const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
        const searchTerm = search.trim().toUpperCase();
        if (!searchTerm) {
            res.json({
                success: true,
                data: { symbols: [], total: 0 },
            });
            return;
        }
        const allSymbols = loadUsSymbols();
        // Single pass: categorize into symbol matches vs name-only matches
        const symbolMatches = [];
        const nameMatches = [];
        for (const s of allSymbols) {
            const upperSymbol = s.symbol.toUpperCase();
            if (upperSymbol.startsWith(searchTerm)) {
                symbolMatches.push(s);
            }
            else if (s.security_name.toUpperCase().includes(searchTerm)) {
                nameMatches.push(s);
            }
        }
        // Sort symbol matches: exact first, then alphabetically
        symbolMatches.sort((a, b) => {
            const aExact = a.symbol.toUpperCase() === searchTerm;
            const bExact = b.symbol.toUpperCase() === searchTerm;
            if (aExact !== bExact)
                return aExact ? -1 : 1;
            return a.symbol.localeCompare(b.symbol);
        });
        // Sort name matches alphabetically
        nameMatches.sort((a, b) => a.symbol.localeCompare(b.symbol));
        // Combine: symbol matches first, then name matches (limit applied)
        const matches = [...symbolMatches, ...nameMatches].slice(0, limitNum);
        const result = matches.map((s) => ({
            symbol: s.symbol,
            name: s.security_name,
        }));
        res.json({
            success: true,
            data: { symbols: result, total: matches.length },
        });
    }
    catch (error) {
        console.error('Error searching US symbols:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search stock symbols',
        });
    }
};
exports.searchUsSymbols = searchUsSymbols;
//# sourceMappingURL=stock-symbol.controller.js.map