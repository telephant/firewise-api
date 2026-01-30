import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest } from '../types';

export type ViewMode = 'personal' | 'family';

/**
 * Simplified ViewContext using belong_id
 * - userId: The authenticated user (creator for new records)
 * - belongId: The ownership ID (userId for personal, familyId for family)
 */
export interface ViewContext {
  viewMode: ViewMode;
  userId: string;
  familyId: string | null;
  belongId: string;  // Key field: userId for personal, familyId for family
}

// Cache family membership to reduce database queries
// Key: userId, Value: { familyId, timestamp }
const familyCache = new Map<string, { familyId: string | null; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Get the family ID for a user (with caching)
 */
export async function getUserFamilyId(userId: string): Promise<string | null> {
  const now = Date.now();
  const cached = familyCache.get(userId);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.familyId;
  }

  const { data, error } = await supabaseAdmin
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching family membership:', error);
    return null;
  }

  const familyId = data?.family_id || null;
  familyCache.set(userId, { familyId, timestamp: now });
  return familyId;
}

/**
 * Clear family cache for a user (call when membership changes)
 */
export function clearFamilyCache(userId: string): void {
  familyCache.delete(userId);
}

/**
 * Get view context from request
 * - Determines if user is in personal or family view mode
 * - Returns belongId for simple query building
 */
export async function getViewContext(req: AuthenticatedRequest): Promise<ViewContext> {
  const userId = req.user!.id;
  const familyId = await getUserFamilyId(userId);
  const headerMode = req.headers['x-view-mode'] as string;

  // Validate: can't use family mode if not in a family
  let viewMode: ViewMode;
  if (headerMode === 'family' && familyId) {
    viewMode = 'family';
  } else if (headerMode === 'personal') {
    viewMode = 'personal';
  } else {
    // Default: family mode if user is in a family, otherwise personal
    viewMode = familyId ? 'family' : 'personal';
  }

  // belongId is the key: userId for personal, familyId for family
  const belongId = viewMode === 'family' ? familyId! : userId;

  return { viewMode, userId, familyId, belongId };
}

/**
 * Build ownership values for INSERT operations
 * - user_id: Creator (always the authenticated user)
 * - belong_id: Ownership (userId for personal, familyId for family)
 */
export function buildOwnershipValues(ctx: ViewContext): {
  user_id: string;
  belong_id: string;
} {
  return {
    user_id: ctx.userId,      // Always set user_id as creator
    belong_id: ctx.belongId,  // Personal or family ownership
  };
}

/**
 * Apply ownership filter to a Supabase query builder
 * For READ operations (SELECT)
 *
 * Simple: Just filter by belong_id!
 */
export function applyOwnershipFilter<T extends { eq: Function }>(
  query: T,
  ctx: ViewContext
): T {
  return query.eq('belong_id', ctx.belongId);
}

/**
 * Apply ownership filter for UPDATE/DELETE operations (includes record ID check)
 */
export function applyOwnershipFilterWithId<T extends { eq: Function }>(
  query: T,
  id: string,
  ctx: ViewContext
): T {
  return query.eq('id', id).eq('belong_id', ctx.belongId);
}
