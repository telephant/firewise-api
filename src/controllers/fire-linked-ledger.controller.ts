import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext, applyOwnershipFilter, buildOwnershipValues } from '../utils/family-context';

interface FireLinkedLedger {
  id: string;
  user_id: string;
  ledger_id: string;
  created_at: string;
  ledger?: {
    id: string;
    name: string;
    description: string | null;
  };
}

// Get all linked ledgers for the authenticated user/family
export const getFireLinkedLedgers = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FireLinkedLedger[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get view context for family/personal mode
    const viewContext = await getViewContext(req);

    const { data: linkedLedgers, error } = await applyOwnershipFilter(
      supabaseAdmin.from('fire_linked_ledgers').select(`
        *,
        ledger:ledgers(id, name, description)
      `),
      viewContext
    );

    if (error) {
      console.error('Error fetching fire linked ledgers:', error);
      throw new AppError('Failed to fetch linked ledgers', 500);
    }

    res.json({ success: true, data: linkedLedgers || [] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getFireLinkedLedgers:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch linked ledgers' });
  }
};

// Set linked ledgers (replaces all existing links for user/family)
export const setFireLinkedLedgers = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FireLinkedLedger[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { ledger_ids } = req.body;

    if (!Array.isArray(ledger_ids)) {
      res.status(400).json({ success: false, error: 'ledger_ids must be an array' });
      return;
    }

    // Validate all ledger IDs are strings
    for (const id of ledger_ids) {
      if (typeof id !== 'string') {
        res.status(400).json({ success: false, error: 'All ledger_ids must be strings' });
        return;
      }
    }

    // Get view context for family/personal mode
    const viewContext = await getViewContext(req);

    // Delete all existing links for this user/family (based on belong_id)
    const { error: deleteError } = await supabaseAdmin
      .from('fire_linked_ledgers')
      .delete()
      .eq('belong_id', viewContext.belongId);

    if (deleteError) {
      console.error('Error deleting existing linked ledgers:', deleteError);
      throw new AppError('Failed to update linked ledgers', 500);
    }

    // If no ledger IDs provided, return empty array
    if (ledger_ids.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Insert new links with ownership values
    const ownershipValues = buildOwnershipValues(viewContext);
    const inserts = ledger_ids.map((ledger_id: string) => ({
      ...ownershipValues,
      ledger_id,
    }));

    const { data: newLinks, error: insertError } = await supabaseAdmin
      .from('fire_linked_ledgers')
      .insert(inserts)
      .select(`
        *,
        ledger:ledgers(id, name, description)
      `);

    if (insertError) {
      console.error('Error inserting linked ledgers:', insertError);
      throw new AppError('Failed to update linked ledgers', 500);
    }

    res.json({ success: true, data: newLinks || [] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in setFireLinkedLedgers:', err);
    res.status(500).json({ success: false, error: 'Failed to update linked ledgers' });
  }
};
