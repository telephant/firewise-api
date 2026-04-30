# Family & belong_id Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user auto-gets a personal family on signup (API layer); `belong_id` on portfolios is always a `family_id`; users can join additional families via invitation; frontend has a family selector and full family management UI.

**Architecture:** On first login, the frontend calls `POST /fire/families/ensure-personal` which is idempotent — creates a personal family if the user has none. All portfolio queries use `x-family-id` header to set `belong_id`. Family context utility reads this header instead of toggling personal/family mode.

**Tech Stack:** Node.js/Express (API), TypeScript, Supabase (Postgres + RLS), Next.js 16 / React 19 (frontend), SWR, fire/ui component library.

---

## File Map

### Backend — Modified
- `src/utils/family-context.ts` — Remove personal/family mode; read `x-family-id` header; always return `familyId` as `belongId`
- `src/controllers/family.controller.ts` — Add `ensurePersonalFamily`; update `getMyFamily` → `getMyFamilies` (return array); fix `Family` type to use `owner_id` not `created_by`; remove `migrateDataToFamily` endpoint
- `src/routes/family.routes.ts` — Add `POST /ensure-personal`; rename `GET /me` handler; remove `/:id/migrate-data`
- `src/types/index.ts` — Fix `Family` type: `owner_id` instead of `created_by`; add `role` to `FamilyMember`
- `src/app.ts` — Remove legacy `/family` routes registration

### Backend — Deleted
- `src/controllers/portfolio-family.controller.ts`
- `src/routes/portfolio-family.routes.ts`

### Backend — New
- `scripts/backfill-family.ts` — One-off script: create personal families for existing users, update `portfolios.belong_id`

### Frontend — Modified
- `src/lib/fire/api.ts` — Update `familyApi` base path to `/fire/families`; add `getAll()`, `ensurePersonal()`, invitation management methods; add `x-family-id` header to all fire API calls
- `src/components/fire/portfolio-sidebar.tsx` — Add family selector dropdown
- `src/app/(fire)/fire/family/page.tsx` — Full rewrite: show all families, pending invitations list, resend/cancel; fix API calls to new endpoints
- `src/app/auth/redirect/page.tsx` — Call `ensurePersonal()` after login before redirecting

### Frontend — New
- `src/app/(public)/fire/invite/[token]/page.tsx` — Restore: invitation accept page (show details, confirm join)
- `src/hooks/fire/use-families.ts` — SWR hook for fetching user's families + selected family state

---

## Task 1: Fix backend types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update Family and FamilyMember types**

In `src/types/index.ts`, find the `Family` interface and replace `created_by` with `owner_id`, add `role` to `FamilyMember`:

```typescript
export interface Family {
  id: string;
  name: string;
  owner_id: string;          // was created_by
  created_at: string;
  updated_at: string;
}

export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string;
  role: 'owner' | 'member';  // add this
  joined_at: string;
  profile?: {
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-api
git add src/types/index.ts
git commit -m "fix: update Family type owner_id, add role to FamilyMember"
```

---

## Task 2: Update family-context.ts — always use family_id from header

**Files:**
- Modify: `src/utils/family-context.ts`

- [ ] **Step 1: Rewrite getViewContext to read x-family-id header**

Replace the entire `family-context.ts` with:

```typescript
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest } from '../types';

export interface ViewContext {
  userId: string;
  familyId: string;
  belongId: string; // always familyId
}

// Cache: userId → [{ family_id, role }]
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
 * Throws 400 if user has no families (should not happen after ensure-personal).
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
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/family-context.ts
git commit -m "refactor: family-context always returns familyId as belongId, reads x-family-id header"
```

---

## Task 3: Update family.controller.ts

**Files:**
- Modify: `src/controllers/family.controller.ts`

- [ ] **Step 1: Add ensurePersonalFamily controller**

Add this function near the top of the controller (after imports):

