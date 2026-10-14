import { describe, expect, it } from "vitest"
import { isFacialProofUsable, normalizeFacialDecision, cameraErrorMessage } from "@/components/ui/facialClient"

describe("facial capture boundary", () => {
  it("does not accept an embedding, a photo, or pending as a verified identity", () => {
    expect(normalizeFacialDecision({ embedding: [1], decision: "pending" })).toBe("unavailable")
    expect(normalizeFacialDecision({ decision: "approved" })).toBe("unavailable")
    expect(normalizeFacialDecision({ decision: "unavailable" })).toBe("unavailable")
  })
  it("requires a transaction-bound, unexpired server approval", () => {
    const proof = { session_id: "session", context_hash: "hash", expires_at: "2030-01-01T00:00:00Z" }
    expect(normalizeFacialDecision({ ...proof, decision: "approved" })).toBe("approved")
    expect(isFacialProofUsable(proof, "items-v1", "items-v1", Date.parse("2029-01-01"))).toBe(true)
    expect(isFacialProofUsable(proof, "items-v1", "items-v2", Date.parse("2029-01-01"))).toBe(false)
    expect(isFacialProofUsable(proof, "items-v1", "items-v1", Date.parse("2031-01-01"))).toBe(false)
    expect(isFacialProofUsable({ ...proof, expires_at: "invalid" }, "a", "a")).toBe(false)
  })
  it("explains permission and hardware failures without claiming verification", () => {
    expect(cameraErrorMessage(new DOMException("blocked", "NotAllowedError"))).toContain("permissão")
    expect(cameraErrorMessage(new DOMException("busy", "NotReadableError"))).toContain("outro aplicativo")
  })
})
