import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { axe } from "jest-axe"
import ErrorPage from "@/app/error"

describe("page recovery", () => {
  it("offers retry without exposing internal error details", () => {
    const retry = vi.fn()
    const error = Object.assign(new Error("private database payload"), { digest: "support-123" })
    render(<ErrorPage error={error} retry={retry} />)
    expect(screen.getByRole("heading", { name: "Não foi possível abrir esta tela" })).toBeInTheDocument()
    expect(screen.queryByText("private database payload")).not.toBeInTheDocument()
    expect(screen.getByText("support-123")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("link", { name: "Voltar ao início" })).toHaveAttribute("href", "/")
  })

  it("has an accessible, named recovery region", async () => {
    const { container } = render(<ErrorPage error={new Error("failure")} retry={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