```typescript
/**
 * Ensure user has a personal family. Idempotent.
 * POST /fire/families/ensure-personal
 */
export const ensurePersonalFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    // Check if user already has a family
    const { data: existing } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Already has a family — return it
      const { data: family } = await supabaseAdmin
        .from('families')
        .select('*')
        .eq('id', existing.family_id)
        .single();

      const { data: members } = await supabaseAdmin
        .from('family_members')
        .select('id, family_id, user_id, role, joined_at')
        .eq('family_id', existing.family_id);

      const userIds = (members || []).map((m: any) => m.user_id);
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      const transformedMembers = (members || []).map((m: any) => ({
        ...m,
        profile: profileMap.get(m.user_id),
      }));

      res.json({ success: true, data: { ...family, members: transformedMembers } });
      return;
    }

    // Create personal family
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'My';
    const familyName = `${displayName}'s Space`;

    const { data: newFamily, error: familyError } = await supabaseAdmin
      .from('families')
      .insert({ name: familyName, owner_id: userId })
      .select()
      .single();

    if (familyError || !newFamily) throw new AppError('Failed to create family', 500);

    await supabaseAdmin
      .from('family_members')
      .insert({ family_id: newFamily.id, user_id: userId, role: 'owner' });

    clearFamilyCache(userId);

    res.status(201).json({
      success: true,
      data: {
        ...newFamily,
        members: [{
          id: '', // will be set by DB
          family_id: newFamily.id,
          user_id: userId,
          role: 'owner',
          joined_at: new Date().toISOString(),
        }],
      },
    });
  } catch (err) {
    if (err instanceof AppError) { res.status(err.statusCode).json({ success: false, error: err.message }); return; }
    res.status(500).json({ success: false, error: 'Failed to ensure personal family' });
  }
};
```

- [ ] **Step 2: Update getMyFamily → getMyFamilies (return array of all families)**

Replace the existing `getMyFamily` function:

```typescript
/**
 * Get all families the current user belongs to
 * GET /fire/families/me
 */
