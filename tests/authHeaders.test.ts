import { describe, expect, it } from "vitest"
import { extractBearerToken } from "@/lib/authHeaders"

describe("extractBearerToken", () => {
  it("extrai somente Bearer JWT não vazio", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi")
    expect(extractBearerToken("Basic abc")).toBeNull()
    expect(extractBearerToken("Bearer ")).toBeNull()
    expect(extractBearerToken(null)).toBeNull()
  })
})
