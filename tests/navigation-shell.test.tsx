import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MobileNav } from "@/components/layout/MobileNav"
import { isNavigationActive, visibleNavigation } from "@/components/layout/navigation"

vi.mock("next/navigation", () => ({ usePathname: () => "/delivery" }))
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "MASTER" }, logout: vi.fn() }),
}))
vi.mock("@/hooks/useActiveBrand", () => ({
  useActiveBrand: () => ({ name: "Empresa de engenharia", primaryColor: "#9b1c31" }),
}))

afterEach(cleanup)

describe("navigation hierarchy", () => {
  it("preserves permission boundaries and company training visibility", () => {
    expect(visibleNavigation("ALMOXARIFE").map((item) => item.href)).toContain("/delivery")
    expect(visibleNavigation("DIRETORIA").map((item) => item.href)).not.toContain("/delivery")
    expect(visibleNavigation("ADMIN").map((item) => item.href)).not.toContain("/companies")
    expect(visibleNavigation("ADMIN", false).map((item) => item.href)).not.toContain("/training")
    expect(visibleNavigation("MASTER", false).map((item) => item.href)).toContain("/training")
  })

  it("highlights nested module routes without highlighting the home route", () => {
    expect(isNavigationActive("/employees/123", "/employees")).toBe(true)
    expect(isNavigationActive("/employees/123", "/")).toBe(false)
    expect(isNavigationActive("/employees-old", "/employees")).toBe(false)
  })

  it("keeps the delivery action on the master mobile bar and restores menu focus", async () => {
    const user = userEvent.setup()
    render(<MobileNav />)
    expect(screen.getByRole("link", { name: "Entrega" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("link", { name: "Empresas" })).not.toBeInTheDocument()
    const opener = screen.getByRole("button", { name: "Mais" })
    await user.click(opener)
    expect(screen.getByRole("dialog", { name: "Todos os módulos" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Fechar menu" })).toHaveFocus()
    expect(screen.getByRole("link", { name: "Empresas" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
