import { describe, expect, it } from "vitest"
import { facialContextInputSchema, facialVerificationSchema, hasClientBiometricMaterial } from "@/lib/facialContract"
import { employeeWriteSchema, remoteCaptureSchema } from "@/lib/securitySchemas"

const employee = "11111111-1111-4111-8111-111111111111"
describe("facial server boundary", () => {
  it("rejects empty transactions and fractional quantities", () => {
    expect(facialContextInputSchema.safeParse({ items: [] }).success).toBe(false)
    expect(facialContextInputSchema.safeParse({ items: [{ ppe_id: employee, quantity: 1.2, reason: "Primeira Entrega" }] }).success).toBe(false)
  })
  it("accepts only known receipt reasons and bounded cart size", () => {
    const item = { ppe_id: employee, quantity: 1, reason: "Primeira Entrega" }
    expect(facialContextInputSchema.safeParse({ items: [item], delivery_date: "2026-10-13" }).success).toBe(true)
    expect(facialContextInputSchema.safeParse({ items: [{ ...item, reason: "anything" }] }).success).toBe(false)
    expect(facialContextInputSchema.safeParse({ items: Array(101).fill(item) }).success).toBe(false)
  })
  it("does not accept an approved label without calibrated recognition and PAD metadata", () => {
    expect(facialVerificationSchema.safeParse({ decision: "approved" }).success).toBe(false)
    const result = { decision: "approved", reason: "verified", model_id: "opencv-sface-2021dec", model_sha256: "a".repeat(64), similarity: 0.9, threshold: 0.7, pad_score: 0.98, pad_threshold: 0.95, pad_model_id: "test-pad", calibration_id: "pilot-v1", quality: 0.9 }
    expect(facialVerificationSchema.safeParse(result).success).toBe(true)
    expect(facialVerificationSchema.safeParse({ ...result, similarity: 0.6 }).success).toBe(false)
    expect(facialVerificationSchema.safeParse({ ...result, calibration_id: "" }).success).toBe(false)
    expect(facialVerificationSchema.safeParse({ ...result, pad_score: null }).success).toBe(false)
  })
  it("identifies client-supplied plaintext and encrypted templates, preserving photo-only compatibility", () => {
    expect(hasClientBiometricMaterial({ face_descriptor: [0.1] })).toBe(true)
    expect(hasClientBiometricMaterial({ face_descriptor_encrypted: "v2.data" })).toBe(true)
    expect(hasClientBiometricMaterial({ biometric_key_version: "v2" })).toBe(true)
    expect(hasClientBiometricMaterial({ face_descriptor: null })).toBe(false)
    expect(hasClientBiometricMaterial({ face_descriptor: [] })).toBe(false)
  })
  it("rejects mass-assignment and templates through legacy employee or photo endpoints", () => {
    expect(employeeWriteSchema.safeParse({ full_name: "Teste", active: true }).success).toBe(true)
    for (const key of ["id", "company_id", "deleted_by", "face_descriptor", "face_descriptor_encrypted"]) {
      expect(employeeWriteSchema.safeParse({ full_name: "Teste", [key]: employee }).success).toBe(false)
    }
    const photo = { id: employee, token: "a".repeat(64), photo_url: "data:image/jpeg;base64,/9j/AA==" }
    expect(remoteCaptureSchema.safeParse(photo).success).toBe(true)
    expect(remoteCaptureSchema.safeParse({ ...photo, face_descriptor: Array(512).fill(0.1) }).success).toBe(false)
    expect(remoteCaptureSchema.safeParse({ ...photo, face_descriptor_encrypted: "attacker" }).success).toBe(false)
  })
})
