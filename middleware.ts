import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { buildCspReportOnlyHeader } from "@/lib/csp"

const ADMIN_ROLES = new Set(["MASTER", "ADMIN"])
const PUBLIC_ROUTES = new Set(["/login", "/cadastro", "/esqueci-senha", "/unauthorized"])

function generateNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

function withCspHeaders(response: NextResponse, csp: string, nonce: string) {
  response.headers.set("Content-Security-Policy-Report-Only", csp)
  response.headers.set("x-nonce", nonce)
  return response
}

function redirectToLogin(request: NextRequest, csp: string, nonce: string) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = "/login"
  loginUrl.search = ""
  loginUrl.searchParams.set("redirectTo", `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return withCspHeaders(NextResponse.redirect(loginUrl), csp, nonce)
}

function redirectToUnauthorized(request: NextRequest, csp: string, nonce: string) {
  const unauthorizedUrl = request.nextUrl.clone()
  unauthorizedUrl.pathname = "/unauthorized"
  unauthorizedUrl.search = ""
  return withCspHeaders(NextResponse.redirect(unauthorizedUrl), csp, nonce)
}

function isAdminRoute(pathname: string) {
  return pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
}

function isAuthBypassedRoute(pathname: string) {
  return PUBLIC_ROUTES.has(pathname) ||
    pathname === "/api/csp-report" ||
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

export async function middleware(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildCspReportOnlyHeader(nonce)
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
    return withCspHeaders(response, csp, nonce)
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectToLogin(request, csp, nonce)
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return redirectToLogin(request, csp, nonce)
  }

  if (isAdminRoute(request.nextUrl.pathname)) {
    const role = typeof user.app_metadata?.role === "string" ? user.app_metadata.role : null
    if (!role || !ADMIN_ROLES.has(role)) {
      return redirectToUnauthorized(request, csp, nonce)
    }
  }

  return withCspHeaders(response, csp, nonce)
}

export const config = {
  matcher: [
    "/((?!_next(?:/.*)?$|favicon.ico$|icon.png$|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|json|woff|woff2|ttf)$).*)",
  ],
}
