import type { NextConfig } from "next"

// O hostname do storage Supabase deve bater com NEXT_PUBLIC_SUPABASE_URL.
// Em build estático o env não está disponível em todos os lugares; lemos
// aqui e caímos para o valor atual de produção em desenvolvimento.
function resolveSupabaseHostname(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return "orogyfmlxakoxncmahji.supabase.co"
  try {
    return new URL(url).hostname
  } catch {
    return "orogyfmlxakoxncmahji.supabase.co"
  }
}

const supabaseHostname = resolveSupabaseHostname()

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
]

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
      {
        // Suporte a signed URLs (bucket privado, recomendado).
        protocol: "https",
        hostname: supabaseHostname,
        port: "",
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
