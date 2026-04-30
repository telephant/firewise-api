# Family & belong_id Refactor Design

**Date:** 2026-04-30  
**Status:** Approved

---

## Overview

Refactor the ownership model so that `belong_id` is **always a `family_id`**, never a `user_id`. Every user automatically gets a personal single-member family on signup (created at the API layer, not via DB trigger). Users can join other families via invitation; data created under a family belongs to that family permanently.

---

## Core Rules

1. **Every user has exactly one "personal" family** — created when they register, named after them (e.g. "Alice's Space"). They are the `owner_id` and sole member.
2. **Users can join additional families** via invitation — they become a member of that family too.
3. **All portfolio data uses `belong_id = family_id`** — never `user_id`. Trades/dividends/snapshots don't need `belong_id` because they're scoped through `portfolio_id → portfolios.belong_id`.
4. **Data belongs to the family it was created under** — no migration when joining/leaving a family.
5. **Family selector in the UI** — when a user is a member of multiple families, they can switch context. All creates/reads use the currently-selected `family_id`.

---

## Data Model

### No schema changes needed for portfolios, trades, dividends, snapshots, price_cache
- `portfolios.belong_id` stays as-is, but will now always be a `family_id`
- Trades/dividends are already linked through `portfolio_id`

### Existing users backfill
- Users who currently have `portfolios.belong_id = user_id` need a one-time migration:
  1. Create a personal family for the user
  2. Add them as owner/member
  3. Update `portfolios.belong_id` from `user_id` → their new `family_id`
- This runs as a one-off script, not a trigger

---

## Backend Changes

### 1. Registration flow (`/auth` or wherever profile is created after OAuth)
After creating the profile, also:
```
POST /fire/families  →  creates family named "<name>'s Space"
                    →  adds user as owner member
```
This replaces the DB trigger approach.

### 2. Consolidate family controllers
- **Keep:** `src/controllers/family.controller.ts` + `src/routes/family.routes.ts` (`/fire/families/*`)
- **Delete:** `src/controllers/portfolio-family.controller.ts` + `src/routes/portfolio-family.routes.ts` (`/family/*`)
- Frontend `familyApi` updated to call `/fire/families/*`

### 3. family.controller.ts changes
- `createFamily()` — keep as-is (used at registration, and users can create additional shared families)
- `getMyFamily()` — rename to `getMyFamilies()`, return array of all families the user belongs to
- Remove `migrateDataToFamily()` endpoint (no longer needed for new users; backfill script handles existing)
- Remove personal/family view mode toggle — `belong_id` is always a `family_id`

### 4. family-context.ts changes
- `getViewContext()` — reads `x-family-id` header from request (sent by frontend)
- If header is missing → use user's personal family_id as default
- Remove `viewMode: personal | family` concept entirely
- Return: `{ userId, familyId, belongId: familyId }`

### 5. portfolio.controller.ts
- No logic changes — already uses `ctx.belongId` for all queries
- Will just always receive a `family_id` now

---

## Frontend Changes

### 1. Family selector in PortfolioSidebar
- On load: fetch all families the user belongs to (`GET /fire/families/me` → returns array)
- Show dropdown if user is in multiple families
- Store selected `family_id` in state/localStorage
- All API calls send `x-family-id: <selected_family_id>` header

### 2. Update `familyApi` in `src/lib/fire/api.ts`
- Change base path from `/family` → `/fire/families`
- Add `getAll()` to return all families user belongs to
- Add invitation management: `getInvitations()`, `cancelInvitation()`, `resendInvitation()`

### 3. `/fire/family` page
- Show current family members with roles
- Invite by email
- Pending invitations list (resend / cancel)
- If user is in multiple families: tabs or switcher to see each family

### 4. Accept invitation page (`/fire/invite/[token]`)
- Already existed, was deleted in refactor — restore it
- Show invitation details, confirm join button
- On accept: user becomes member of that family; frontend adds it to family list

### 5. Registration hook
- After OAuth login completes (in `/auth/callback`), call backend to ensure user has a personal family
- If family already exists (returning user), no-op

---

## API Endpoints (final)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/fire/families/me` | All families the user belongs to |
| POST | `/fire/families` | Create a new family |
| PUT | `/fire/families/:id` | Update family name |
| DELETE | `/fire/families/:id/members/:userId` | Remove member |
| POST | `/fire/families/:id/leave` | Leave a family |
| POST | `/fire/families/:id/invite` | Send email invitation |
| GET | `/fire/families/:id/invitations` | List pending invitations |
| POST | `/fire/families/:id/invitations/:id/resend` | Resend invitation |
| DELETE | `/fire/families/:id/invitations/:id` | Cancel invitation |
| GET | `/fire/invitations/:token` | Get invitation details (public) |
| POST | `/fire/invitations/:token/accept` | Accept invitation |

---

## Migration Script (existing users)

One-off script `scripts/backfill-family.ts`:
1. Find all users in `profiles` with no entry in `family_members`
2. For each: create family, add as owner member
3. Update `portfolios.belong_id` where `belong_id = user_id` → new `family_id`
4. Log counts

---

## Out of Scope

- Ledger module is unaffected — it uses its own `ledger_users` membership model
- `price_cache` and `currency_exchange` are global, no ownership model needed
- Family deletion — not supported for now (too risky, keep it simple)
