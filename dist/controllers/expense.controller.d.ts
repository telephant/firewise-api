import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse, Expense } from '../types';
interface ExpenseWithDetails extends Expense {
    category?: {
        id: string;
        name: string;
    } | null;
    currency?: {
        id: string;
        code: string;
        name: string;
    } | null;
    payment_method?: {
        id: string;
        name: string;
    } | null;
    created_by_profile?: {
        full_name: string;
        email: string;
    } | null;
}
export declare const getExpenses: (req: AuthenticatedRequest, res: Response<ApiResponse<{
    expenses: ExpenseWithDetails[];
    total: number;
}>>) => Promise<void>;
export declare const getExpense: (req: AuthenticatedRequest, res: Response<ApiResponse<ExpenseWithDetails>>) => Promise<void>;
export declare const createExpense: (req: AuthenticatedRequest, res: Response<ApiResponse<Expense>>) => Promise<void>;
export declare const updateExpense: (req: AuthenticatedRequest, res: Response<ApiResponse<Expense>>) => Promise<void>;
export declare const deleteExpense: (req: AuthenticatedRequest, res: Response<ApiResponse>) => Promise<void>;
export {};
//# sourceMappingURL=expense.controller.d.ts.map