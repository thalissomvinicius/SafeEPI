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

// A CSP usa nonce por request e fica no middleware.ts em modo Report-Only.
// O next.config.ts mantem apenas headers estaticos que nao dependem do request.

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
  async rewrites() {
    return [
      {
        source: "/:any*/model/:path*",
        destination: "/faceplugin-models/:path*",
      },
      {
        source: "/model/:path*",
        destination: "/faceplugin-models/:path*",
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
  webpack(config) {
    config.cache = false
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /@vladmandic[\\/]face-api/,
        message: /Critical dependency: require function is used/,
      },
    ]
    return config
  },
}

export default nextConfig
