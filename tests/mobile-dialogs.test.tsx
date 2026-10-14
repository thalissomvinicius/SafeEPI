import { useRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { AccessibleOverlay } from "@/components/ui/AccessibleOverlay"
import { useVisualViewport } from "@/hooks/useVisualViewport"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("mobile overlay accessibility", () => {
  it("only closes the topmost dialog and keeps scroll locked until the parent closes", async () => {
    const parentClose = vi.fn()
    function Nested() {
      const [childOpen, setChildOpen] = useState(true)
      return <AccessibleOverlay label="Parent" onClose={parentClose}>
        <button>Parent action</button>
        {childOpen && <AccessibleOverlay label="Child" onClose={() => setChildOpen(false)}><button>Child action</button></AccessibleOverlay>}
      </AccessibleOverlay>
    }
    const { unmount } = render(<Nested />)
    expect(screen.getByRole("button", { name: "Child action" })).toHaveFocus()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Child" })).not.toBeInTheDocument()
    expect(parentClose).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe("hidden")
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Parent" })).toHaveFocus())
    unmount()
    expect(document.body.style.overflow).toBe("")
  })

  it("does not autofocus a text field or tab into a collapsed alternative", () => {
    render(<AccessibleOverlay label="Editor" onClose={vi.fn()}>
      <input aria-label="First input" />
      <button>Close editor</button>
      <details><summary>Alternative</summary><input aria-label="Hidden input" /><button>Hidden action</button></details>
      <button>Save</button>
    </AccessibleOverlay>)
    expect(screen.getByRole("button", { name: "Close editor" })).toHaveFocus()
    const dialog = screen.getByRole("dialog")
    within(dialog).getByRole("button", { name: "Save" }).focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(screen.getByRole("textbox", { name: "First input" })).toHaveFocus()
    dialog.focus()
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus()
  })

  it("tracks the visible keyboard viewport without trapping pinch zoom", () => {
    const viewport = Object.assign(new EventTarget(), { height: 700, offsetTop: 0, scale: 1 })
    vi.stubGlobal("visualViewport", viewport)
    function Dialog() {
      const ref = useRef<HTMLDivElement>(null)
      useVisualViewport(ref)
      return <div ref={ref} data-testid="viewport" />
    }
    const { unmount } = render(<Dialog />)
    const element = screen.getByTestId("viewport")
    expect(element.style.getPropertyValue("--safeepi-viewport-height")).toBe("700px")
    viewport.height = 340
    viewport.offsetTop = 90
    viewport.dispatchEvent(new Event("resize"))
    expect(element.style.getPropertyValue("--safeepi-viewport-height")).toBe("340px")
    expect(element.style.getPropertyValue("--safeepi-viewport-top")).toBe("90px")
    viewport.scale = 2
    viewport.dispatchEvent(new Event("resize"))
    expect(element.style.getPropertyValue("--safeepi-viewport-height")).toBe(`${window.innerHeight}px`)
    expect(element.style.getPropertyValue("--safeepi-viewport-top")).toBe("0px")
    unmount()
    expect(element.style.getPropertyValue("--safeepi-viewport-height")).toBe("")
  })
})
