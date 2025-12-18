import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse, PaymentMethod } from '../types';
export declare const getPaymentMethods: (req: AuthenticatedRequest, res: Response<ApiResponse<PaymentMethod[]>>) => Promise<void>;
export declare const createPaymentMethod: (req: AuthenticatedRequest, res: Response<ApiResponse<PaymentMethod>>) => Promise<void>;
export declare const deletePaymentMethod: (req: AuthenticatedRequest, res: Response<ApiResponse>) => Promise<void>;
//# sourceMappingURL=payment-method.controller.d.ts.map