import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyCompanyBrand, clearCompanyTheme, getStoredBrand, BRAND_CHANGED_EVENT } from "@/lib/brandTheme"
import type { Company } from "@/types/database"

describe("brandTheme", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("logo unavailable")))
  })

  afterEach(() => {
    clearCompanyTheme()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it("aplica a cor e retorna sem aguardar um logotipo lento", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    await applyCompanyBrand({ name: "Empresa de teste", primary_color: "#B0161B", logo_url: "/lento.png" } as Company)
    expect(document.body.style.getPropertyValue("--brand-color")).toBe("#B0161B")
    expect(getStoredBrand().name).toBe("Empresa de teste")
  })

  it("nao restaura a empresa anterior quando o logo antigo termina depois", async () => {
    let resolveOld!: (value: Response) => void
    vi.stubGlobal("fetch", vi.fn((url: string) => url === "/antigo.png"
      ? new Promise<Response>((resolve) => { resolveOld = resolve })
      : Promise.reject(new Error("sem logo"))))
    const listener = vi.fn()
    window.addEventListener(BRAND_CHANGED_EVENT, listener)
    try {
      await applyCompanyBrand({ name: "Empresa anterior", primary_color: "#B0161B", logo_url: "/antigo.png" } as Company)
      await applyCompanyBrand({ name: "Empresa atual", primary_color: "#166534", logo_url: "/atual.png" } as Company)
      resolveOld(new Response(new Blob(["logo"], { type: "image/png" })))
      await new Promise((resolve) => window.setTimeout(resolve, 25))
      expect(getStoredBrand()).toMatchObject({ name: "Empresa atual", primaryColor: "#166534", logoDataUrl: null })
      expect(document.body.style.getPropertyValue("--brand-color")).toBe("#166534")
      expect(listener).toHaveBeenCalledTimes(2)
    } finally { window.removeEventListener(BRAND_CHANGED_EVENT, listener) }
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
