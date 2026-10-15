import { createRef, useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { axe } from "jest-axe"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("global loading button", () => {
  it("submits once and blocks mouse, keyboard and implicit form submission while pending", async () => {
    const submit = vi.fn()
    function Form() {
      const [loading, setLoading] = useState(false)
      return (
        <form onSubmit={event => { event.preventDefault(); submit(); setLoading(true) }}>
          <input aria-label="Quantidade" />
          <Button type="submit" loading={loading} loadingText="Salvando…">Salvar entrega</Button>
        </form>
      )
    }
    const user = userEvent.setup()
    render(<Form />)
    await user.click(screen.getByRole("button", { name: "Salvar entrega" }))
    const button = screen.getByRole("button", { name: "Salvando…" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    fireEvent.click(button)
    button.focus()
    await user.keyboard("{Enter} ")
    await user.type(screen.getByRole("textbox"), "2{Enter}")
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it("restores the original content and preserves caller disabled state after completion", () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const { rerender } = render(<Button ref={ref} loading loadingText="Carregando…" onClick={onClick}>Exportar relatório</Button>)
    expect(ref.current).toBe(screen.getByRole("button"))
    expect(screen.getByText("Exportar relatório")).toHaveAttribute("aria-hidden", "true")
    rerender(<Button ref={ref} loading={false} disabled onClick={onClick}>Exportar relatório</Button>)
    expect(screen.getByRole("button", { name: "Exportar relatório" })).toBeDisabled()
    rerender(<Button ref={ref} loading={false} onClick={onClick}>Exportar relatório</Button>)
    fireEvent.click(screen.getByRole("button", { name: "Exportar relatório" }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy")
  })

  it("supports Base UI render, class callbacks and a native disabled button even when focusableWhenDisabled was requested", () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref} loading focusableWhenDisabled className={state => state.disabled ? "pending-custom" : "ready-custom"}
      render={(props, state) => <button {...props} data-custom={String(state.disabled)} />} onClick={onClick}>Atualizar</Button>)
    const button = screen.getByRole("button", { name: "Processando…" })
    expect(button).toHaveClass("pending-custom")
    expect(button).toHaveAttribute("data-custom", "true")
    expect(button).toBeDisabled()
    expect(ref.current).toBe(button)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("blocks a non-native render link while loading", async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button nativeButton={false} loading loadingText="Abrindo…" render={<a href="#report" />} onClick={onClick}>Abrir relatório</Button>)
    const button = screen.getByRole("button", { name: "Abrindo…" })
    expect(button).toHaveAttribute("aria-disabled", "true")
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    fireEvent(button, event)
    expect(event.defaultPrevented).toBe(true)
    button.focus()
    await user.keyboard("{Enter} ")
    expect(onClick).not.toHaveBeenCalled()
  })

  it("retains explicit names on icon buttons and exposes no decorative progress announcement", async () => {
    const { container } = render(<Button size="icon" loading aria-label="Atualizar estoque"><svg aria-hidden="true" /></Button>)
    expect(screen.getByRole("button", { name: "Atualizar estoque" })).toHaveAttribute("aria-busy", "true")
    expect(container.querySelector('[data-slot="loading-indicator"]')).toHaveAttribute("aria-hidden", "true")
    expect(await axe(container)).toHaveNoViolations()
  })

  it("pauses the progress animation outside the viewport and disconnects observation", () => {
    let notify: IntersectionObserverCallback | undefined
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { notify = callback }
      observe = observe
      disconnect = disconnect
    })
    const { container, unmount } = render(<Button loading>Salvar</Button>)
    const indicator = container.querySelector('[data-slot="loading-indicator"]')!
    expect(observe).toHaveBeenCalledWith(indicator)
    act(() => notify!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(indicator).toHaveAttribute("data-animated", "true")
    act(() => notify!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(indicator).toHaveAttribute("data-animated", "false")
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
