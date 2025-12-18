import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse, ExpenseCategory } from '../types';
export declare const getCategories: (req: AuthenticatedRequest, res: Response<ApiResponse<ExpenseCategory[]>>) => Promise<void>;
export declare const createCategory: (req: AuthenticatedRequest, res: Response<ApiResponse<ExpenseCategory>>) => Promise<void>;
export declare const deleteCategory: (req: AuthenticatedRequest, res: Response<ApiResponse>) => Promise<void>;
//# sourceMappingURL=category.controller.d.ts.map