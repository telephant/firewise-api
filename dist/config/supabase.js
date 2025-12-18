"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAnonKey = exports.supabaseUrl = exports.supabaseAdmin = exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabaseUrl = process.env.SUPABASE_URL;
exports.supabaseUrl = supabaseUrl;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
exports.supabaseAnonKey = supabaseAnonKey;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}
// Client for authenticated user requests (uses RLS)
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey);
// Admin client for server-side operations (bypasses RLS)
exports.supabaseAdmin = supabaseServiceRoleKey
    ? (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
    : exports.supabase;
//# sourceMappingURL=supabase.js.map