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
  rate: number;
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
