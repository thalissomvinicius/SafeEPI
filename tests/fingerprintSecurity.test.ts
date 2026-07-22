import { describe, expect, it } from "vitest"

import {
  assessFingerprintEvidence,
  extractFingerprintBearer,
  generateFingerprintPairingCode,
  generateFingerprintTerminalToken,
  hashFingerprintSecret,
} from "@/lib/fingerprintSecurity"

describe("fingerprint terminal security", () => {
  it("creates an unambiguous nine-character pairing code", () => {
    const code = generateFingerprintPairingCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]))

    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{9}$/)
  })

  it("creates a high-entropy URL-safe terminal token", () => {
    const token = generateFingerprintTerminalToken(new Uint8Array(32).fill(255))

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("hashes terminal credentials without retaining their plaintext", () => {
    expect(hashFingerprintSecret("terminal-secret")).toBe(
      "6e1dec64ce956488cbc084ddc7a7e34e0eed7da89e180bc840da8e74a71833d6",
    )
  })

  it("accepts only a non-empty Bearer credential", () => {
    expect(extractFingerprintBearer("Bearer abc.def_123")).toBe("abc.def_123")
    expect(extractFingerprintBearer("Basic abc")).toBeNull()
    expect(extractFingerprintBearer("Bearer   ")).toBeNull()
    expect(extractFingerprintBearer(null)).toBeNull()
  })
})

describe("fingerprint delivery evidence", () => {
  const baseEvidence = {
    id: "3c5dcb41-05fe-4508-8229-6cd671a70473",
    operation: "verify" as const,
    status: "completed" as const,
    employeeId: "d649333e-ce7c-45f0-a38e-a7851650c291",
    matchedEmployeeId: "d649333e-ce7c-45f0-a38e-a7851650c291",
    completedAt: "2026-07-22T15:00:00.000Z",
    expiresAt: "2026-07-22T15:10:00.000Z",
  }

  it("accepts a recent completed verification for the expected employee", () => {
    expect(
      assessFingerprintEvidence(baseEvidence, {
        expectedEmployeeId: baseEvidence.employeeId,
        now: new Date("2026-07-22T15:05:00.000Z"),
      }),
    ).toEqual({ valid: true, reason: null })
  })

  it("rejects a verification matched to another employee", () => {
    const result = assessFingerprintEvidence(
      { ...baseEvidence, matchedEmployeeId: "95cc9561-4f37-47b1-a734-0c7ae0173d79" },
      { expectedEmployeeId: baseEvidence.employeeId, now: new Date("2026-07-22T15:05:00.000Z") },
    )

    expect(result).toEqual({ valid: false, reason: "employee_mismatch" })
  })

  it("rejects expired, failed, or enrollment-only evidence", () => {
    expect(
      assessFingerprintEvidence(baseEvidence, {
        expectedEmployeeId: baseEvidence.employeeId,
        now: new Date("2026-07-22T15:11:00.000Z"),
      }).reason,
    ).toBe("expired")
    expect(
      assessFingerprintEvidence(
        { ...baseEvidence, status: "failed" },
        { expectedEmployeeId: baseEvidence.employeeId, now: new Date("2026-07-22T15:05:00.000Z") },
      ).reason,
    ).toBe("not_completed")
    expect(
      assessFingerprintEvidence(
        { ...baseEvidence, operation: "enroll" },
        { expectedEmployeeId: baseEvidence.employeeId, now: new Date("2026-07-22T15:05:00.000Z") },
      ).reason,
    ).toBe("wrong_operation")
  })
})
