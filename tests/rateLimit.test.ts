import { describe, expect, it } from "vitest"
import { interpretRateLimitRow } from "@/lib/rateLimit"

describe("interpretRateLimitRow", () => {
  it("normaliza resposta atômica liberada", () => {
    expect(interpretRateLimitRow({ allowed: true, retry_after: 0 })).toEqual({ success: true })
  })

  it("normaliza bloqueio e mantém Retry-After seguro", () => {
    expect(interpretRateLimitRow({ allowed: false, retry_after: 12.2 })).toEqual({
      success: false,
      retryAfter: 13,
    })
  })

  it("rejeita resposta inválida do banco", () => {
    expect(() => interpretRateLimitRow({ allowed: "yes" })).toThrow("rate limit")
  })
})
