import LRUCache from "lru-cache"
import { NextResponse } from "next/server"
import { supabaseAdmin, getSupabaseAdminConfigError } from "@/lib/supabaseAdmin"
import { buildRateLimitKey } from "@/lib/requestSecurity"

type RateLimitEntry = {
  count: number
  resetAt: number
}

export type RateLimitResult = {
  success: boolean
  retryAfter?: number
}

type RateLimitRow = {
  allowed: boolean
  retry_after?: number | null
}

const cache = new LRUCache<string, RateLimitEntry>({
  max: 10000,
})

function localRateLimit(identifier: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const key = identifier || "unknown"
  const existing = cache.get(key)

  if (!existing || existing.resetAt <= now) {
    cache.set(key, { count: 1, resetAt: now + windowMs }, windowMs)
    return { success: true }
  }

  if (existing.count >= limit) {
    return {
      success: false,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  cache.set(key, existing, existing.resetAt - now)
  return { success: true }
}

export function interpretRateLimitRow(value: unknown): RateLimitResult {
  if (!value || typeof value !== "object" || typeof (value as RateLimitRow).allowed !== "boolean") {
    throw new Error("Resposta de rate limit invalida.")
  }

  const row = value as RateLimitRow
  if (row.allowed) return { success: true }

  const parsedRetryAfter = Number(row.retry_after)
  return {
    success: false,
    retryAfter: Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
      ? Math.ceil(parsedRetryAfter)
      : 1,
  }
}

export async function rateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.floor(limit))
  const safeWindowMs = Math.max(1000, Math.floor(windowMs))
  const opaqueKey = await buildRateLimitKey("safeepi", identifier || "unknown")

  if (!getSupabaseAdminConfigError()) {
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_key: opaqueKey,
      p_limit: safeLimit,
      p_window_seconds: Math.ceil(safeWindowMs / 1000),
    })

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      return interpretRateLimitRow(row)
    }

    console.error("[rate-limit] contador distribuido indisponivel; usando contingencia local:", error.message)
  }

  return localRateLimit(opaqueKey, safeLimit, safeWindowMs)
}

export function rateLimitExceededResponse(retryAfter = 60) {
  return NextResponse.json(
    { error: `Muitas tentativas. Tente novamente em ${retryAfter} segundos.` },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
      },
    },
  )
}
