import { createRef, type RefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type SignatureCanvas from "react-signature-canvas"
import { SignatureCapture } from "@/components/ui/SignatureCapture"

// Canvas pixels are represented as text here; browser coverage checks the real
// raster. The regression is whether the component copies that raster rather
// than toData(), which does not contain typed/imported signatures.
const state = vi.hoisted(() => ({
  pixels: new WeakMap<HTMLCanvasElement, string>(),
  dimensions: { width: 390, height: 220 },
  clearOnResize: [] as unknown[],
}))

vi.mock("react-signature-canvas", async () => {
  const React = await import("react")
  return {
    default: React.forwardRef(function MockSignatureCanvas(props: {
      clearOnResize?: boolean
      canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>
      onBegin: () => void
      onEnd: () => void
    }, ref) {
      const canvas = React.useRef<HTMLCanvasElement>(null)
      const empty = React.useRef(true)
      state.clearOnResize.push(props.clearOnResize)
      React.useImperativeHandle(ref, () => ({
        getCanvas: () => canvas.current!,
        isEmpty: () => empty.current,
        clear: () => { empty.current = true; state.pixels.set(canvas.current!, "") },
        toDataURL: () => canvas.current!.toDataURL("image/png"),
        fromDataURL: (value: string) => {
          empty.current = false
          state.pixels.set(canvas.current!, value.split(",")[1])
        },
      }), [])
      return <canvas {...props.canvasProps} ref={canvas}
        onMouseDown={props.onBegin}
        onMouseUp={() => {
          empty.current = false
          state.pixels.set(canvas.current!, "drawn-signature")
          props.onEnd()
        }} />
    }),
  }
})

beforeEach(() => {
  state.pixels = new WeakMap()
  state.dimensions = { width: 390, height: 220 }
  state.clearOnResize = []
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    ...state.dimensions, x: 0, y: 0, top: 0, left: 0,
    right: state.dimensions.width, bottom: state.dimensions.height, toJSON: () => ({}),
  }))
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return {
      scale: vi.fn(),
      drawImage: (source: HTMLCanvasElement) => state.pixels.set(this, state.pixels.get(source) || ""),
      fillText: (text: string) => state.pixels.set(this, text),
    } as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
    return `data:image/png;base64,${state.pixels.get(this) || ""}`
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup() {
  const signatureRef = createRef<SignatureCanvas>() as RefObject<SignatureCanvas | null>
  const confirm = vi.fn()
  const view = render(<SignatureCapture signatureRef={signatureRef} onConfirm={confirm} />)
  return { ...view, signatureRef, confirm }
}

function draw() {
  const canvas = screen.getByLabelText(/Área para desenhar/)
  fireEvent.mouseDown(canvas)
  fireEvent.mouseUp(canvas)
}

describe("mobile signature retention", () => {
  it("keeps drawn ink and the nonempty state after orientation/keyboard resize", () => {
    const { signatureRef } = setup()
    draw()
    state.dimensions = { width: 740, height: 160 }
    fireEvent(window, new Event("resize"))
    expect(signatureRef.current?.toDataURL()).toContain("drawn-signature")
    expect(signatureRef.current?.isEmpty()).toBe(false)
    expect(state.clearOnResize.every(value => value === false)).toBe(true)
    expect(screen.getByRole("button", { name: "Confirmar assinatura" })).toBeEnabled()
  })

  it("keeps typed ink across resize and fullscreen remount, then restores focus", async () => {
    const { signatureRef, container } = setup()
    fireEvent.click(screen.getByText("Não consegue desenhar? Digite seu nome"))
    fireEvent.change(screen.getByPlaceholderText("Nome completo"), { target: { value: "Maria Teste" } })
    fireEvent.click(screen.getByRole("button", { name: "Aplicar assinatura" }))
    state.dimensions = { width: 360, height: 200 }
    fireEvent(window, new Event("resize"))
    expect(signatureRef.current?.toDataURL()).toContain("Maria Teste")
    fireEvent.click(screen.getByRole("button", { name: "Tela inteira" }))
    expect(screen.getByRole("dialog", { name: "Assinatura" })).toBeInTheDocument()
    expect(container.inert).toBe(true)
    expect(signatureRef.current?.isEmpty()).toBe(false)
    expect(signatureRef.current?.toDataURL()).toContain("Maria Teste")
    fireEvent.click(screen.getByRole("button", { name: "Voltar à tela anterior" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Tela inteira" })).toHaveFocus())
    expect(signatureRef.current?.toDataURL()).toContain("Maria Teste")
    expect(signatureRef.current?.isEmpty()).toBe(false)
    expect(container.inert).not.toBe(true)
    expect(document.querySelector("[data-signature-screen]")).toBeNull()
  })

  it("does not resurrect cleared ink on another resize or fullscreen transition", () => {
    const { signatureRef } = setup()
    draw()
    fireEvent.click(screen.getByRole("button", { name: "Limpar assinatura" }))
    state.dimensions.width = 320
    fireEvent(window, new Event("resize"))
    fireEvent.click(screen.getByRole("button", { name: "Tela inteira" }))
    expect(signatureRef.current?.isEmpty()).toBe(true)
    expect(signatureRef.current?.toDataURL()).not.toContain("drawn-signature")
    expect(screen.getByRole("button", { name: "Confirmar assinatura" })).toBeDisabled()
  })

  it("prevents closing or replacing the captured signature while saving", () => {
    const { signatureRef, confirm, rerender } = setup()
    draw()
    fireEvent.click(screen.getByRole("button", { name: "Tela inteira" }))
    rerender(<SignatureCapture signatureRef={signatureRef} onConfirm={confirm} isSaving />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Voltar à tela anterior" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Limpar assinatura" })).toBeDisabled()
    expect(screen.getByLabelText(/Área para desenhar/)).toHaveStyle({ pointerEvents: "none" })
  })
})
