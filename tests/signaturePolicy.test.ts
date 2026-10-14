import { afterEach, describe, expect, it } from "vitest"
import { isBiometricOperationAllowed } from "@/lib/signaturePolicy"
import { isFacialV2Enabled } from "@/lib/facialFeature"

const previousFlag = process.env.FACIAL_V2_ENABLED
afterEach(() => {
  if (previousFlag === undefined) delete process.env.FACIAL_V2_ENABLED
  else process.env.FACIAL_V2_ENABLED = previousFlag
})

describe("retirada de biometrias preservando registros anteriores", () => {
  it.each(["pair", "enroll", "verify"])("impede nova operação %s", operation => {
    expect(isBiometricOperationAllowed(operation)).toBe(false)
  })
  it("permite exclusão autorizada de cadastro legado", () => {
    expect(isBiometricOperationAllowed("delete")).toBe(true)
  })
  it("não reativa reconhecimento facial por configuração antiga", () => {
    process.env.FACIAL_V2_ENABLED = "true"
    expect(isFacialV2Enabled()).toBe(false)
  })
})
