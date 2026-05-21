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
    .from('ppes')
    .select('*')
    .eq('id', '80627c1c-fbe3-4b0a-93b5-90f26c66ca1a')
    .single();
    
  console.log(JSON.stringify({data, error}, null, 2));
}

run();
