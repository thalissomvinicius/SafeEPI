import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { Header } from "@/components/layout/Header"

const brand = vi.hoisted(() => ({ name: "Empresa Exemplo", logoUrl: "https://example.com/logo.png", primaryColor: "#2563EB" }))
vi.mock("next/navigation", () => ({ usePathname: () => "/delivery" }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }))
vi.mock("@/hooks/useActiveBrand", () => ({ useActiveBrand: () => brand }))
vi.mock("@/services/api", () => ({ api: {} }))
vi.mock("@/components/layout/GlobalSearch", () => ({ GlobalSearch: () => null }))
vi.mock("@/components/layout/NotificationBell", () => ({ NotificationBell: () => null }))
afterEach(cleanup)

it("exibe a logo da empresa no cabeçalho e usa a marca padrão quando ela não existe", () => {
  const { rerender } = render(<Header />)
  expect(screen.getByRole("img", { name: "Empresa Exemplo" })).toHaveAttribute("src", brand.logoUrl)
  brand.logoUrl = ""
  rerender(<Header />)
  expect(screen.getByRole("img", { name: "Empresa Exemplo" }).getAttribute("src")).toContain("logo.png")
})
