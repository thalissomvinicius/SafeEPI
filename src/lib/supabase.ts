import { createBrowserClient } from '@supabase/ssr'
import { createPreviewSafeFetch } from '@/lib/previewEnvironment'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// O cliente SSR usa cookies, mantendo navegador, middleware e API routes
// na mesma fonte de sessão.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createPreviewSafeFetch() },
})
