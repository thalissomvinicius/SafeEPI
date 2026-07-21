import { describe, expect, it, vi } from "vitest"

import { detectDeviceBiometricReadiness } from "@/lib/deviceBiometric"

describe("detectDeviceBiometricReadiness", () => {
  it("reports an insecure context before invoking the authenticator", async () => {
    const checkPlatformAuthenticator = vi.fn(async () => true)

    const result = await detectDeviceBiometricReadiness({
      secureContext: false,
      checkPlatformAuthenticator,
    })

    expect(result.code).toBe("insecure_context")
    expect(checkPlatformAuthenticator).not.toHaveBeenCalled()
  })

  it("reports browsers without WebAuthn platform-authenticator support", async () => {
    const result = await detectDeviceBiometricReadiness({ secureContext: true })

    expect(result).toMatchObject({
      code: "webauthn_unsupported",
      webAuthnSupported: false,
      platformAuthenticatorAvailable: null,
    })
  })

  it("reports an available platform authenticator", async () => {
    const result = await detectDeviceBiometricReadiness({
      secureContext: true,
      checkPlatformAuthenticator: async () => true,
    })

    expect(result).toMatchObject({
      code: "available",
      webAuthnSupported: true,
      platformAuthenticatorAvailable: true,
    })
  })

  it("distinguishes an unavailable authenticator from a failed check", async () => {
    const unavailable = await detectDeviceBiometricReadiness({
      secureContext: true,
      checkPlatformAuthenticator: async () => false,
    })
    const failed = await detectDeviceBiometricReadiness({
      secureContext: true,
      checkPlatformAuthenticator: async () => {
        throw new Error("blocked")
      },
    })

    expect(unavailable.code).toBe("platform_authenticator_unavailable")
    expect(failed.code).toBe("check_failed")
  })
})
