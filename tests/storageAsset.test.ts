import { describe, expect, it } from "vitest"
import { shouldRequestSignedStorageUrl } from "@/lib/storageAsset"

const SUPABASE_URL = "https://project-ref.supabase.co"

describe("shouldRequestSignedStorageUrl", () => {
  it("assina caminhos privados e URLs publicas legadas do mesmo Supabase", () => {
    expect(shouldRequestSignedStorageUrl("company/signature.png", SUPABASE_URL)).toBe(true)
    expect(shouldRequestSignedStorageUrl(
      `${SUPABASE_URL}/storage/v1/object/public/ppe_signatures/company/signature.png`,
      SUPABASE_URL,
    )).toBe(true)
  })

  it("nao envia data URLs, caminhos locais nem URLs externas para assinatura", () => {
    expect(shouldRequestSignedStorageUrl("data:image/png;base64,abc", SUPABASE_URL)).toBe(false)
    expect(shouldRequestSignedStorageUrl("/local/image.png", SUPABASE_URL)).toBe(false)
    expect(shouldRequestSignedStorageUrl("https://example.com/image.png", SUPABASE_URL)).toBe(false)
  })
})
