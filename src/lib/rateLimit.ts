import LRUCache from "lru-cache"
import { NextResponse } from "next/server"

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  success: boolean
  retryAfter?: number
}

const cache = new LRUCache<string, RateLimitEntry>({
  max: 10000,
})

export function rateLimit(identifier: string, limit: number, windowMs: number): RateLimitResult {
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
