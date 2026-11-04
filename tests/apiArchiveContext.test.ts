// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: mocks.getSession } } }))
import { api } from "@/services/api"
const payload = {
  documentType: "delivery" as const, fileName: "synthetic.pdf", pdfBlob: new Blob(["%PDF-synthetic"]), sha256Hash: "a".repeat(64),
  expectedUserId: "user-a", expectedCompanyId: "company-a",
}
beforeEach(() => {
  api.resetCompanyContext()
  api.primeCompanyContext({ role: "ADMIN", company_id: "company-a" })
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-a" }, access_token: "synthetic", expires_at: 9999999999 } }, error: null })
  mocks.fetch.mockReset()
  vi.stubGlobal("fetch", mocks.fetch)
})
afterEach(() => vi.unstubAllGlobals())
it.each(["user", "company"])("refuses a restored PDF after %s context changes before any write", async (changed) => {
  if (changed === "user") mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, expires_at: 9999999999 } }, error: null })
  else api.primeCompanyContext({ role: "ADMIN", company_id: "company-b" })
  await expect(api.archiveSignedDocument(payload)).rejects.toThrow("outra sessão ou empresa")
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it("sends the PDF only with its original context", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ document: { id: "archived" } }), { status: 200 }))
  await expect(api.archiveSignedDocument(payload)).resolves.toEqual({ id: "archived" })
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  const [, init] = mocks.fetch.mock.calls[0]
  expect(init.body.get("company_id")).toBe("company-a")
  expect(init.body.get("file_name")).toBe("synthetic.pdf")
})
