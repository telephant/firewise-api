import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
export declare class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    constructor(message: string, statusCode: number);
}
export declare const errorHandler: (err: Error | AppError, _req: Request, res: Response<ApiResponse>, _next: NextFunction) => void;
export declare const notFoundHandler: (req: Request, res: Response<ApiResponse>) => void;
//# sourceMappingURL=error.d.ts.map