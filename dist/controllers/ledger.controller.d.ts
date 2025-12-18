import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse, Ledger, LedgerUser, Profile } from '../types';
interface LedgerWithRole extends Ledger {
    role: 'owner' | 'member';
}
interface LedgerMember {
    user_id: string;
    role: 'owner' | 'member';
    created_at: string;
    profile: Profile;
}
export declare const getLedgers: (req: AuthenticatedRequest, res: Response<ApiResponse<LedgerWithRole[]>>) => Promise<void>;
export declare const getLedger: (req: AuthenticatedRequest, res: Response<ApiResponse<LedgerWithRole>>) => Promise<void>;
export declare const createLedger: (req: AuthenticatedRequest, res: Response<ApiResponse<LedgerWithRole>>) => Promise<void>;
export declare const updateLedger: (req: AuthenticatedRequest, res: Response<ApiResponse<Ledger>>) => Promise<void>;
export declare const deleteLedger: (req: AuthenticatedRequest, res: Response<ApiResponse>) => Promise<void>;
export declare const getLedgerMembers: (req: AuthenticatedRequest, res: Response<ApiResponse<LedgerMember[]>>) => Promise<void>;
export declare const inviteUser: (req: AuthenticatedRequest, res: Response<ApiResponse<LedgerUser>>) => Promise<void>;
export declare const removeMember: (req: AuthenticatedRequest, res: Response<ApiResponse>) => Promise<void>;
export {};
//# sourceMappingURL=ledger.controller.d.ts.map