import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  decryptBiometricDescriptor,
  encryptBiometricDescriptor,
} from "@/lib/biometricEncryption"

const ORIGINAL_KEY = process.env.BIOMETRIC_ENCRYPTION_KEY

describe("biometric descriptor encryption", () => {
  beforeEach(() => {
    process.env.BIOMETRIC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.BIOMETRIC_ENCRYPTION_KEY
    else process.env.BIOMETRIC_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  it("round-trips a 512-dimensional descriptor with tenant-bound AAD", () => {
    const descriptor = Array.from({ length: 512 }, (_, index) => index / 512)
    const encrypted = encryptBiometricDescriptor(descriptor, "company-a")

    expect(encrypted).not.toContain(JSON.stringify(descriptor.slice(0, 3)))
    expect(decryptBiometricDescriptor(encrypted, "company-a")).toEqual(descriptor)
    expect(() => decryptBiometricDescriptor(encrypted, "company-b")).toThrow()
  })

  it("rejects tampered ciphertext", () => {
    const descriptor = Array.from({ length: 512 }, () => 0.25)
    const encrypted = encryptBiometricDescriptor(descriptor, "company-a")
    const tampered = `${encrypted.slice(0, -2)}aa`

    expect(() => decryptBiometricDescriptor(tampered, "company-a")).toThrow()
  })

  it("fails closed without a valid 32-byte key", () => {
    process.env.BIOMETRIC_ENCRYPTION_KEY = "short"
    expect(() => encryptBiometricDescriptor(Array.from({ length: 512 }, () => 0.1), "company-a")).toThrow(
      /BIOMETRIC_ENCRYPTION_KEY/,
    )
  })
})
