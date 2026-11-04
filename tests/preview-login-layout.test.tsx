import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClientShell } from "@/components/layout/ClientShell"

const context = vi.hoisted(() => ({ pathname: "/login", preview: true, user: null as null | { id: string } }))
vi.mock("next/navigation", () => ({ usePathname: () => context.pathname }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: context.user }) }))
vi.mock("@/lib/previewEnvironment", () => ({ isPreviewReadOnly: () => context.preview }))
vi.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => null }))
vi.mock("@/components/layout/Header", () => ({ Header: () => null }))
vi.mock("@/components/layout/MobileNav", () => ({ MobileNav: () => null }))
vi.mock("@/components/layout/DeveloperCredit", () => ({ DeveloperCredit: () => null }))

beforeEach(() => { context.pathname = "/login"; context.preview = true; context.user = null })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("preview login viewport", () => {
  it("reserves the banner's natural height in flow instead of covering login", () => {
    render(<ClientShell><div data-testid="login">Login form</div></ClientShell>)
    const shell = screen.getByRole("main")
    const banner = screen.getByRole("complementary", { name: "Ambiente de testes" })
    expect(shell).toHaveAttribute("data-preview-login-shell")
    expect(shell).toHaveClass("fixed", "flex-col", "overflow-hidden")
    expect(shell.style.containerType).toBe("size")
    expect(shell.style.containerName).toBe("safeepi-preview-login")
    expect(banner).toHaveClass("shrink-0")
    expect(banner).not.toHaveClass("fixed")
    expect(shell.firstElementChild).toBe(banner)
    expect(banner.nextElementSibling).toBe(screen.getByTestId("login"))
  })

  it("keeps the full notice accessible when its explanatory copy is compacted", () => {
    render(<ClientShell><div>Login form</div></ClientShell>)
    const banner = screen.getByRole("complementary", { name: "Ambiente de testes" })
    expect(banner).toHaveTextContent("Versão de testes · somente consulta.")
    expect(banner).toHaveTextContent("Entregas, cadastros, exclusões e envios estão bloqueados")
    expect(screen.getByText(/^A prévia usa os dados atuais/).tagName).toBe("SPAN")
    expect(screen.getByRole("link", { name: "Testar recuperação com PDF fictício" })).toBeVisible()
  })

  it("tracks keyboard viewport changes on the shell and cleans up scoped values", () => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
    vi.stubGlobal("visualViewport", viewport)
    const { unmount } = render(<ClientShell><div>Login form</div></ClientShell>)
    const shell = screen.getByRole("main")
    expect(shell.style.getPropertyValue("--safeepi-viewport-height")).toBe("844px")
    viewport.height = 390
    viewport.offsetTop = 60
    viewport.dispatchEvent(new Event("resize"))
    expect(shell.style.getPropertyValue("--safeepi-viewport-height")).toBe("390px")
    expect(shell.style.getPropertyValue("--safeepi-viewport-top")).toBe("60px")
    unmount()
    expect(shell.style.getPropertyValue("--safeepi-viewport-height")).toBe("")
    expect(shell.style.getPropertyValue("--safeepi-viewport-top")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--safeepi-viewport-height")).toBe("")
  })

  it("leaves production login without preview layout or notice", () => {
    context.preview = false
    render(<ClientShell><div>Login form</div></ClientShell>)
    expect(screen.getByRole("main")).not.toHaveAttribute("data-preview-login-shell")
    expect(screen.getByRole("main")).not.toHaveClass("fixed")
    expect(screen.queryByRole("complementary", { name: "Ambiente de testes" })).not.toBeInTheDocument()
  })

  it("preserves the authenticated shell and its in-flow notice", () => {
    context.pathname = "/employees"
    context.user = { id: "operator" }
    render(<ClientShell><div>Employees</div></ClientShell>)
    expect(screen.getByRole("main")).not.toHaveAttribute("data-preview-login-shell")
    expect(screen.getByRole("complementary", { name: "Ambiente de testes" })).not.toHaveClass("fixed")
    expect(screen.getByRole("main")).toContainElement(screen.getByText("Employees"))
  })
})
