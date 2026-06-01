import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.task' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Check exchange rates
  const { data: rates } = await supabase
    .from('exchange_rates')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(10);
  console.log('Exchange rates:');
  console.log(JSON.stringify(rates, null, 2));

  // Check user preferences
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('*');
  console.log('\nUser preferences:');
  console.log(JSON.stringify(prefs, null, 2));
}
main().then(() => process.exit(0));
