const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('.env.local', 'utf-8');
const lines = envLocal.split('\n');
let url = '';
let key = '';

lines.forEach(line => {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
  if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) key = line.split('=')[1].trim();
});

const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase
    .from('remote_links')
    .select('*')
    .eq('token', '1c50a8c1f9824f25b09792c218188cd431b32f658378d47c8262a13a6e1272b0')
    .single();
    
  console.log(JSON.stringify({data, error}, null, 2));
}

run();
