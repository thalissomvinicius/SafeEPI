type PageResult<T> = {
  data: T[] | null;
  error: unknown;
};

type CollectPagesOptions = {
  pageSize?: number;
  maxRows?: number;
  resourceName?: string;
};

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_ROWS = 20_000;

/**
 * Collects deterministic Supabase ranges without relying on the project's
 * server-side max-row setting. The explicit cap prevents an accidental
 * unbounded browser allocation and, unlike a silent truncation, surfaces a
 * clear operational error when a screen needs true server-side pagination.
 */
export async function collectSupabasePages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: CollectPagesOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const resourceName = options.resourceName ?? "registros";

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("Tamanho de pagina Supabase invalido.");
  }

  if (!Number.isInteger(maxRows) || maxRows < pageSize) {
    throw new Error("Limite maximo de registros invalido.");
  }

  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const result = await fetchPage(from, to);

    if (result.error) throw result.error;

    const page = result.data ?? [];
    rows.push(...page);

    if (page.length < pageSize) return rows;
  }

  throw new Error(
    `A consulta de ${resourceName} excedeu ${maxRows.toLocaleString("pt-BR")} registros. Use busca e paginacao no servidor.`,
  );
}
