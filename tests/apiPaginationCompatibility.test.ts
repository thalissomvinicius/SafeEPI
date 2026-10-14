import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: mocks.from,
    auth: { getSession: mocks.getSession, signOut: vi.fn(), refreshSession: vi.fn() },
  },
}));

import { api } from "@/services/api";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const queries: Array<{ table: string; columns: string; ranges: number[][]; orders: string[]; filters: unknown[][] }> = [];

function buildQuery(table: string) {
  const capture = { table, columns: "", ranges: [] as number[][], orders: [] as string[], filters: [] as unknown[][] };
  queries.push(capture);
  let from = 0;
  let to = 999; // Simulate the default Supabase result ceiling.
  const query: Record<string, unknown> = {};
  query.select = (columns: string) => { capture.columns = columns; return query; };
  for (const operator of ["eq", "is", "gte", "lte"]) {
    query[operator] = (column: string, value: unknown) => { capture.filters.push([operator, column, value]); return query; };
  }
  query.order = (column: string) => { capture.orders.push(column); return query; };
  query.range = (start: number, end: number) => { from = start; to = end; capture.ranges.push([start, end]); return query; };
  query.limit = (limit: number) => { to = limit - 1; return query; };
  query.then = (resolve: (value: { data: Row[]; error: null }) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve({ data: (tables[table] || []).slice(from, to + 1), error: null }).then(resolve, reject);
  return query;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.resetCompanyContext();
  api.primeCompanyContext({ role: "ADMIN", company_id: "company-a" });
  queries.length = 0;
  Object.keys(tables).forEach(key => delete tables[key]);
  mocks.from.mockImplementation(buildQuery);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "test-token", expires_at: 9_999_999_999 } }, error: null });
  mocks.fetch.mockResolvedValue(jsonResponse({ companies: [] }));
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("production schema and pagination compatibility", () => {
  it("retains more than 1,000 employees without selecting the unapplied v2 column or signing unused photos", async () => {
    tables.employees = Array.from({ length: 1_205 }, (_, index) => ({ id: `employee-${index}`, full_name: `Employee ${index}`, photo_url: `company-a/photo-${index}.jpg` }));
    const rows = await api.getEmployees({ signPhotos: false });
    expect(rows).toHaveLength(1_205);
    const employeeQueries = queries.filter(query => query.table === "employees");
    expect(employeeQueries.map(query => query.ranges[0])).toEqual([[0, 499], [500, 999], [1_000, 1_499]]);
    employeeQueries.forEach(query => {
      expect(query.columns).not.toContain("registration_number");
      expect(query.columns).not.toContain("descriptor");
      expect(query.orders).toEqual(["full_name", "id"]);
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves all signed records and skips assets on summary screens", async () => {
    tables.signed_documents = Array.from({ length: 1_205 }, (_, index) => ({ id: `document-${index}`, document_url: `company-a/receipt-${index}.pdf` }));
    expect(await api.getSignedDocuments({ signAssets: false })).toHaveLength(1_205);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(queries.filter(query => query.table === "signed_documents")).toHaveLength(3);
  });

  it("preserves complete PPE lists above the server result ceiling", async () => {
    tables.ppes = Array.from({ length: 1_205 }, (_, index) => ({ id: `ppe-${index}`, name: `PPE ${index}` }));
    expect(await api.getPpes()).toHaveLength(1_205);
    expect(queries.filter(query => query.table === "ppes")).toHaveLength(3);
  });

  it("paginates employee history with tenant scope and stable ordering, without signing unused assets", async () => {
    tables.deliveries = Array.from({ length: 1_205 }, (_, index) => ({ id: `delivery-${index}`, signature_url: `company-a/signature-${index}.png` }));
    expect(await api.getEmployeeHistory("employee-a", { signAssets: false })).toHaveLength(1_205);
    const deliveryQueries = queries.filter(query => query.table === "deliveries");
    expect(deliveryQueries).toHaveLength(3);
    deliveryQueries.forEach(query => {
      expect(query.filters).toContainEqual(["eq", "company_id", "company-a"]);
      expect(query.filters).toContainEqual(["eq", "employee_id", "employee-a"]);
      expect(query.filters).toContainEqual(["is", "deleted_at", null]);
      expect(query.orders).toEqual(["delivery_date", "id"]);
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("applies return-period filters to every delivery page on the server", async () => {
    tables.deliveries = Array.from({ length: 1_205 }, (_, index) => ({ id: `delivery-${index}` }));
    expect(await api.getDeliveries({ all: true, signAssets: false, dateField: "returned_at", startDate: "2026-07-01T03:00:00.000Z", endDate: "2026-08-01T02:59:59.999Z" })).toHaveLength(1_205);
    expect(queries).toHaveLength(2);
    queries.forEach(query => {
      expect(query.filters).toContainEqual(["gte", "returned_at", "2026-07-01T03:00:00.000Z"]);
      expect(query.filters).toContainEqual(["lte", "returned_at", "2026-08-01T02:59:59.999Z"]);
      expect(query.filters).toContainEqual(["eq", "company_id", "company-a"]);
    });
  });

  it("carries a stable delivery key through retries", async () => {
    const delivery = { employee_id: "employee-a", ppe_id: "ppe-a", quantity: 1, reason: "Primeira Entrega", auth_method: "Assinatura Manual", delivery_date: "2026-10-13T12:00:00Z" };
    mocks.fetch.mockImplementation(async () => jsonResponse({ data: { ...delivery, id: "delivery-a" } }));
    await api.saveDelivery(delivery as Parameters<typeof api.saveDelivery>[0], undefined, undefined, { idempotencyKey: "same-operation" });
    await api.saveDelivery(delivery as Parameters<typeof api.saveDelivery>[0], undefined, undefined, { idempotencyKey: "same-operation" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of mocks.fetch.mock.calls) {
      expect(url).toBe("/api/deliveries");
      expect(JSON.parse(init.body)).toMatchObject({ idempotency_key: "same-operation", company_id: "company-a" });
    }
  });

  it("sends explicit return destination and reconciliation baseline", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ ok: true, returned_quantity: 3, quantity_returned_now: 2 }));
    expect(await api.returnDeliveryQuantity("delivery-a", "Desgaste / Validade", 2, {
      restock: false, employeeId: "employee-a", expectedReturnedQuantity: 1,
    })).toMatchObject({ returned_quantity: 3, quantity_returned_now: 2 });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      deliveryId: "delivery-a", quantity: 2, restock: false,
      employee_id: "employee-a", expected_returned_quantity: 1,
    });
  });

  it("preserves pagination metadata for stock history including older pages", async () => {
    const movements = [{ id: "movement-501", ppe: { name: "EPI desativado" } }];
    mocks.fetch.mockResolvedValue(jsonResponse({ movements, total: 1_200, hasMore: true, limit: 100, offset: 500 }));
    expect(await api.getStockMovementsPage({ limit: 100, offset: 500 })).toEqual({ movements, total: 1_200, hasMore: true, limit: 100, offset: 500 });
    const url = new URL(mocks.fetch.mock.calls[0][0], "https://safeepi.test");
    expect(url.searchParams.get("offset")).toBe("500");
    expect(url.searchParams.get("company_id")).toBe("company-a");
  });

  it("deduplicates company requests and invalidates its cache on identity reset", async () => {
    const companies = [{ id: "company-a", name: "Company A" }];
    mocks.fetch.mockImplementation(async () => jsonResponse({ companies }));
    const results = await Promise.all([api.getCompanies(), api.getCompanies()]);
    expect(results).toEqual([companies, companies]);
    expect(await api.getCompanies()).toEqual(companies);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    api.resetCompanyContext();
    expect(await api.getCompanies()).toEqual(companies);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not let an old identity's pending request populate a new identity's cache", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => { resolveFirst = resolve; });
    mocks.fetch.mockImplementationOnce(() => firstResponse);
    const oldRequest = api.getCompanies();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    api.resetCompanyContext();
    const companies = [{ id: "company-b", name: "Company B" }];
    mocks.fetch.mockImplementationOnce(async () => jsonResponse({ companies }));
    expect(await api.getCompanies()).toEqual(companies);
    resolveFirst(jsonResponse({ companies: [{ id: "company-a", name: "Company A" }] }));
    await oldRequest;
    expect(await api.getCompanies()).toEqual(companies);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
