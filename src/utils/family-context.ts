import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest } from '../types';

export interface ViewContext {
  userId: string;
  familyId: string;
  belongId: string; // always familyId
}

// Cache: userId → [{ family_id }]
const familyCache = new Map<string, { families: { family_id: string }[]; timestamp: number }>();
const CACHE_TTL = 60000;

/**
 * Get all family IDs for a user (cached)
 */
export async function getUserFamilies(userId: string): Promise<{ family_id: string }[]> {
  const now = Date.now();
  const cached = familyCache.get(userId);
  if (cached && now - cached.timestamp < CACHE_TTL) return cached.families;

  const { data, error } = await supabaseAdmin
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching family memberships:', error);
    return [];
  }

  const families = data || [];
  familyCache.set(userId, { families, timestamp: now });
  return families;
}

/**
 * Get the first (personal) family ID for a user
 */
export async function getUserFamilyId(userId: string): Promise<string | null> {
  const families = await getUserFamilies(userId);
  return families[0]?.family_id ?? null;
}

/**
 * Clear family cache for a user (call when membership changes)
 */
export function clearFamilyCache(userId: string): void {
  familyCache.delete(userId);
}

/**
 * Get view context from request.
 * Reads x-family-id header. Falls back to user's first family.
 * Throws if user has no families (should not happen after ensure-personal).
 */
export async function getViewContext(req: AuthenticatedRequest): Promise<ViewContext> {
  const userId = req.user!.id;
  const headerFamilyId = req.headers['x-family-id'] as string | undefined;

  let familyId: string;

  if (headerFamilyId) {
    // Verify user is actually a member of this family
    const families = await getUserFamilies(userId);
    const isMember = families.some(f => f.family_id === headerFamilyId);
    if (!isMember) {
      throw new Error('User is not a member of the specified family');
    }
    familyId = headerFamilyId;
  } else {
    // Fall back to first family
    const first = await getUserFamilyId(userId);
    if (!first) {
      throw new Error('User has no family. Call /fire/families/ensure-personal first.');
    }
    familyId = first;
  }

  return { userId, familyId, belongId: familyId };
}
