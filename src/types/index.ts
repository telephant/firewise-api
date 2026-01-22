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
export type AssetType = 'cash' | 'deposit' | 'stock' | 'etf' | 'bond' | 'real_estate' | 'crypto' | 'other';

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

// Flow types (Unified Flow Model)
// Income:   [External] → [Your Asset]
// Expense:  [Your Asset] → [External]
// Transfer: [Your Asset] → [Your Asset]
// Other:    Balance corrections, misc adjustments
export type FlowType = 'income' | 'expense' | 'transfer' | 'other';

export interface Flow {
  id: string;
  user_id: string;
  type: FlowType;
  amount: number; // For dividends, this is NET amount (after tax). Tax info in metadata.
  currency: string;
  from_asset_id: string | null;
  to_asset_id: string | null;
  debt_id: string | null; // Reference to debt for debt payments
  category: string | null;
  date: string;
  description: string | null;
  flow_expense_category_id: string | null;
  schedule_id: string | null; // Reference to recurring schedule that generated this flow
  metadata: Record<string, unknown> | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface FlowWithDetails extends Flow {
  from_asset?: Asset | null;
  to_asset?: Asset | null;
  flow_expense_category?: FlowExpenseCategory | null;
}

export interface FlowFilters extends PaginationParams {
  type?: FlowType;
  start_date?: string;
  end_date?: string;
  asset_id?: string;
  needs_review?: boolean;
}

export interface FlowStatsResponse {
  total_income: number;
  total_expense: number;
  total_transfer: number;
  net_flow: number;
  currency: string;
  start_date: string;
  end_date: string;
}

export interface AssetFilters extends PaginationParams {
  type?: AssetType;
}

// Flow Expense Category (FIRE-specific, separate from ledger categories)
export interface FlowExpenseCategory {
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

// Recurring Schedule types
export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface FlowTemplate {
  type: FlowType;
  amount: number;
  currency: string;
  from_asset_id: string | null;
  to_asset_id: string | null;
  debt_id: string | null;
  category: string | null;
  description: string | null;
  flow_expense_category_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RecurringSchedule {
  id: string;
  user_id: string;
  source_flow_id: string | null;
  frequency: ScheduleFrequency;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  flow_template: FlowTemplate;
  created_at: string;
  updated_at: string;
}

export interface RecurringScheduleFilters extends PaginationParams {
  is_active?: boolean;
  frequency?: ScheduleFrequency;
}

export interface ProcessRecurringResult {
  processed: number;
  created_flows: string[];
  errors: { schedule_id: string; error: string }[];
}
