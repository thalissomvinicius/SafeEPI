import { render } from "@testing-library/react"
import { axe } from "jest-axe"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LoginPage from "@/app/login/page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/services/api", () => ({
  api: {
    login: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}))

describe("LoginPage accessibility", () => {
  beforeEach(() => vi.clearAllMocks())

  it("associa labels, campos e regiões de feedback sem violações axe", async () => {
    const { container, getByLabelText } = render(<LoginPage />)

    expect(getByLabelText("E-mail corporativo")).toHaveAttribute("id", "login-email")
    expect(getByLabelText("Senha de acesso")).toHaveAttribute("id", "login-password")
    expect(await axe(container)).toHaveNoViolations()
  })
})
