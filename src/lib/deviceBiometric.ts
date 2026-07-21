export type DeviceBiometricReadinessCode =
  | "available"
  | "insecure_context"
  | "webauthn_unsupported"
  | "platform_authenticator_unavailable"
  | "check_failed"

export interface DeviceBiometricReadiness {
  code: DeviceBiometricReadinessCode
  secureContext: boolean
  webAuthnSupported: boolean
  platformAuthenticatorAvailable: boolean | null
}

interface DeviceBiometricRuntime {
  secureContext: boolean
  checkPlatformAuthenticator?: () => Promise<boolean>
}

export async function detectDeviceBiometricReadiness(
  runtime: DeviceBiometricRuntime,
): Promise<DeviceBiometricReadiness> {
  if (!runtime.secureContext) {
    return {
      code: "insecure_context",
      secureContext: false,
      webAuthnSupported: Boolean(runtime.checkPlatformAuthenticator),
      platformAuthenticatorAvailable: null,
    }
  }

  if (!runtime.checkPlatformAuthenticator) {
    return {
      code: "webauthn_unsupported",
      secureContext: true,
      webAuthnSupported: false,
      platformAuthenticatorAvailable: null,
    }
  }

  try {
    const available = await runtime.checkPlatformAuthenticator()
    return {
      code: available ? "available" : "platform_authenticator_unavailable",
      secureContext: true,
      webAuthnSupported: true,
      platformAuthenticatorAvailable: available,
    }
  } catch {
    return {
      code: "check_failed",
      secureContext: true,
      webAuthnSupported: true,
      platformAuthenticatorAvailable: null,
    }
  }
}
