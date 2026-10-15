import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LoadingState } from "@/components/ui/LoadingState"

afterEach(cleanup)

describe("shared loading state", () => {
  it("announces a single visible status and honors the optional decorative bar", () => {
    const { container, rerender } = render(<LoadingState label="Carregando estoque" detail="Aguarde os itens." />)
    expect(screen.getByRole("status")).toHaveTextContent("Carregando estoque")
    expect(screen.getByRole("status")).toHaveTextContent("Aguarde os itens.")
    expect(container.querySelector('[data-slot="loading-indicator"]')).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelector('[data-slot="loading-bar"]')).toHaveAttribute("aria-hidden", "true")
    rerender(<LoadingState showBar={false} />)
    expect(container.querySelector('[data-slot="loading-bar"]')).toBeNull()
  })

  it("also exposes inline status without requiring a separate spinner announcement", () => {
    render(<LoadingState variant="inline" label="Atualizando registros" />)
    expect(screen.getByRole("status")).toHaveTextContent("Atualizando registros")
    expect(screen.queryByRole("progressbar")).toBeNull()
  })
})
