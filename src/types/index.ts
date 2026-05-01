import { Request } from 'express';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Ledger {
  id: string;
  name: string;
  description: string | null;
  default_currency_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LedgerUser {
  id: string;
  ledger_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_by: string;
  created_at: string;
}

export interface Expense {
  id: string;
  name: string;
  ledger_id: string;
  category_id: string | null;
  description: string | null;
  amount: number;
  currency_id: string;
  payment_method_id: string | null;
  date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface ExpenseFilters extends PaginationParams {
  category_id?: string;
  payment_method_id?: string;
  start_date?: string;
  end_date?: string;
}

// Stats types
export interface CategoryStats {
  category_id: string | null;
  category_name: string;
  amount: number;
  percentage: number;
}

export interface ExpenseStatsResponse {
  total: number;
  currency_code: string;
  currency_id: string;
  by_category: CategoryStats[];
  start_date: string;
  end_date: string;
}

export interface StatsFilters {
  start_date?: string;
  end_date?: string;
  currency_id?: string;
}

// Monthly stats types
export interface MonthCategoryStats {
  category_id: string | null;
  category_name: string;
  amount: number;
}

export interface MonthTotal {
  month: string; // 'YYYY-MM' format
  total: number;
  by_category: MonthCategoryStats[];
}

export interface MonthlyStatsResponse {
  months: MonthTotal[];
  currency_code: string;
  currency_id: string;
}

// Asset types (debt is now in separate debts table)
export type AssetType = 'cash' | 'deposit' | 'stock' | 'etf' | 'bond' | 'real_estate' | 'crypto' | 'metals' | 'other';

export interface Asset {
  id: string;
  user_id: string;
  name: string;
  type: AssetType;
  ticker: string | null;
  currency: string;
  market: string | null;
  balance: number;
  balance_updated_at: string | null;
  metadata: Record<string, unknown> | null;
  growth_rates: { '5y': number | null; '10y': number | null; updated_at?: string } | null;
  created_at: string;
  updated_at: string;
}

// Alias for backward compatibility - Asset now includes balance directly
export type AssetWithBalance = Asset;

// =====================================================
// Transaction Types (New Atomic Design)
// =====================================================
// - income: Money added to asset (salary, dividend, interest)
// - expense: Money removed from asset (groceries, bills)
// - buy: Investment shares added
// - sell: Investment shares removed
// - debt_payment: Debt payment
// - loan: Loan disbursement (money received from a loan)
export type TransactionType = 'income' | 'expense' | 'buy' | 'sell' | 'debt_payment' | 'loan';

export interface Transaction {
  id: string;
  belong_id: string;
  type: TransactionType;
  category: string | null;
  amount: number;
  currency: string;
  date: string;

  // Asset references
  asset_id: string | null;         // PRIMARY: The asset affected
  source_asset_id: string | null;  // OPTIONAL: Source/context (dividend source, cash for buy, etc.)
  debt_id: string | null;          // For debt_payment type

  // Investment specific
  shares: number | null;
  price_per_share: number | null;

  // Metadata
  description: string | null;
  expense_category_id: string | null;
  schedule_id: string | null;
  metadata: Record<string, unknown> | null;
  needs_review: boolean;

  created_at: string;
  updated_at: string;
}

export interface TransactionWithDetails extends Transaction {
  asset?: Asset | null;
  source_asset?: Asset | null;
  debt?: Debt | null;
  expense_category?: ExpenseCategory | null;
  // Backward compatible fields for frontend
  from_asset?: Asset | null;
  to_asset?: Asset | null;
  from_asset_id?: string | null;
  to_asset_id?: string | null;
  user_id?: string;  // Alias for belong_id
  transaction_type?: TransactionType;  // Original transaction type before mapping
}

export interface TransactionFilters extends PaginationParams {
  type?: TransactionType;
  category?: string;
  start_date?: string;
  end_date?: string;
  asset_id?: string;
  source_asset_id?: string;
  debt_id?: string;
  needs_review?: boolean;
}

export interface TransactionStats {
  total_income: number;
  total_expense: number;
  total_investment: number;
  net_flow: number;
  currency: string;
  start_date: string;
  end_date: string;
}

export interface AssetFilters extends PaginationParams {
  type?: AssetType;
  search?: string; // Search by name or ticker
}

// Expense Category (FIRE-specific, separate from ledger categories)
export interface ExpenseCategory {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Debt types
export type DebtType = 'mortgage' | 'personal_loan' | 'credit_card' | 'student_loan' | 'auto_loan' | 'other';
export type DebtStatus = 'active' | 'paid_off';

export interface Debt {
  id: string;
  user_id: string;
  name: string;
  debt_type: DebtType;
  currency: string;
  principal: number;
  interest_rate: number | null;
  term_months: number | null;
  start_date: string | null;
  current_balance: number;
  monthly_payment: number | null;
  balance_updated_at: string | null;
  status: DebtStatus;
  paid_off_date: string | null;
  property_asset_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DebtFilters extends PaginationParams {
  status?: DebtStatus;
  debt_type?: DebtType;
}

// User Preferences (currency settings, expandable for future preferences)
export interface UserPreferences {
  id: string;
  user_id: string;
  preferred_currency: string;
  convert_all_to_preferred: boolean;
  created_at: string;
  updated_at: string;
}

// Family sharing types
export interface Family {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  // Joined profile data
  profile?: {
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}

export interface FamilyInvitation {
  id: string;
  family_id: string;
  email: string;
  token: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface FamilyWithMembers extends Family {
  members: FamilyMember[];
}

export interface CreateFamilyRequest {
  name: string;
  migrate_data?: boolean; // If true, migrate existing personal data to family
}

export interface InviteMemberRequest {
  email: string;
}

export interface AcceptInvitationRequest {
  migrate_data?: boolean; // If true, migrate existing personal data to family
}
