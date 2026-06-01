import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.task' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // List all tables we can see
  const { data: rates, error: e1 } = await supabase.from('exchange_rates').select('*').limit(5);
  console.log('exchange_rates:', JSON.stringify(rates), 'err:', e1?.message);

  const { data: prefs, error: e2 } = await supabase.from('user_preferences').select('*').limit(5);
  console.log('user_preferences:', JSON.stringify(prefs), 'err:', e2?.message);

  const { data: monthly, error: e3 } = await supabase
    .from('monthly_financial_snapshots')
    .select('year, month, net_worth, total_assets, currency')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(3);
  console.log('monthly_financial_snapshots:', JSON.stringify(monthly, null, 2), 'err:', e3?.message);
}
main().then(() => process.exit(0));
