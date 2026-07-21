import { describe, expect, it } from "vitest"
import {
  assertRequestSize,
  buildRateLimitKey,
  readJsonWithLimit,
} from "@/lib/requestSecurity"

describe("requestSecurity", () => {
  it("rejeita Content-Length acima do limite antes de ler o corpo", () => {
    const request = new Request("https://safeepi.test/api", {
      method: "POST",
      headers: { "content-length": "2049" },
      body: "{}",
    })

    expect(() => assertRequestSize(request, 2048)).toThrow("muito grande")
  })

  it("rejeita corpo real acima do limite mesmo sem Content-Length", async () => {
    const request = new Request("https://safeepi.test/api", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(100) }),
    })

    await expect(readJsonWithLimit(request, 50)).rejects.toThrow("muito grande")
  })

  it("produz chave opaca estável sem persistir token ou IP em texto", async () => {
    const key = await buildRateLimitKey("remote", "token-secreto:192.0.2.10")

    expect(key).toMatch(/^remote:[a-f0-9]{64}$/)
    expect(key).not.toContain("token-secreto")
    expect(key).not.toContain("192.0.2.10")
  })
})
