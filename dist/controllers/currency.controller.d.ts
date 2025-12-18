import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse, Currency } from '../types';
export declare const getCurrencies: (_req: AuthenticatedRequest, res: Response<ApiResponse<Currency[]>>) => Promise<void>;
export declare const createCurrency: (req: AuthenticatedRequest, res: Response<ApiResponse<Currency>>) => Promise<void>;
//# sourceMappingURL=currency.controller.d.ts.map