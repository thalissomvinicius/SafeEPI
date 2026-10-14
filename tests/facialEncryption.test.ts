import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { decryptFacialTemplate, encryptFacialTemplate } from "@/lib/biometricEncryption"

const original = process.env.BIOMETRIC_ENCRYPTION_KEY
const scope = { companyId: "company", employeeId: "employee", modelId: "opencv-sface-2021dec" }
describe("SFace template encryption", () => {
  beforeEach(() => { process.env.BIOMETRIC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64") })
  afterEach(() => { if (original === undefined) delete process.env.BIOMETRIC_ENCRYPTION_KEY; else process.env.BIOMETRIC_ENCRYPTION_KEY = original })
  it("round trips only in the correct company, employee and model context", () => {
    const descriptor = Array(128).fill(0.2)
    const ciphertext = encryptFacialTemplate(descriptor, scope)
    expect(ciphertext.startsWith("v2.")).toBe(true)
    expect(decryptFacialTemplate(ciphertext, scope)).toEqual(descriptor)
    for (const field of ["companyId", "employeeId", "modelId"] as const) {
      expect(() => decryptFacialTemplate(ciphertext, { ...scope, [field]: "other" })).toThrow()
    }
  })
  it("rejects legacy dimensions, invalid floats, zero templates, missing context and malformed ciphertext", () => {
    for (const embedding of [Array(512).fill(0.1), Array(128).fill(0), Array(128).fill(NaN)]) {
      expect(() => encryptFacialTemplate(embedding, scope)).toThrow()
    }
    expect(() => encryptFacialTemplate(Array(128).fill(0.1), { ...scope, employeeId: "" })).toThrow()
    expect(() => decryptFacialTemplate("v1.a.b.c", scope)).toThrow()
  })
})