export const getMyFamilies = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    // Get all family memberships
    const { data: memberships, error: memberError } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId);

    if (memberError) throw new AppError('Failed to fetch family memberships', 500);
    if (!memberships || memberships.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const familyIds = memberships.map((m: any) => m.family_id);

    // Get all families
    const { data: families, error: familiesError } = await supabaseAdmin
      .from('families')
      .select('*')
      .in('id', familyIds);

    if (familiesError) throw new AppError('Failed to fetch families', 500);

    // Get all members for all families
    const { data: allMembers, error: membersError } = await supabaseAdmin
      .from('family_members')
      .select('id, family_id, user_id, role, joined_at')
      .in('family_id', familyIds);

    if (membersError) throw new AppError('Failed to fetch family members', 500);

    // Get profiles
    const userIds = [...new Set((allMembers || []).map((m: any) => m.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    // Assemble result
    const result: FamilyWithMembers[] = (families || []).map((family: any) => {
      const members = (allMembers || [])
        .filter((m: any) => m.family_id === family.id)
        .map((m: any) => ({ ...m, profile: profileMap.get(m.user_id) }));
      return { ...family, members };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) { res.status(err.statusCode).json({ success: false, error: err.message }); return; }
    res.status(500).json({ success: false, error: 'Failed to fetch families' });
  }
};
```

- [ ] **Step 3: Fix acceptInvitation to add role field**

In `acceptInvitation`, find the `family_members` insert and add `role: 'member'`:

```typescript
await supabaseAdmin
  .from('family_members')
  .insert({ family_id: invitation.family_id, user_id: userId, role: 'member' });
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/family.controller.ts
git commit -m "feat: add ensurePersonalFamily, getMyFamilies returns array, fix role on accept"
```

---

## Task 4: Update family.routes.ts

**Files:**
- Modify: `src/routes/family.routes.ts`

- [ ] **Step 1: Add ensure-personal route, update me handler, remove migrate-data**

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  ensurePersonalFamily,
  getMyFamilies,
  createFamily,
  updateFamily,
  deleteFamily,
  getFamilyMembers,
  removeFamilyMember,
  leaveFamily,
  inviteMember,
  getPendingInvitations,
  resendInvitation,
  cancelInvitation,
  getInvitation,
  acceptInvitation,
} from '../controllers/family.controller';

const router = Router();

// Ensure personal family exists (idempotent, call on login)
router.post('/ensure-personal', authMiddleware, ensurePersonalFamily);

// Get all families the user belongs to
router.get('/me', authMiddleware, getMyFamilies);

// Family management
router.post('/', authMiddleware, createFamily);
router.put('/:id', authMiddleware, updateFamily);
router.delete('/:id', authMiddleware, deleteFamily);

// Family members
router.get('/:id/members', authMiddleware, getFamilyMembers);
router.delete('/:id/members/:userId', authMiddleware, removeFamilyMember);
router.post('/:id/leave', authMiddleware, leaveFamily);

// Invitations
router.post('/:id/invite', authMiddleware, inviteMember);
router.get('/:id/invitations', authMiddleware, getPendingInvitations);
router.post('/:id/invitations/:invitationId/resend', authMiddleware, resendInvitation);
router.delete('/:id/invitations/:invitationId', authMiddleware, cancelInvitation);

export default router;

export const invitationRouter = Router();
invitationRouter.get('/:token', getInvitation);
invitationRouter.post('/:token/accept', authMiddleware, acceptInvitation);
```

- [ ] **Step 2: Remove legacy portfolio-family routes from app.ts**

In `src/app.ts`, find and remove:
```typescript
// Remove these lines:
import portfolioFamilyRoutes from './routes/portfolio-family.routes';
app.use('/family', portfolioFamilyRoutes);
```

- [ ] **Step 3: Delete legacy files**

```bash
rm src/controllers/portfolio-family.controller.ts
rm src/routes/portfolio-family.routes.ts
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/family.routes.ts src/app.ts
git rm src/controllers/portfolio-family.controller.ts src/routes/portfolio-family.routes.ts
git commit -m "refactor: consolidate family routes, remove legacy /family endpoints"
```

---

## Task 5: Backfill script for existing users

**Files:**
- Create: `scripts/backfill-family.ts`

- [ ] **Step 1: Write backfill script**

```typescript
/**
 * One-off backfill: create personal families for existing users,
 * update portfolios.belong_id from user_id → family_id.
 *
 * Run: npx tsx scripts/backfill-family.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('Starting backfill...');

  // 1. Get all users who have no family membership
  const { data: allProfiles } = await supabase.from('profiles').select('id, full_name, email');
  const { data: allMembers } = await supabase.from('family_members').select('user_id');

  const memberedUserIds = new Set((allMembers || []).map((m: any) => m.user_id));
  const unFamilied = (allProfiles || []).filter((p: any) => !memberedUserIds.has(p.id));

  console.log(`Found ${unFamilied.length} users without a family`);

  for (const profile of unFamilied) {
    const displayName = profile.full_name || profile.email?.split('@')[0] || 'My';
    const familyName = `${displayName}'s Space`;

    // Create family
    const { data: family, error: fe } = await supabase
      .from('families')
      .insert({ name: familyName, owner_id: profile.id })
      .select()
      .single();

    if (fe || !family) { console.error(`Failed to create family for ${profile.id}:`, fe); continue; }

    // Add as owner member
    await supabase.from('family_members').insert({
      family_id: family.id,
      user_id: profile.id,
      role: 'owner',
    });

    // Update portfolios.belong_id from user_id → family_id
    const { count } = await supabase
      .from('portfolios')
      .update({ belong_id: family.id })
      .eq('belong_id', profile.id);

    console.log(`  ✓ ${profile.email} → family ${family.id} (${count ?? 0} portfolios updated)`);
  }

  console.log('Backfill complete.');
}

main().catch(console.error);
```

- [ ] **Step 2: Run the backfill against production**

```bash
cd /Users/telephant/projects/firewise/firewise-api
npx tsx scripts/backfill-family.ts
```

Expected output: list of users processed with portfolio counts.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-family.ts
git commit -m "script: backfill personal families for existing users"
```

---

## Task 6: Update frontend familyApi + add x-family-id header

**Files:**
- Modify: `src/lib/fire/api.ts`

- [ ] **Step 1: Update fetchApi to send x-family-id header**

In `src/lib/fire/api.ts`, find the `fetchApi` helper and add family header reading from localStorage:

```typescript
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  const authHeader = await getAuthHeader();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeader,
  };

  // Send selected family ID with every request
  const selectedFamilyId = localStorage.getItem('fire_selected_family_id');
  if (selectedFamilyId) {
    headers['x-family-id'] = selectedFamilyId;
  }

  if (options.headers) {
    Object.assign(headers, options.headers as Record<string, string>);
  }
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  return response.json();
}
```

- [ ] **Step 2: Rewrite familyApi to use new endpoints**

Replace the existing `familyApi` export:

```typescript
export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  profile?: {
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export interface Family {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  members?: FamilyMember[];
}

export interface FamilyInvitation {
  id: string;
  family_id: string;
  email: string;
  token: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export const familyApi = {
  // Idempotent: create personal family on first login
  ensurePersonal: () =>
    fetchApi<Family>('/fire/families/ensure-personal', { method: 'POST' }),

  // Get all families the user belongs to
  getAll: () => fetchApi<Family[]>('/fire/families/me'),

  // Create a new shared family
  create: (data: { name: string }) =>
    fetchApi<Family>('/fire/families', { method: 'POST', body: JSON.stringify(data) }),

  // Update family name
  update: (id: string, data: { name: string }) =>
    fetchApi<Family>(`/fire/families/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Invite a member by email
  invite: (familyId: string, email: string) =>
    fetchApi(`/fire/families/${familyId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // Remove a member
  removeMember: (familyId: string, userId: string) =>
    fetchApi(`/fire/families/${familyId}/members/${userId}`, { method: 'DELETE' }),

  // Leave a family
  leave: (familyId: string) =>
    fetchApi(`/fire/families/${familyId}/leave`, { method: 'POST' }),

  // Invitation management
  getInvitations: (familyId: string) =>
    fetchApi<FamilyInvitation[]>(`/fire/families/${familyId}/invitations`),

  resendInvitation: (familyId: string, invitationId: string) =>
    fetchApi(`/fire/families/${familyId}/invitations/${invitationId}/resend`, { method: 'POST' }),

  cancelInvitation: (familyId: string, invitationId: string) =>
    fetchApi(`/fire/families/${familyId}/invitations/${invitationId}`, { method: 'DELETE' }),
};

export const invitationApi = {
  // Get invitation details by token (public)
  get: (token: string) =>
    fetchApi<{ invitation: FamilyInvitation; family: Family }>(`/fire/invitations/${token}`),

  // Accept invitation
  accept: (token: string) =>
    fetchApi(`/fire/invitations/${token}/accept`, { method: 'POST' }),
};
```

- [ ] **Step 3: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/lib/fire/api.ts
git commit -m "feat: update familyApi to new endpoints, send x-family-id header on all fire requests"
```

---

## Task 7: useFamilies hook + family selector in sidebar

**Files:**
- Create: `src/hooks/fire/use-families.ts`
- Modify: `src/components/fire/portfolio-sidebar.tsx`

- [ ] **Step 1: Create useFamilies hook**

```typescript
// src/hooks/fire/use-families.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { familyApi, type Family } from '@/lib/fire/api';

const STORAGE_KEY = 'fire_selected_family_id';

export function useFamilies() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedFamily = families.find(f => f.id === selectedFamilyId) ?? families[0] ?? null;

  const setSelectedFamilyId = useCallback((id: string) => {
    setSelectedFamilyIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setSelectedFamilyIdState(saved);

    familyApi.getAll().then(r => {
      if (r.success && r.data) {
        setFamilies(r.data);
        // If saved family no longer in list, reset to first
        if (saved && !r.data.find(f => f.id === saved)) {
          const first = r.data[0];
          if (first) {
            setSelectedFamilyIdState(first.id);
            localStorage.setItem(STORAGE_KEY, first.id);
          }
        } else if (!saved && r.data[0]) {
          setSelectedFamilyIdState(r.data[0].id);
          localStorage.setItem(STORAGE_KEY, r.data[0].id);
        }
      }
      setLoading(false);
    });
  }, []);

  return { families, selectedFamily, selectedFamilyId, setSelectedFamilyId, loading };
}
```

- [ ] **Step 2: Add family selector to PortfolioSidebar**

In `src/components/fire/portfolio-sidebar.tsx`, import and use `useFamilies`. Add a family switcher UI above the nav links. Show a dropdown only when user is in multiple families:

```tsx
import { useFamilies } from '@/hooks/fire/use-families';
import { colors } from '@/components/fire/ui';

// Inside the sidebar component, add:
const { families, selectedFamily, setSelectedFamilyId } = useFamilies();

// Render family switcher (add above nav links):
{families.length > 1 && (
  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
    <select
      value={selectedFamily?.id ?? ''}
      onChange={e => setSelectedFamilyId(e.target.value)}
      style={{
        width: '100%',
        background: colors.surfaceLight,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        color: colors.text,
        fontSize: 12,
        padding: '6px 8px',
        cursor: 'pointer',
      }}
    >
      {families.map(f => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  </div>
)}

// If only one family, just show the name:
{families.length === 1 && selectedFamily && (
  <div style={{ padding: '8px 16px', borderBottom: `1px solid ${colors.border}` }}>
    <p style={{ fontSize: 11, color: colors.muted, margin: 0 }}>{selectedFamily.name}</p>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/fire/use-families.ts src/components/fire/portfolio-sidebar.tsx
git commit -m "feat: useFamilies hook + family selector in sidebar"
```

---

## Task 8: Call ensurePersonal on login

**Files:**
- Modify: `src/app/auth/redirect/page.tsx`

- [ ] **Step 1: Call ensurePersonal before redirect**

Replace the current `redirect/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { familyApi } from '@/lib/fire/api';
import { colors } from '@/components/fire/ui';

export default function AuthRedirectPage() {
  useEffect(() => {
    const returnUrl = sessionStorage.getItem('auth_return_url');
    sessionStorage.removeItem('auth_return_url');

    // Ensure user has a personal family before redirecting
    familyApi.ensurePersonal().then(r => {
      if (r.success && r.data) {
        // Set as selected family if none saved
        const saved = localStorage.getItem('fire_selected_family_id');
        if (!saved) {
          localStorage.setItem('fire_selected_family_id', r.data.id);
        }
      }
      window.location.href = returnUrl || '/dashboard';
    }).catch(() => {
      // Don't block login if this fails
      window.location.href = returnUrl || '/dashboard';
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: `2px solid ${colors.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: colors.muted, fontSize: 14 }}>Signing you in...</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/auth/redirect/page.tsx
git commit -m "feat: ensure personal family exists on login"
```

---

## Task 9: Restore invitation accept page

**Files:**
- Create: `src/app/(public)/fire/invite/[token]/page.tsx`

- [ ] **Step 1: Create invitation accept page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { invitationApi, familyApi, type Family, type FamilyInvitation } from '@/lib/fire/api';
import { colors, Button, Loader, Card } from '@/components/fire/ui';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<FamilyInvitation | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    invitationApi.get(token).then(r => {
      if (r.success && r.data) {
        setInvitation(r.data.invitation);
        setFamily(r.data.family);
      } else {
        setError('Invitation not found or has expired.');
      }
      setLoading(false);
    });
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    const r = await invitationApi.accept(token);
    setAccepting(false);
    if (r.success) {
      // Clear family cache so sidebar reloads
      localStorage.removeItem('fire_selected_family_id');
      setDone(true);
      setTimeout(() => router.push('/fire'), 2000);
    } else {
      setError(r.error || 'Failed to accept invitation');
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Loader size="md" variant="bar" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        {done ? (
          <Card title="Joined!">
            <p style={{ fontSize: 13, color: colors.muted }}>
              You've joined <strong style={{ color: colors.text }}>{family?.name}</strong>. Redirecting...
            </p>
          </Card>
        ) : error ? (
          <Card title="Invitation Error">
            <p style={{ fontSize: 13, color: colors.negative }}>{error}</p>
          </Card>
        ) : (
          <Card title="Family Invitation">
            <p style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>
              You've been invited to join <strong style={{ color: colors.text }}>{family?.name}</strong>.
            </p>
            <Button onClick={handleAccept} disabled={accepting} style={{ width: '100%' }}>
              {accepting ? 'Joining...' : 'Accept Invitation'}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(public\)/fire/invite/\[token\]/page.tsx
git commit -m "feat: restore invitation accept page"
```

---

## Task 10: Rewrite family management page

**Files:**
- Modify: `src/app/(fire)/fire/family/page.tsx`

- [ ] **Step 1: Rewrite to support multiple families and invitation management**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { familyApi, type Family, type FamilyInvitation } from '@/lib/fire/api';
import { useFamilies } from '@/hooks/fire/use-families';
import { colors, Button, Input, Card, Label, Loader } from '@/components/fire/ui';
import { useAuth } from '@/hooks/use-auth';

export default function FamilyPage() {
  const { user } = useAuth();
  const { families, selectedFamily, setSelectedFamilyId, loading: familiesLoading } = useFamilies();

  const [invitations, setInvitations] = useState<FamilyInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadInvitations = useCallback(async (familyId: string) => {
    setInvitationsLoading(true);
    const r = await familyApi.getInvitations(familyId);
    if (r.success && r.data) setInvitations(r.data);
    setInvitationsLoading(false);
  }, []);

  useEffect(() => {
    if (selectedFamily) loadInvitations(selectedFamily.id);
  }, [selectedFamily, loadInvitations]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFamily) return;
    setInviting(true);
    setInviteMsg(null);
    const r = await familyApi.invite(selectedFamily.id, inviteEmail);
    setInviting(false);
    if (r.success) {
      setInviteEmail('');
      setInviteMsg({ type: 'success', text: `Invitation sent to ${inviteEmail}` });
      loadInvitations(selectedFamily.id);
    } else {
      setInviteMsg({ type: 'error', text: (r as any).error || 'Failed to send invitation' });
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedFamily || !confirm('Remove this member?')) return;
    setRemovingId(userId);
    await familyApi.removeMember(selectedFamily.id, userId);
    setRemovingId(null);
    window.location.reload();
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!selectedFamily) return;
    await familyApi.cancelInvitation(selectedFamily.id, invitationId);
    setInvitations(prev => prev.filter(i => i.id !== invitationId));
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!selectedFamily) return;
    await familyApi.resendInvitation(selectedFamily.id, invitationId);
    setInviteMsg({ type: 'success', text: 'Invitation resent.' });
  };

  if (familiesLoading) {
    return (
      <div style={{ padding: 24, backgroundColor: colors.bg, minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Loader size="md" variant="bar" />
      </div>
    );
  }

  const isOwner = selectedFamily?.owner_id === user?.id;

  return (
    <div style={{ padding: 24, backgroundColor: colors.bg, minHeight: '100vh' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ color: colors.text, fontSize: 22, fontWeight: 700, margin: 0 }}>Family</h1>
          {/* Family switcher if multiple */}
          {families.length > 1 && (
            <select
              value={selectedFamily?.id ?? ''}
              onChange={e => setSelectedFamilyId(e.target.value)}
              style={{ background: colors.surfaceLight, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 12, padding: '6px 10px' }}
            >
              {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </div>

        {!selectedFamily ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>No family found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Members */}
            <Card title={selectedFamily.name}>
              <p style={{ fontSize: 11, color: colors.muted, marginBottom: 16 }}>
                Created {new Date(selectedFamily.created_at).toLocaleDateString()}
              </p>
              <p style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Members</p>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {(selectedFamily.members || []).map((member, idx) => {
                  const memberIsOwner = selectedFamily.owner_id === member.user_id;
                  const isMe = user?.id === member.user_id;
                  const isLast = idx === (selectedFamily.members?.length ?? 0) - 1;
                  return (
                    <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: isLast ? 'none' : `1px solid ${colors.border}` }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 500, color: colors.text, margin: 0 }}>
                          {member.profile?.full_name || member.profile?.email || member.user_id}
                          {memberIsOwner && <span style={{ marginLeft: 8, fontSize: 11, color: colors.accent }}>(host)</span>}
                          {isMe && <span style={{ marginLeft: 8, fontSize: 11, color: colors.muted }}>(you)</span>}
                        </p>
                        {member.profile?.email && (
                          <p style={{ fontSize: 11, color: colors.muted, margin: '2px 0 0' }}>{member.profile.email}</p>
                        )}
                      </div>
                      {isOwner && !memberIsOwner && (
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveMember(member.user_id)} disabled={removingId === member.user_id} style={{ color: colors.negative }}>
                          {removingId === member.user_id ? 'Removing...' : 'Remove'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Invite (owner only) */}
            {isOwner && (
              <Card title="Invite Member">
                <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {inviteMsg && <p style={{ fontSize: 13, color: inviteMsg.type === 'success' ? colors.positive : colors.negative, margin: 0 }}>{inviteMsg.text}</p>}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <Label>Email Address</Label>
                      <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="member@example.com" />
                    </div>
                    <Button type="submit" disabled={inviting}>{inviting ? 'Sending...' : 'Send Invite'}</Button>
                  </div>
                </form>
              </Card>
            )}

            {/* Pending invitations (owner only) */}
            {isOwner && (
              <Card title="Pending Invitations">
                {invitationsLoading ? (
                  <Loader size="sm" variant="dots" />
                ) : invitations.length === 0 ? (
                  <p style={{ fontSize: 13, color: colors.muted }}>No pending invitations.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {invitations.map((inv, idx) => {
                      const isLast = idx === invitations.length - 1;
                      return (
                        <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: isLast ? 'none' : `1px solid ${colors.border}` }}>
                          <div>
                            <p style={{ fontSize: 13, color: colors.text, margin: 0 }}>{inv.email}</p>
                            <p style={{ fontSize: 11, color: colors.muted, margin: '2px 0 0' }}>
                              Expires {new Date(inv.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <Button variant="ghost" size="sm" onClick={() => handleResendInvitation(inv.id)}>Resend</Button>
                            <Button variant="ghost" size="sm" onClick={() => handleCancelInvitation(inv.id)} style={{ color: colors.negative }}>Cancel</Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/app/\(fire\)/fire/family/page.tsx
git commit -m "feat: rewrite family page with multi-family support, invitations management"
```

---

## Task 11: Update migration.sql to reflect actual schema

**Files:**
- Modify: `supabase/migrations/001_migration.sql` and `supabase/migration.sql`

- [ ] **Step 1: Verify families table has correct columns in migration**

The `families` table in the migration already uses `owner_id`. No schema change needed — just run the backfill script (Task 5) to populate data.

- [ ] **Step 2: Run backfill if not already done**

```bash
cd /Users/telephant/projects/firewise/firewise-api
npx tsx scripts/backfill-family.ts
```

---

## Verification

After all tasks:

- [ ] New user logs in → `ensurePersonal` creates family → sidebar shows family name
- [ ] Owner can invite by email → invited user gets email
- [ ] Invited user visits `/fire/invite/[token]` → can accept → joins family → sidebar shows both families
- [ ] Switching family in selector → all portfolio API calls use that family's ID
- [ ] Creating portfolio while family B selected → `belong_id = family_B_id`
- [ ] Existing users: backfill ran → portfolios now have `belong_id = family_id`
