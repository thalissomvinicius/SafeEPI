import { describe, expect, it, vi } from "vitest";
import { collectSupabasePages } from "@/lib/supabasePagination";

describe("collectSupabasePages", () => {
  it("coleta todas as paginas sem truncar no limite do Supabase", async () => {
    const source = Array.from({ length: 1_205 }, (_, index) => index);
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));

    const result = await collectSupabasePages(fetchPage, {
      pageSize: 500,
      maxRows: 2_000,
      resourceName: "colaboradores",
    });

    expect(result).toEqual(source);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 499);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 500, 999);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 1_000, 1_499);
  });

  it("propaga o erro retornado por uma pagina", async () => {
    const failure = new Error("database unavailable");

    await expect(
      collectSupabasePages(async () => ({ data: null, error: failure })),
    ).rejects.toBe(failure);
  });

  it("falha explicitamente em vez de truncar ao atingir o limite de seguranca", async () => {
    await expect(
      collectSupabasePages(
        async (from, to) => ({
          data: Array.from({ length: to - from + 1 }, (_, index) => from + index),
          error: null,
        }),
        { pageSize: 2, maxRows: 4, resourceName: "documentos" },
      ),
    ).rejects.toThrow("excedeu 4 registros");
  });
});
