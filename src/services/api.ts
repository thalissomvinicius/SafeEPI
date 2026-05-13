import { supabase } from "@/lib/supabase";
import { Employee, PPE, Delivery, Training, DeliveryWithRelations, TrainingWithRelations, Workplace, StockMovement, Profile, CatalogItem, SignedDocument, CurrentUser, Company } from "@/types/database";
import { Session } from "@supabase/supabase-js";

type AddTrainingResult = {
  training: Training;
  warning?: string;
}

type SignedDocumentArchivePayload = {
  documentType: 'delivery' | 'remote_delivery' | 'return' | 'nr06' | 'training_certificate';
  employeeId?: string | null;
  deliveryId?: string | null;
  deliveryIds?: string[];
  trainingId?: string | null;
  fileName: string;
  pdfBlob: Blob;
  sha256Hash?: string;
  authMethod?: string | null;
  signatureUrl?: string | null;
  photoEvidenceUrl?: string | null;
  photoEvidenceBase64?: string | null;
  ipAddress?: string | null;
  geoLocation?: string | null;
  metadata?: Record<string, unknown>;
  linkToken?: string | null;
};

export type CompanyWithCounts = Company & {
  employees_count?: number;
  ppes_count?: number;
  deliveries_count?: number;
  users_count?: number;
};

const SESSION_REFRESH_BUFFER_SECONDS = 60;
const EMPLOYEE_ARCHIVE_MARKER = "employee_soft_delete";

type SupabaseLikeError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
};

function isJwtExpiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as { code?: string; status?: number; message?: string };
  const message = maybeError.message?.toLowerCase() || "";

  return (
    maybeError.code === "PGRST301" ||
    maybeError.code === "PGRST303" ||
    maybeError.status === 401 ||
    message.includes("jwt expired") ||
    message.includes("invalid jwt") ||
    message.includes("unauthorized")
  );
}

async function ensureActiveSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session) return null;

  const expiresAt = session.expires_at ?? 0;
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (expiresAt !== 0 && expiresAt <= nowInSeconds + SESSION_REFRESH_BUFFER_SECONDS) {
    const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError) {
      await supabase.auth.signOut();
      throw refreshError;
    }

    return refreshedData.session;
  }

  return session;
}

async function withSessionRetry<T>(operation: () => PromiseLike<T>): Promise<T> {
  await ensureActiveSession();

  try {
    return await operation();
  } catch (error) {
    if (!isJwtExpiredError(error)) {
      throw error;
    }

    const { data, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !data.session) {
      await supabase.auth.signOut();
      throw refreshError || error;
    }

    return await operation();
  }
}

