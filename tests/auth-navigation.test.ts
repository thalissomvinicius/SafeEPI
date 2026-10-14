import { describe, expect, it } from "vitest"
import { resolvePostLoginRedirect } from "@/lib/authNavigation"

describe("post-login redirect", () => {
  it("preserves local destinations and filters", () => {
    expect(resolvePostLoginRedirect("/delivery?employee=123#signature")).toBe("/delivery?employee=123#signature")
    expect(resolvePostLoginRedirect("/history")).toBe("/history")
  })

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "/login", "/login?redirectTo=/login", "/%6cogin", "/api/me", "/_next/static", "/%5cevil.example", "/%2fevil.example", "/\n/evil.example"])("rejects unsafe or looping destination %s", (value) => {
    expect(resolvePostLoginRedirect(value)).toBe("/")
  })
})
