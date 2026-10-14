import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-nonce": "synthetic-nonce" }) }))
import { BrandBootstrap, brandBootstrapSource } from "@/components/layout/BrandBootstrap"

afterEach(() => {
  localStorage.clear()
  document.body.removeAttribute("style")
  document.body.classList.remove("company-theme")
  history.replaceState({}, "", "/")
})

describe("pre-paint display-only brand cache", () => {
  it("restores the selected color before client effects", () => {
    localStorage.setItem("safeepi_active_brand", JSON.stringify({ primaryColor: "#B0161B" }))
    new Function(brandBootstrapSource)()
    expect(document.body.style.getPropertyValue("--brand-color")).toBe("#B0161B")
    expect(document.body.classList.contains("company-theme")).toBe(true)
  })
  it.each(["/login", "/delivery/remote?t=synthetic", "/capture/test"])("does not restore private display branding on %s", (path) => {
    history.replaceState({}, "", path)
    localStorage.setItem("safeepi_active_brand", JSON.stringify({ primaryColor: "#B0161B" }))
    new Function(brandBootstrapSource)()
    expect(document.body.style.getPropertyValue("--brand-color")).toBe("")
  })
  it("rejects invalid cached values and carries the request CSP nonce", async () => {
    localStorage.setItem("safeepi_active_brand", JSON.stringify({ primaryColor: "red;background:url(https://invalid.example)" }))
    new Function(brandBootstrapSource)()
    expect(document.body.getAttribute("style")).toBeNull()
    expect((await BrandBootstrap()).props.nonce).toBe("synthetic-nonce")
  })
})
