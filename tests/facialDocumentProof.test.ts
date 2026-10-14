import { describe, expect, it } from "vitest"
import { authoritativeFacialReceipt } from "@/lib/facialDocumentProof"

const receipt = { session_id: "session", accepted_at: "2026-10-13T10:00:00Z", model_id: "sface", calibration_id: "c1", context_hash: "a".repeat(64), pad_model_id: "pad" }
const session = { id: "session", company_id: "company", employee_id: "employee", remote_link_id: "remote", decision: "approved", consumed_at: "2026-10-13T10:00:00Z", delivery_ids: ["d1", "d2"], result: { receipt } }
const scope = { companyId: "company", employeeId: "employee", remoteLinkId: null, deliveryIds: ["d1", "d2"] }
describe("recibo facial arquivado vem do servidor", () => {
  it("aceita apenas o comprovante correspondente a todas entregas consumidas", () => {
    expect(authoritativeFacialReceipt(session, scope)).toEqual(receipt)
  })
  it("recusa comprovante de outra empresa ou pessoa", () => {
    expect(authoritativeFacialReceipt(session, { ...scope, companyId: "other" })).toBeNull()
    expect(authoritativeFacialReceipt(session, { ...scope, employeeId: "other" })).toBeNull()
  })
  it("recusa link emprestado ou IDs extras", () => {
    expect(authoritativeFacialReceipt(session, { ...scope, remoteLinkId: "other" })).toBeNull()
    expect(authoritativeFacialReceipt(session, { ...scope, deliveryIds: ["d1", "extra"] })).toBeNull()
  })
  it("nao eleva sessao nao consumida ou dado incompleto a aprovacao", () => {
    expect(authoritativeFacialReceipt({ ...session, consumed_at: null }, scope)).toBeNull()
    expect(authoritativeFacialReceipt({ ...session, result: { receipt: {} } }, scope)).toBeNull()
  })
})
