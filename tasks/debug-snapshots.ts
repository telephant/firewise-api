import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.task' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await supabase
    .from('portfolio_snapshots')
    .select('portfolio_id, snapshot_date, total_value, total_cost, unrealized_pl, realized_pl, currency')
    .order('snapshot_date', { ascending: false })
    .limit(5);
  console.log('Recent snapshots:');
  console.log(JSON.stringify(data, null, 2));
}
main().then(() => process.exit(0));

async function checkRates() {
  const { data } = await supabase
    .from('exchange_rates')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(10);
  console.log('\nExchange rates:');
  console.log(JSON.stringify(data, null, 2));
}
