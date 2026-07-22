import "server-only"

import { createHash, randomBytes } from "node:crypto"

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export type FingerprintOperation = "enroll" | "verify" | "delete"
export type FingerprintCommandStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"

export type FingerprintEvidence = {
  id: string
  operation: FingerprintOperation
  status: FingerprintCommandStatus
  employeeId: string
  matchedEmployeeId: string | null
  completedAt: string | null
  expiresAt: string
}

export type FingerprintEvidenceFailure =
  | "wrong_operation"
  | "not_completed"
  | "employee_mismatch"
  | "expired"
  | "invalid_timestamp"

export function generateFingerprintPairingCode(entropy: Uint8Array = randomBytes(9)): string {
  if (entropy.byteLength < 9) {
    throw new Error("Pairing entropy must contain at least nine bytes.")
  }

  return Array.from(entropy.slice(0, 9), (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join("")
}

export function generateFingerprintTerminalToken(entropy: Uint8Array = randomBytes(32)): string {
  if (entropy.byteLength < 32) {
    throw new Error("Terminal token entropy must contain at least 32 bytes.")
  }

  return Buffer.from(entropy.slice(0, 32)).toString("base64url")
}

export function hashFingerprintSecret(secret: string): string {
  if (!secret) throw new Error("Fingerprint secret is required.")
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

export function extractFingerprintBearer(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim())
  return match?.[1] || null
}

export function assessFingerprintEvidence(
  evidence: FingerprintEvidence,
  options: { expectedEmployeeId: string; now?: Date },
): { valid: true; reason: null } | { valid: false; reason: FingerprintEvidenceFailure } {
  if (evidence.operation !== "verify") return { valid: false, reason: "wrong_operation" }
  if (evidence.status !== "completed" || !evidence.completedAt) return { valid: false, reason: "not_completed" }
  if (
    evidence.employeeId !== options.expectedEmployeeId ||
    evidence.matchedEmployeeId !== options.expectedEmployeeId
  ) {
    return { valid: false, reason: "employee_mismatch" }
  }

  const completedAt = Date.parse(evidence.completedAt)
  const expiresAt = Date.parse(evidence.expiresAt)
  if (!Number.isFinite(completedAt) || !Number.isFinite(expiresAt)) {
    return { valid: false, reason: "invalid_timestamp" }
  }

  const now = (options.now || new Date()).getTime()
  if (now > expiresAt || completedAt > now + 30_000) return { valid: false, reason: "expired" }

  return { valid: true, reason: null }
}

export function fingerprintEvidenceCode(id: string): string {
  return `FP-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`
}
