import { cleanup, fireEvent, render } from "@testing-library/react"
import { axe } from "jest-axe"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DataLoadError } from "@/components/ui/DataLoadError"

describe("DataLoadError", () => {
  afterEach(() => cleanup())

  it("explica que os dados nao foram zerados e oferece nova tentativa acessivel", async () => {
    const onRetry = vi.fn()
    const { container, getByRole } = render(<DataLoadError onRetry={onRetry} />)

    fireEvent.click(getByRole("button", { name: "Tentar novamente" }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(getByRole("alert")).toHaveTextContent("nao substituiu os registros por zero")
    expect(await axe(container)).toHaveNoViolations()
  })
})
