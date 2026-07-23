import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { buildCspHeader } from "@/lib/csp"
import { extractBearerToken } from "@/lib/authHeaders"

const ADMIN_ROLES = new Set(["MASTER", "ADMIN"])
const PUBLIC_ROUTES = new Set(["/login", "/cadastro", "/esqueci-senha", "/unauthorized"])

function generateNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

function withSecurityHeaders(response: NextResponse, csp: string, nonce: string) {
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()")
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  response.headers.set("x-nonce", nonce)
  return response
}

function redirectToLogin(request: NextRequest, csp: string, nonce: string) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = "/login"
  loginUrl.search = ""
  loginUrl.searchParams.set("redirectTo", `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return withSecurityHeaders(NextResponse.redirect(loginUrl), csp, nonce)
}

function redirectToUnauthorized(request: NextRequest, csp: string, nonce: string) {
  const unauthorizedUrl = request.nextUrl.clone()
  unauthorizedUrl.pathname = "/unauthorized"
  unauthorizedUrl.search = ""
  return withSecurityHeaders(NextResponse.redirect(unauthorizedUrl), csp, nonce)
}

function apiUnauthorized(csp: string, nonce: string) {
  return withSecurityHeaders(
    NextResponse.json({ error: "Nao autenticado." }, { status: 401 }),
    csp,
    nonce,
  )
}

function isAdminRoute(pathname: string) {
  return pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
}

function isAuthBypassedRoute(pathname: string) {
  return PUBLIC_ROUTES.has(pathname) ||
    pathname === "/api/client-location" ||
    pathname === "/api/csp-report" ||
    pathname === "/api/cron/biometric-retention" ||
    pathname === "/api/fingerprint/agent" ||
    pathname.startsWith("/api/fingerprint/agent/") ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/remote-delivery" ||
    pathname === "/api/remote-capture" ||
    pathname === "/api/remote-links" ||
    pathname.startsWith("/api/remote-links/") ||
    pathname === "/api/remote-training-signature" ||
    pathname === "/delivery/remote" ||
    pathname.startsWith("/delivery/remote/") ||
    pathname === "/training/remote" ||
    pathname.startsWith("/training/remote/") ||
    pathname === "/capture" ||
    pathname.startsWith("/capture/")
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildCspHeader(nonce)
  const requestHeaders = new Headers(request.headers)

  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (isAuthBypassedRoute(request.nextUrl.pathname)) {
    return withSecurityHeaders(response, csp, nonce)
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectToLogin(request, csp, nonce)
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
        Object.entries(headersToSet).forEach(([name, value]) => {
          response.headers.set(name, value)
        })
      },
    },
  })

  const {
    data: verifiedToken,
  } = await supabase.auth.getClaims()
  let claims = verifiedToken?.claims || null

  if (!claims?.sub && request.nextUrl.pathname.startsWith("/api/")) {
    const bearer = extractBearerToken(request.headers.get("authorization"))
    if (bearer) {
      const result = await supabase.auth.getClaims(bearer)
      claims = result.data?.claims || null
    }
  }

  if (!claims?.sub) {
    return request.nextUrl.pathname.startsWith("/api/")
      ? apiUnauthorized(csp, nonce)
      : redirectToLogin(request, csp, nonce)
  }

  if (isAdminRoute(request.nextUrl.pathname)) {
    const appMetadata = claims.app_metadata && typeof claims.app_metadata === "object"
      ? claims.app_metadata as Record<string, unknown>
      : null
    const role = typeof appMetadata?.role === "string" ? appMetadata.role : null
    if (!role || !ADMIN_ROLES.has(role)) {
      return redirectToUnauthorized(request, csp, nonce)
    }
  }

  return withSecurityHeaders(response, csp, nonce)
}

export const config = {
  matcher: [
    "/((?!_next(?:/.*)?$|favicon.ico$|icon.png$|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|json|woff|woff2|ttf)$).*)",
  ],
}
