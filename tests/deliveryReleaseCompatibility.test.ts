// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), rpc: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: mocks.auth }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } } }));

import { POST } from "@/app/api/deliveries/route";

const companyId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const ppeId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";
const batchId = "55555555-5555-4555-8555-555555555555";
const deliveryId = "66666666-6666-4666-8666-666666666666";
let command: Record<string, unknown>;
let linkError: { code: string; message: string } | null;

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("https://safeepi.example/api/deliveries", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId, ppe_id: ppeId, reason: "Primeira Entrega", quantity: 1, auth_method: "manual", idempotency_key: "release-request-1", ...overrides }),
  });
}

function fingerprintRequest(overrides: Record<string, unknown> = {}) {
  return request({ auth_method: "fingerprint", fingerprint_event_id: commandId, fingerprint_batch_id: batchId, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  linkError = null;
  command = {
    id: commandId, employee_id: employeeId, matched_employee_id: employeeId,
    operation: "verify", status: "completed", completed_at: new Date(Date.now() - 30_000).toISOString(),
    expires_at: "2099-01-01T00:00:00Z", result_hash: "a".repeat(64), delivery_batch_id: batchId,
  };
  mocks.auth.mockResolvedValue({ authorized: true, user: { id: "operator", email: "operator@example.org", role: "ADMIN", company_id: companyId } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "safeepi_create_delivery" ? { delivery: { id: deliveryId } } : { restored_quantity: 1 }, error: null }));
  mocks.remove.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    const result: { data: unknown; error: unknown } = { data: [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "is", "update"]) query[method] = () => query;
    query.insert = () => { result.error = linkError; return query; };
    query.maybeSingle = async () => ({ data: table === "fingerprint_commands" ? command : null, error: null });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  });
});

describe("delivery release preserves production capabilities without a v2 database migration", () => {
  it("continues creating manual deliveries through the existing atomic RPC", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("safeepi_create_delivery", expect.objectContaining({ p_auth_method: "manual", p_company_id: companyId, p_employee_id: employeeId }));
  });

  it("does not trust facial claims sent through the legacy endpoint", async () => {
    const response = await POST(request({ auth_method: "facial" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "FACIAL_PROOF_REQUIRED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("continues accepting valid fingerprint evidence and links it to the receipt", async () => {
    expect((await POST(fingerprintRequest())).status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("fingerprint_commands");
    expect(mocks.from).toHaveBeenCalledWith("fingerprint_delivery_links");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("safeepi_create_delivery", expect.objectContaining({ p_auth_method: "fingerprint" }));
  });

  it("rejects fingerprint evidence already assigned to another delivery batch", async () => {
    command.delivery_batch_id = "77777777-7777-4777-8777-777777777777";
    expect((await POST(fingerprintRequest())).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("compensates the delivery when its fingerprint evidence cannot be linked", async () => {
    linkError = { code: "23503", message: "synthetic link failure" };
    expect((await POST(fingerprintRequest())).status).toBe(500);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "safeepi_void_delivery", expect.objectContaining({ p_delivery_id: deliveryId, p_company_id: companyId }));
  });
});