async function getSessionAuthHeaders(): Promise<Record<string, string>> {
  const session = await ensureActiveSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchWithAuthRetry(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const authHeaders = await getSessionAuthHeaders();

  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  let response = await fetch(input, { ...init, headers });
  if (response.status !== 401) return response;

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    cachedCompanyId = null;
    await supabase.auth.signOut();
    return response;
  }

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${data.session.access_token}`);
  response = await fetch(input, { ...init, headers: retryHeaders });
  return response;
}

function normalizeDeliveryReason(reason: Delivery["reason"] | string): Delivery["reason"] {
  const normalized = reason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (normalized.includes("primeira")) return "Primeira Entrega";
  if (normalized.includes("substitu")) return "Substituição (Desgaste/Validade)";
  if (normalized.includes("perda")) return "Perda";
  if (normalized.includes("dano")) return "Dano";
  return "Primeira Entrega";
}

function uniqueDeliveryReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.filter(Boolean)));
}

function getDeliveryReasonStorageVariants(reason: Delivery["reason"] | string): string[] {
  const normalizedReason = normalizeDeliveryReason(reason);
  const normalizedText = normalizedReason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalizedText.includes("substitu")) {
    return uniqueDeliveryReasons([
      "Substituição (Desgaste/Validade)",
      "Substitui\u00c3\u00a7\u00c3\u00a3o (Desgaste/Validade)",
      "Substituicao (Desgaste/Validade)",
      normalizedReason,
    ]);
  }

  return [normalizedReason];
}

function isDeliverySchemaCompatibilityIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError;
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find the") ||
    text.includes("column") && (
      text.includes("auth_method") ||
      text.includes("workplace_id")
    )
  );
}

function isDeliveryReasonConstraintIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError;
  const text = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return maybeError.code === "23514" && (text.includes("reason") || text.includes("deliveries"));
}

function isDuplicateCpfIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError & { status?: number };
  const text = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase();
  return (
    maybeError.code === "23505" ||
    maybeError.status === 409 ||
    (text.includes("duplicate key") && text.includes("cpf")) ||
    text.includes("employees_cpf_key")
  );
}

function isMissingDeliveryReturnMotiveIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError;
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();
  return (
    maybeError.code === "PGRST204" &&
    text.includes("return_motive")
  ) || (
    maybeError.code === "42703" &&
    text.includes("return_motive")
  );
}

function isMissingCatalogTableIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError & { status?: number };
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();
  return (
    maybeError.code === "42P01" ||
    maybeError.code === "PGRST205" ||
    maybeError.status === 404 ||
    text.includes("job_titles") ||
    text.includes("departments")
  ) && (
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find")
  );
}

function isMissingSignedDocumentsTableIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError & { status?: number };
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();
  return (
    maybeError.code === "42P01" ||
    maybeError.code === "PGRST205" ||
    maybeError.status === 404 ||
    text.includes("signed_documents")
  ) && (
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find")
  );
}

function isMissingEmployeeSoftDeleteColumnIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError & { status?: number };
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();
  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("deleted_at");
}

type RemoteLinkArchiveMarker = {
  employee_id: string | null;
  data: unknown;
};

function isEmployeeArchiveMarkerData(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { safeepi_purpose?: unknown }).safeepi_purpose === EMPLOYEE_ARCHIVE_MARKER
  );
}

async function getArchivedEmployeeIds(companyId: string | null): Promise<Set<string>> {
  let query = supabase
    .from("remote_links")
    .select("employee_id, data")
    .eq("type", "capture")
    .eq("status", "completed");

  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await withSessionRetry(() => query);

  if (error) {
    console.warn("[getArchivedEmployeeIds] Nao foi possivel carregar marcadores de colaboradores arquivados:", error);
    return new Set();
  }

  return new Set(
    ((data || []) as RemoteLinkArchiveMarker[])
      .filter((link) => link.employee_id && isEmployeeArchiveMarkerData(link.data))
      .map((link) => link.employee_id as string),
  );
}

function normalizeCatalogName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [header, data] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(data || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fileName, { type: mimeType });
}

async function readResponseJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const message = text.length > 180 ? `${text.slice(0, 180)}...` : text;
    throw new Error(message || "Resposta invalida do servidor.");
  }
}

let cachedCompanyId: string | null = null;
const MASTER_COMPANY_CONTEXT_KEY = "safeepi_master_company_id";

function getStoredMasterCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(MASTER_COMPANY_CONTEXT_KEY);
}

function setStoredMasterCompanyId(companyId: string | null) {
  if (typeof window === "undefined") return;
  if (companyId) {
    window.localStorage.setItem(MASTER_COMPANY_CONTEXT_KEY, companyId);
  } else {
    window.localStorage.removeItem(MASTER_COMPANY_CONTEXT_KEY);
  }
  cachedCompanyId = null;
}

async function getCurrentCompanyId(): Promise<string | null> {
  if (cachedCompanyId) return cachedCompanyId;

  const res = await fetchWithAuthRetry("/api/me");
  const data = await readResponseJson<{ user?: CurrentUser; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Nao foi possivel identificar a empresa atual.");
  }

  cachedCompanyId = data.user?.role === "MASTER"
    ? getStoredMasterCompanyId()
    : data.user?.company_id || null;
  return cachedCompanyId;
}

async function withCompanyId<T extends Record<string, unknown>>(payload: T): Promise<T & { company_id?: string }> {
  const companyId = await getCurrentCompanyId();
  return companyId ? { ...payload, company_id: companyId } : payload;
}

async function getPpeCurrentStock(ppeId: string): Promise<number | null> {
  const { data, error } = await withSessionRetry(() =>
    supabase
      .from("ppes")
      .select("current_stock")
      .eq("id", ppeId)
      .maybeSingle()
  );

  if (error) throw error;
  const raw = data?.current_stock;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getExpectedStockAfterMovement(
  currentStock: number,
  movementType: StockMovement["type"],
  quantity: number
): number {
  if (movementType === "AJUSTE") return Math.max(0, quantity);
  if (movementType === "SAIDA") return Math.max(0, currentStock - quantity);
  return currentStock + quantity;
}

async function updatePpeCurrentStock(ppeId: string, currentStock: number): Promise<void> {
  const companyId = await getCurrentCompanyId();
  const { error } = await withSessionRetry(() => {
    let query = supabase
      .from("ppes")
      .update({ current_stock: currentStock })
      .eq("id", ppeId);

    if (companyId) query = query.eq("company_id", companyId);
    return query;
  });

  if (error) throw error;
}

async function syncPpeStockAfterMovement(
  ppeId: string,
  movementType: StockMovement["type"],
  quantity: number,
  stockBefore: number | null
): Promise<void> {
  if (stockBefore === null) return;

  const expectedStock = getExpectedStockAfterMovement(stockBefore, movementType, quantity);
  const stockAfter = await getPpeCurrentStock(ppeId);

  if (stockAfter !== expectedStock) {
    await updatePpeCurrentStock(ppeId, expectedStock);
  }
}

async function insertStockOutMovement(ppeId: string, quantity: number, motive: string): Promise<void> {
  if (quantity <= 0) return;
  const stockBefore = await getPpeCurrentStock(ppeId);
  const payload = await withCompanyId({
    ppe_id: ppeId,
    quantity,
    type: "SAIDA",
    motive,
    created_by_name: "Sistema (Entrega)",
  });

  const firstTry = await withSessionRetry(() =>
    supabase
      .from("stock_movements")
      .insert([payload])
      .select()
  );

  if (!firstTry.error) {
    await syncPpeStockAfterMovement(ppeId, "SAIDA", quantity, stockBefore);
    return;
  }

  const text = `${firstTry.error.message || ""} ${firstTry.error.details || ""}`.toLowerCase();
  const missingCreatedByColumns =
    firstTry.error.code === "PGRST204" ||
    firstTry.error.code === "42703" ||
    text.includes("created_by_name") ||
    text.includes("created_by_id");

  if (!missingCreatedByColumns) {
    throw firstTry.error;
  }

  const fallbackTry = await withSessionRetry(() =>
    supabase
      .from("stock_movements")
      .insert([{
        ...(payload.company_id ? { company_id: payload.company_id } : {}),
        ppe_id: ppeId,
        quantity,
        type: "SAIDA",
        motive,
      }])
      .select()
  );

  if (fallbackTry.error) throw fallbackTry.error;
  await syncPpeStockAfterMovement(ppeId, "SAIDA", quantity, stockBefore);
}

async function insertStockInMovement(ppeId: string, quantity: number, motive: string): Promise<void> {
  if (quantity <= 0) return;
  const stockBefore = await getPpeCurrentStock(ppeId);

  const companyId = await getCurrentCompanyId();
  const payload = {
    ppe_id: ppeId,
    quantity,
    type: "ENTRADA",
    motive,
    ...(companyId ? { company_id: companyId } : {}),
  };

  const { error } = await withSessionRetry(() =>
    supabase
      .from("stock_movements")
      .insert([payload])
  );

  if (error) {
    console.warn("Nao foi possivel registrar entrada automatica de devolucao:", error);
    return;
  }

  try {
    await syncPpeStockAfterMovement(ppeId, "ENTRADA", quantity, stockBefore);
  } catch (stockError) {
    console.warn("Nao foi possivel atualizar saldo automatico de devolucao:", stockError);
  }
}

export const api = {
  async getAuthHeaders(): Promise<Record<string, string>> {
    return getSessionAuthHeaders();
  },

  // --- Autenticação ---
  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  },

  async logout() {
    cachedCompanyId = null;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async changePassword(currentPassword: string, newPassword: string) {
    const session = await ensureActiveSession();
    const email = session?.user.email;

    if (!email) {
      throw new Error("Sessao invalida. Faca login novamente.");
    }

    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (reauthError) {
      throw new Error("Senha atual incorreta.");
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
  },

  async getSession() {
    return await ensureActiveSession();
  },

  getMasterCompanyContext() {
    return getStoredMasterCompanyId();
  },

  setMasterCompanyContext(companyId: string | null) {
    setStoredMasterCompanyId(companyId);
  },

  async archiveSignedDocument(payload: SignedDocumentArchivePayload) {
    const formData = new FormData();
    const sha256Hash = payload.sha256Hash || await sha256Hex(payload.pdfBlob);
    const companyId = await getCurrentCompanyId();

    formData.append("document_type", payload.documentType);
    if (companyId) formData.append("company_id", companyId);
    formData.append("file_name", payload.fileName);
    formData.append("pdfFile", new File([payload.pdfBlob], payload.fileName, { type: "application/pdf" }));
    formData.append("sha256_hash", sha256Hash);

    if (payload.employeeId) formData.append("employee_id", payload.employeeId);
    if (payload.deliveryId) formData.append("delivery_id", payload.deliveryId);
    if (payload.deliveryIds?.length) formData.append("delivery_ids", JSON.stringify(payload.deliveryIds));
    if (payload.trainingId) formData.append("training_id", payload.trainingId);
    if (payload.authMethod) formData.append("auth_method", payload.authMethod);
    if (payload.signatureUrl) formData.append("signature_url", payload.signatureUrl);
    if (payload.photoEvidenceUrl) formData.append("photo_evidence_url", payload.photoEvidenceUrl);
    if (payload.photoEvidenceBase64) {
      formData.append("photoEvidenceFile", dataUrlToFile(payload.photoEvidenceBase64, "photo_evidence.jpg"));
    }
    if (payload.ipAddress) formData.append("ip_address", payload.ipAddress);
    if (payload.geoLocation) formData.append("geo_location", payload.geoLocation);
    if (payload.linkToken) formData.append("link_token", payload.linkToken);
    if (payload.metadata) formData.append("metadata", JSON.stringify(payload.metadata));

    const res = await fetch("/api/signed-documents", {
      method: "POST",
      headers: await this.getAuthHeaders(),
      body: formData,
    });

    const data = await readResponseJson<{ error?: string; document?: SignedDocument }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel arquivar o documento assinado.");
    return data.document;
  },

  async getSignedDocuments() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from("signed_documents")
        .select("*")
        .order("created_at", { ascending: false });
        if (companyId) query = query.eq("company_id", companyId);
        return query;
      }
    );

    if (error) {
      if (isMissingSignedDocumentsTableIssue(error)) return [] as SignedDocument[];
      throw error;
    }

    return data as SignedDocument[];
  },

  async getTrainingCertificateDocument(trainingId: string) {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
          .from("signed_documents")
          .select("*")
          .eq("document_type", "training_certificate")
          .eq("training_id", trainingId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (companyId) query = query.eq("company_id", companyId);
        return query;
      }
    );

    if (error) {
      if (isMissingSignedDocumentsTableIssue(error)) return null;
      throw error;
    }

    return (data?.[0] || null) as SignedDocument | null;
  },

  async getProfileRole(userId: string) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
    );

    if (error) throw error;
    return data?.role as Profile['role'] | undefined;
  },

  // --- Gestão de Usuários (Apenas Admin) ---
  async getCurrentUser() {
    const res = await fetchWithAuthRetry('/api/me');
    const data = await readResponseJson<{ error?: string; user?: CurrentUser }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel validar o perfil.");
    if (!data.user) throw new Error("Perfil nao encontrado na resposta do servidor.");
    return data.user;
  },

  async getCompanies() {
    const res = await fetch('/api/companies', {
      headers: await this.getAuthHeaders(),
    });
    const data = await readResponseJson<{ error?: string; companies?: CompanyWithCounts[] }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel carregar empresas.");
    return data.companies || [];
  },

  async createCompany(payload: Partial<Company>) {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await readResponseJson<{ error?: string; company?: Company }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel criar empresa.");
    return data.company;
  },

  async updateCompany(payload: Partial<Company> & { id: string }) {
    const res = await fetch('/api/companies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await readResponseJson<{ error?: string; company?: Company }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel atualizar empresa.");
    return data.company;
  },

  async uploadCompanyLogo(companyId: string, logoFile: File) {
    const formData = new FormData();
    formData.append("company_id", companyId);
    formData.append("logo", logoFile);

    const res = await fetch('/api/companies/logo', {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: formData
    });
    const data = await readResponseJson<{ error?: string; company?: Company; logo_url?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel enviar a logo.");
    return data.company;
  },

  async getUsers(companyId?: string) {
    const query = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
    const res = await fetch(`/api/users${query}`, {
      headers: await this.getAuthHeaders(),
    });
    const data = await readResponseJson<{ error?: string; users?: (Profile & { email: string, created_at: string, last_sign_in_at: string })[] }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel carregar usuarios.");
    return data.users as (Profile & { email: string, created_at: string, last_sign_in_at: string })[];
  },

  async createUser(payload: { email: string, password?: string, full_name: string, role: string, company_id?: string }) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await readResponseJson<{ error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel criar usuario.");
    return data;
  },

  async updateUser(payload: { id: string, password?: string, full_name?: string, role?: string, company_id?: string }) {
    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await readResponseJson<{ error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel atualizar usuario.");
    return data;
  },

  async deleteUser(id: string, companyId?: string) {
    const query = new URLSearchParams({ id });
    if (companyId) query.set("company_id", companyId);
    const res = await fetch(`/api/users?${query.toString()}`, {
      method: 'DELETE',
      headers: await this.getAuthHeaders(),
    });
    const data = await readResponseJson<{ error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel excluir usuario.");
    return data;
  },

  async createRemoteLink(payload: {
    employee_id: string;
    type: 'capture' | 'delivery' | 'training_signature';
    data?: Record<string, unknown> | null;
    expires_hours?: number;
  }) {
    const companyId = await getCurrentCompanyId();
    const storedMasterCompanyId = getStoredMasterCompanyId();
    const targetCompanyId = companyId || storedMasterCompanyId;

    const res = await fetch('/api/remote-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({
        ...payload,
        ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
      })
    });
    const data = await readResponseJson<{ error?: string; link?: { token: string; status: string; expires_at: string } }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel criar link remoto.");
    return data as { link: { token: string; status: string; expires_at: string } };
  },

  // --- Canteiros (Workplaces) ---
  async getWorkplaces() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('workplaces')
        .select('*')
        .order('name', { ascending: true });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );
    
    if (error) throw error;
    return data as Workplace[];
  },

  async addWorkplace(workplace: Omit<Workplace, 'id' | 'created_at'>) {
    const payload = await withCompanyId(workplace as Record<string, unknown>);
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('workplaces')
        .insert([payload])
        .select()
    );
    
    if (error) throw error;
    return data[0] as Workplace;
  },

  async updateWorkplace(id: string, updates: Partial<Workplace>) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('workplaces')
        .update(updates)
        .eq('id', id)
        .select()
    );
    
    if (error) throw error;
    return data[0] as Workplace;
  },

  async deleteWorkplace(id: string) {
    // Soft delete — preserves audit history
    const { error } = await withSessionRetry(() =>
      supabase
        .from('workplaces')
        .update({ active: false })
        .eq('id', id)
    );
    if (error) throw error;
  },

  // --- Cargos e Setores ---
  async getJobTitles() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('job_titles')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );

    if (error) {
      if (isMissingCatalogTableIssue(error)) return [] as CatalogItem[];
      throw error;
    }
    return data as CatalogItem[];
  },

  async addJobTitle(name: string) {
    const normalizedName = normalizeCatalogName(name);
    const payload = await withCompanyId({ name: normalizedName, active: true });
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('job_titles')
        .insert([payload])
        .select()
    );

    if (error) {
      if (isMissingCatalogTableIssue(error)) {
        throw new Error("A tabela job_titles ainda não existe no Supabase. Rode o SQL supabase_job_sector_catalog.sql antes de cadastrar cargos.");
      }
      throw error;
    }
    return data[0] as CatalogItem;
  },

  async updateJobTitle(id: string, name: string) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('job_titles')
        .update({ name: normalizeCatalogName(name) })
        .eq('id', id)
        .select()
    );

    if (error) throw error;
    return data[0] as CatalogItem;
  },

  async deleteJobTitle(id: string) {
    const { error } = await withSessionRetry(() =>
      supabase
        .from('job_titles')
        .update({ active: false })
        .eq('id', id)
    );
    if (error) throw error;
  },

  async getDepartments() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('departments')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );

    if (error) {
      if (isMissingCatalogTableIssue(error)) return [] as CatalogItem[];
      throw error;
    }
    return data as CatalogItem[];
  },

  async addDepartment(name: string) {
    const normalizedName = normalizeCatalogName(name);
    const payload = await withCompanyId({ name: normalizedName, active: true });
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('departments')
        .insert([payload])
        .select()
    );

    if (error) {
      if (isMissingCatalogTableIssue(error)) {
        throw new Error("A tabela departments ainda não existe no Supabase. Rode o SQL supabase_job_sector_catalog.sql antes de cadastrar setores.");
      }
      throw error;
    }
    return data[0] as CatalogItem;
  },

  async updateDepartment(id: string, name: string) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('departments')
        .update({ name: normalizeCatalogName(name) })
        .eq('id', id)
        .select()
    );

    if (error) throw error;
    return data[0] as CatalogItem;
  },

  async deleteDepartment(id: string) {
    const { error } = await withSessionRetry(() =>
      supabase
        .from('departments')
        .update({ active: false })
        .eq('id', id)
    );
    if (error) throw error;
  },

  // --- Colaboradores ---
  async getEmployees() {
    const companyId = await getCurrentCompanyId();
    let hasSoftDeleteColumn = true;
    const buildQuery = (includeSoftDeleteFilter: boolean) => {
      let query = supabase
        .from('employees')
        .select('*')
        .order('full_name', { ascending: true });
      if (companyId) query = query.eq('company_id', companyId);
      if (includeSoftDeleteFilter) query = query.is('deleted_at', null);
      return query;
    };

    let { data, error } = await withSessionRetry(() => buildQuery(true));

    if (error && isMissingEmployeeSoftDeleteColumnIssue(error)) {
      hasSoftDeleteColumn = false;
      const fallback = await withSessionRetry(() => buildQuery(false));
      data = fallback.data;
      error = fallback.error;
    }
    
    if (error) throw error;

    let employees = (data as Employee[]).filter(employee => !employee.deleted_at);

    if (!hasSoftDeleteColumn) {
      const archivedIds = await getArchivedEmployeeIds(companyId);
      employees = employees.filter(employee => !archivedIds.has(employee.id));
    }

    return employees;
  },

  async addEmployee(employee: Omit<Employee, 'id' | 'created_at'>, photoFile?: File) {
    let photoUrl = employee.photo_url;
    await ensureActiveSession();

    if (photoFile) {
      const fileName = `emp_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
      const { error: storageError } = await supabase.storage
        .from('ppe_signatures') // Reusing same bucket or could use another
        .upload(fileName, photoFile);
      
      if (storageError) throw storageError;

      const { data: { publicUrl } } = supabase.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      photoUrl = publicUrl;
    }

    const employeePayload = await withCompanyId({ ...employee, photo_url: photoUrl } as Record<string, unknown>);
    const response = await fetch('/api/employees/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({
        employee: employeePayload,
        company_id: employeePayload.company_id || getStoredMasterCompanyId(),
      }),
    });

    const result = await readResponseJson<{ error?: string; employee?: Employee; code?: string; details?: string | null }>(response);
    
    if (!response.ok) {
      if (isDuplicateCpfIssue(result)) {
        throw new Error("Este CPF ja esta cadastrado. Abra o cadastro existente para editar os dados do colaborador.");
      }
      throw new Error(result.error || "Erro ao cadastrar colaborador");
    }

    return result.employee as Employee;
  },

  async updateEmployee(id: string, updates: Partial<Employee>, photoFile?: File) {
    const finalUpdates = { ...updates };
    await ensureActiveSession();

    // Upload da foto se houver arquivo novo
    if (photoFile) {
      const fileName = `emp_${Date.now()}_${id}.png`;
      const { error: storageError } = await supabase.storage
        .from('ppe_signatures')
        .upload(fileName, photoFile);
      
      if (storageError) throw storageError;

      const { data: { publicUrl } } = supabase.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      finalUpdates.photo_url = publicUrl;
    }

    // Usa rota server-side para contornar RLS
    const response = await fetch('/api/employees/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({ id, updates: finalUpdates, company_id: getStoredMasterCompanyId() })
    });

    const result = await readResponseJson<{ error?: string; employee?: Employee }>(response);
    console.log('[updateEmployee] Server response:', result);

    if (!response.ok) {
      if (isDuplicateCpfIssue(result)) {
        throw new Error("Este CPF já está cadastrado em outro colaborador.");
      }
      throw new Error(result.error || 'Erro ao atualizar colaborador');
    }
    return result.employee as Employee;
  },

  async removeEmployeePhoto(id: string) {
    console.log('[removeEmployeePhoto] Chamando API server-side para remover foto');
    const response = await fetch('/api/employees/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({ id, removePhoto: true, company_id: getStoredMasterCompanyId() })
    });

    const result = await readResponseJson<{ error?: string; employee?: Employee }>(response);
    console.log('[removeEmployeePhoto] Server response:', result);

    if (!response.ok) throw new Error(result.error || 'Erro ao remover foto');
    return result.employee as Employee;
  },

  async deleteEmployee(id: string) {
    const response = await fetch('/api/employees/update', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({ id, company_id: getStoredMasterCompanyId() })
    });

    const result = await readResponseJson<{ error?: string; employee?: Pick<Employee, 'id' | 'full_name'>; linkedRecords?: number }>(response);

    if (!response.ok) {
      throw new Error(result.error || 'Erro ao excluir colaborador');
    }

    return result.employee;
  },

  async activateEmployee(id: string) {
    return await this.updateEmployee(id, {
      active: true,
      termination_date: null,
    });
  },

  async terminateEmployee(employeeId: string) {
    const { error } = await withSessionRetry(() =>
      supabase
        .from('employees')
        .update({ active: false }) // termination_date removed as it's missing from DB
        .eq('id', employeeId)
    );
    
    if (error) throw error;
  },

  // --- EPIs ---
  async getPpes() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('ppes')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );
    
    if (error) throw error;
    return data as PPE[];
  },

  async addPpe(ppe: Omit<PPE, 'id' | 'created_at'>) {
    const payload = await withCompanyId(ppe as Record<string, unknown>);
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('ppes')
        .insert([payload])
        .select()
    );
    
    if (error) throw error;
    return data[0] as PPE;
  },

  async updatePpe(id: string, updates: Partial<PPE>) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('ppes')
        .update(updates)
        .eq('id', id)
        .select()
    );
    
    if (error) throw error;
    return data[0] as PPE;
  },

  async deletePpe(id: string) {
    const companyId = await getCurrentCompanyId();
    const params = new URLSearchParams({ id });
    if (companyId) params.set("company_id", companyId);
    const storedMasterCompanyId = getStoredMasterCompanyId();
    if (!companyId && storedMasterCompanyId) params.set("company_id", storedMasterCompanyId);

    const response = await fetch(`/api/ppes?${params.toString()}`, {
      method: "DELETE",
      headers: await this.getAuthHeaders(),
    });

    const result = await readResponseJson<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(result.error || "Erro ao excluir EPI/CA.");
    }
  },

  // --- Estoque (Stock Movements) ---
  async getStockMovements() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('stock_movements')
        .select(`
          *,
          ppe:ppes(name, active)
        `)
        .order('created_at', { ascending: false });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );
    
    if (error) throw error;
    return (data || []).filter((movement) => movement.ppe && movement.ppe.active !== false) as StockMovement[];
  },

  async addStockMovement(movement: Omit<StockMovement, 'id' | 'created_at' | 'ppe'>) {
    const response = await fetchWithAuthRetry('/api/stock-movements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(movement),
    });

    const result = await readResponseJson<{ data?: StockMovement; error?: string; code?: string; details?: string }>(response);
    if (!response.ok) {
      throw new Error(result.error || "Erro ao aplicar ajuste de estoque.");
    }

    if (!result.data) {
      throw new Error("Movimentacao de estoque nao retornou registro salvo.");
    }

    return result.data
  },

  // --- Entregas ---
  async getDeliveries() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('deliveries')
        .select(`
          *,
          employee:employees(full_name, cpf, job_title),
          ppe:ppes(name, ca_number, ca_expiry_date, cost, lifespan_days),
          workplace:workplaces(name)
        `)
        .order('delivery_date', { ascending: false });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );
    
    if (error) throw error;
    return data as DeliveryWithRelations[];
  },

  async getEmployeeHistory(employeeId: string) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .select(`
          *,
          employee:employees(full_name, cpf, job_title, active, admission_date),
          ppe:ppes(name, ca_number, ca_expiry_date, cost, lifespan_days),
          workplace:workplaces(name)
        `)
        .eq('employee_id', employeeId)
        .order('delivery_date', { ascending: false })
    );
    
    if (error) throw error;
    return data as DeliveryWithRelations[];
  },

  async saveDelivery(delivery: Omit<Delivery, 'id' | 'created_at'>, signatureFile?: File) {
    let signatureUrl = null;
    await ensureActiveSession();
    const reasonVariants = getDeliveryReasonStorageVariants(delivery.reason);
    const normalizedReason = reasonVariants[0] as Delivery["reason"];
    const stockBefore = await getPpeCurrentStock(delivery.ppe_id);

    // 1. Se houver imagem da assinatura, faz o upload para o Storage
    if (signatureFile) {
      const prefix = delivery.auth_method === 'facial' ? 'bio_' : 'sig_';
      const fileName = `${prefix}${Date.now()}_${delivery.employee_id}.png`;
      const { error: storageError } = await supabase.storage
        .from('ppe_signatures')
        .upload(fileName, signatureFile);
      
      if (storageError) throw storageError;

      // 2. Pega a URL pública do arquivo
      const { data: { publicUrl } } = supabase.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      signatureUrl = publicUrl;
    }

    const syncStockIfNeeded = async (reasonVariant: string) => {
      const stockAfterInsert = await getPpeCurrentStock(delivery.ppe_id);
      const desiredStock = stockBefore === null ? null : Math.max(0, stockBefore - delivery.quantity);

      // If delivery insert did not reduce stock (missing trigger/misconfig), compensate via stock movement.
      if (desiredStock !== null && stockAfterInsert !== null && stockAfterInsert > desiredStock) {
        const missingOut = stockAfterInsert - desiredStock;
        await insertStockOutMovement(delivery.ppe_id, missingOut, `Entrega de EPI (${reasonVariant})`);
      }
    };

    // 3. Salva o registro na tabela de entregas
    const baseInsertPayload = await withCompanyId({
      ...delivery,
      reason: normalizedReason,
      signature_url: signatureUrl,
      delivery_date: delivery.delivery_date || new Date().toISOString(),
    } as Record<string, unknown>);

    let insertError: unknown = null;

    for (const reasonVariant of reasonVariants) {
      const insertPayload: Record<string, unknown> = {
        ...baseInsertPayload,
        reason: reasonVariant,
      };

      const firstInsertResult = await withSessionRetry(() =>
        supabase
          .from('deliveries')
          .insert([insertPayload])
          .select()
      );

      if (!firstInsertResult.error && firstInsertResult.data?.[0]) {
        await syncStockIfNeeded(reasonVariant);
        return firstInsertResult.data[0];
      }

      insertError = firstInsertResult.error;

      if (isDeliverySchemaCompatibilityIssue(insertError)) {
        const fallbackPayload = {
          ...(insertPayload.company_id ? { company_id: insertPayload.company_id } : {}),
          employee_id: insertPayload.employee_id,
          ppe_id: insertPayload.ppe_id,
          reason: insertPayload.reason,
          quantity: insertPayload.quantity,
          signature_url: insertPayload.signature_url,
          ip_address: insertPayload.ip_address,
          delivery_date: insertPayload.delivery_date,
        };

        const fallbackResult = await withSessionRetry(() =>
          supabase
            .from('deliveries')
            .insert([fallbackPayload])
            .select()
        );

        if (!fallbackResult.error && fallbackResult.data?.[0]) {
          await syncStockIfNeeded(reasonVariant);
          return fallbackResult.data[0];
        }

        insertError = fallbackResult.error;
      }

      if (!isDeliveryReasonConstraintIssue(insertError)) break;
    }

    if (isDeliveryReasonConstraintIssue(insertError)) {
      throw new Error(
        "Motivo da entrega nao aceito pelo banco. Atualize o CHECK da coluna reason em deliveries para aceitar Substituição (Desgaste/Validade)."
      );
    }

    throw insertError || new Error("Falha ao salvar entrega no Supabase.");
  },

  async returnDelivery(deliveryId: string, motive: string) {
    const { data: deliveryBefore } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .select('ppe_id, quantity, returned_quantity, returned_at')
        .eq('id', deliveryId)
        .maybeSingle()
    );

    const alreadyReturned = Number(deliveryBefore?.returned_quantity || 0);
    const totalQuantity = Number(deliveryBefore?.quantity || 0);
    const quantityToReturn = deliveryBefore?.returned_at ? 0 : Math.max(0, totalQuantity - alreadyReturned);

    const { error } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .update({ returned_at: new Date().toISOString(), return_motive: motive, returned_quantity: totalQuantity })
        .eq('id', deliveryId)
    );

    if (!error) {
      if (deliveryBefore?.ppe_id && quantityToReturn > 0) {
        await insertStockInMovement(deliveryBefore.ppe_id, quantityToReturn, `Devolucao de EPI (${motive})`);
      }
      return;
    }

    if (isMissingDeliveryReturnMotiveIssue(error)) {
      const { error: fallbackError } = await withSessionRetry(() =>
        supabase
          .from('deliveries')
          .update({ returned_at: new Date().toISOString() })
          .eq('id', deliveryId)
      );

      if (!fallbackError) {
        if (deliveryBefore?.ppe_id && quantityToReturn > 0) {
          await insertStockInMovement(deliveryBefore.ppe_id, quantityToReturn, `Devolucao de EPI (${motive})`);
        }
        return;
      }

      throw fallbackError;
    }

    throw error;
  },

  async returnDeliveryQuantity(deliveryId: string, motive: string, quantity: number) {
    if (quantity <= 0) return;

    const { data: delivery, error: fetchError } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .select('id, ppe_id, quantity, returned_quantity, returned_at')
        .eq('id', deliveryId)
        .maybeSingle()
    );

    if (fetchError) throw fetchError;
    if (!delivery) throw new Error("Entrega anterior nao encontrada para baixa parcial.");

    const totalQuantity = Number(delivery.quantity || 0);
    const alreadyReturned = Number(delivery.returned_quantity || 0);
    const remaining = Math.max(0, totalQuantity - alreadyReturned);
    const quantityToReturn = Math.min(quantity, remaining);

    if (quantityToReturn <= 0) return;

    const nextReturnedQuantity = alreadyReturned + quantityToReturn;
    const shouldClose = nextReturnedQuantity >= totalQuantity;
    const updatePayload = {
      returned_quantity: nextReturnedQuantity,
      return_motive: motive,
      ...(shouldClose ? { returned_at: new Date().toISOString() } : {}),
    };

    const { error } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .update(updatePayload)
        .eq('id', deliveryId)
    );

    if (error) throw error;

    await insertStockInMovement(delivery.ppe_id, quantityToReturn, `Baixa parcial por substituicao (${motive})`);
  },

  async returnMultipleDeliveries(deliveryIds: string[], motive: string) {
    const { error } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .update({ returned_at: new Date().toISOString(), return_motive: motive })
        .in('id', deliveryIds)
    );
    
    if (error) throw error;
  },

  // --- Treinamentos ---
  async getTrainings() {
    const companyId = await getCurrentCompanyId();
    const { data, error } = await withSessionRetry(() =>
      {
        let query = supabase
        .from('trainings')
        .select(`
          *,
          employee:employees!trainings_employee_id_fkey(full_name, cpf)
        `)
        .order('completion_date', { ascending: false });
        if (companyId) query = query.eq('company_id', companyId);
        return query;
      }
    );
    
    if (error) throw error;
    return data as TrainingWithRelations[];
  },

  async addTraining(training: Omit<Training, 'id' | 'created_at'>): Promise<AddTrainingResult> {
    const payload = await withCompanyId(training as Record<string, unknown>);
    const response = await fetch("/api/trainings", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await this.getAuthHeaders()) },
      body: JSON.stringify({
        training: payload,
        company_id: payload.company_id || getStoredMasterCompanyId(),
      }),
    });

    const result = await readResponseJson<{ error?: string; training?: Training; warning?: string }>(response);
    if (!response.ok) {
      throw new Error(result.error || "Erro ao salvar treinamento no banco de dados.");
    }

    return { training: result.training as Training, warning: result.warning };
  },

  async deleteTraining(id: string) {
    const companyId = await getCurrentCompanyId();
    const params = new URLSearchParams({ id });
    if (companyId) params.set("company_id", companyId);
    const storedMasterCompanyId = getStoredMasterCompanyId();
    if (!companyId && storedMasterCompanyId) params.set("company_id", storedMasterCompanyId);

    const response = await fetch(`/api/trainings?${params.toString()}`, {
      method: "DELETE",
      headers: await this.getAuthHeaders(),
    });

    const result = await readResponseJson<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(result.error || "Erro ao excluir certificado.");
    }
  },

  // --- Perfis de Usuário (RBAC) ---
  async getProfiles() {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true })
    );
    
    if (error) throw error;
    return data as Profile[];
  },

  async updateProfileRole(userId: string, role: Profile['role']) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('profiles')
        .update({ role })
        .eq('id', userId)
        .select()
        .maybeSingle()
    );
    
    if (error) throw error;
    return data as Profile | null;
  }
};
