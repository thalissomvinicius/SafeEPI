import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyCompanyBrand, getStoredBrand } from "@/lib/brandTheme"
import type { Company } from "@/types/database"

describe("brandTheme", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("logo unavailable")))
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it("mantem o CNPJ da empresa selecionada no contexto visual do MASTER", async () => {
    await applyCompanyBrand({
      name: "ANTARES EMPREENDIMENTOS IMOBILIARIOS LTDA",
      trade_name: "ANTARES EMPREENDIMENTOS",
      cnpj: "09041821000221",
      primary_color: "#B0161B",
      logo_url: null,
    } as Company)

    expect(getStoredBrand()).toMatchObject({
      name: "ANTARES EMPREENDIMENTOS",
      cnpj: "09041821000221",
    })
  })
})
