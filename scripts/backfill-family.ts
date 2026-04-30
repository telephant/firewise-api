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

  // Get all users who have no family membership
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
