import { supabase } from "@/lib/supabase";
import { Employee, PPE, Delivery, Training, DeliveryWithRelations, TrainingWithRelations, Workplace, StockMovement, Profile, CatalogItem, SignedDocument, CurrentUser, Company, ThirdParty } from "@/types/database";
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

export type GlobalSearchResults = {
  employees: Array<Pick<Employee, "id" | "full_name" | "cpf">>;
  ppes: Array<Pick<PPE, "id" | "name" | "ca_number">>;
  workplaces: Array<Pick<Workplace, "id" | "name">>;
};

export type SystemNotification = {
  id: string;
  title: string;
  description: string;
  type: "CA" | "STOCK" | "LIFESPAN";
  severity: "high" | "medium";
};

export type DashboardSummary = {
  stats: {
    deliveries: number;
    employees: number;
    criticalCAs: number;
    lowStock: number;
    signedDocuments: number;
  };
  employeeCounts: { own: number; third_party: number; all: number };
  recentDeliveries: Array<{
    id: string;
    delivery_date: string;
    employee: { full_name: string } | null;
    ppe: { name: string } | null;
  }>;
  chartData: Array<{ date: string; value: number }>;
};

const SESSION_REFRESH_BUFFER_SECONDS = 60;
const EMPLOYEE_ARCHIVE_MARKER = "employee_soft_delete";
const SIGNED_DOCUMENT_DIRECT_UPLOAD_THRESHOLD_BYTES = 2.5 * 1024 * 1024;
const MASTER_COMPANY_CONTEXT_KEY = "safeepi_master_company_id";
const AUTH_CONTEXT_SYNC_EVENT = "safeepi:auth-sync";

let sessionRefreshPromise: Promise<Session | null> | null = null;
let cachedCompanyId: string | null = null;
let cachedCompanyIdResolved = false;
let companyIdRequest: Promise<string | null> | null = null;

type SignedDocumentUploadTarget = {
  error?: string;
  path?: string;
  token?: string;
  signedUrl?: string;
  publicUrl?: string;
};

type PrivateAssetMode = "view" | "download";
const BIOMETRIC_BUCKET = "biometric_photos";

type PrivateAssetResponse = {
  assets?: Array<{
    key: string;
    path: string | null;
    signedUrl: string | null;
    allowed: boolean;
  }>;
  error?: string;
};

type EmployeeBiometricWrite = {
  face_descriptor?: number[] | null;
};

const EMPLOYEE_BASE_SELECT = [
  "id",
  "company_id",
  "third_party_id",
  "full_name",
  "cpf",
  "job_title",
  "department",
  "admission_date",
  "active",
  "workplace_id",
  "termination_date",
  "photo_url",
  "created_at",
].join(",");

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

function getResolvedOperationError(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("error" in result)) return null;
  return (result as { error?: unknown }).error || null;
}

async function refreshActiveSession(): Promise<Session | null> {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = (async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (!data.session) throw new Error("Sessao nao pode ser renovada.");
      return data.session;
    })().finally(() => {
      sessionRefreshPromise = null;
    });
  }

  return sessionRefreshPromise;
}

async function ensureActiveSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session) return null;

  const expiresAt = session.expires_at ?? 0;
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (expiresAt !== 0 && expiresAt <= nowInSeconds + SESSION_REFRESH_BUFFER_SECONDS) {
    try {
      return await refreshActiveSession();
    } catch (refreshError) {
      clearCompanyContextCache(true);
      await supabase.auth.signOut();
      throw refreshError;
    }
  }

  return session;
}

async function withSessionRetry<T>(operation: () => PromiseLike<T>): Promise<T> {
  await ensureActiveSession();

  let result: T;
  try {
    result = await operation();
  } catch (error) {
    if (!isJwtExpiredError(error)) {
      throw error;
    }

    try {
      await refreshActiveSession();
    } catch (refreshError) {
      clearCompanyContextCache(true);
      await supabase.auth.signOut();
      throw refreshError;
    }

    return await operation();
  }

  const operationError = getResolvedOperationError(result);
  if (!isJwtExpiredError(operationError)) return result;

  try {
    await refreshActiveSession();
  } catch (refreshError) {
    clearCompanyContextCache(true);
    await supabase.auth.signOut();
    throw refreshError;
  }

  return await operation();
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

  let refreshedSession: Session | null = null;
  try {
    refreshedSession = await refreshActiveSession();
  } catch {
    clearCompanyContextCache(true);
    await supabase.auth.signOut();
    return response;
  }

  if (!refreshedSession) {
    clearCompanyContextCache(true);
    await supabase.auth.signOut();
    return response;
  }

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${refreshedSession.access_token}`);
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

type RemoteLinkArchiveMarker = {
  employee_id: string | null;
  data: unknown;
  employee?: {
    active?: boolean | null;
  } | null;
};

export type PendingDeliveryRemoteLink = {
  id: string;
  employee_id: string;
  company_id: string | null;
  type: string;
  token: string;
  status: "pending" | "completed" | "expired";
  data: Record<string, unknown> | null;
  expires_at: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  employee?: {
    id?: string;
    full_name?: string | null;
    cpf?: string | null;
  } | null;
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
    .select("employee_id, data, employee:employees(active)")
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
      .filter((link) => link.employee_id && isEmployeeArchiveMarkerData(link.data) && link.employee?.active !== true)
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

function getStoredMasterCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(MASTER_COMPANY_CONTEXT_KEY);
}

function clearCompanyContextCache(clearStoredMasterCompany = false) {
  cachedCompanyId = null;
  cachedCompanyIdResolved = false;
  companyIdRequest = null;

  if (clearStoredMasterCompany && typeof window !== "undefined") {
    window.localStorage.removeItem(MASTER_COMPANY_CONTEXT_KEY);
  }
}

function primeResolvedCompanyContext(user: Pick<CurrentUser, "role" | "company_id">) {
  cachedCompanyId = user.role === "MASTER"
    ? getStoredMasterCompanyId()
    : user.company_id || null;
  cachedCompanyIdResolved = true;
  companyIdRequest = null;
}

function setStoredMasterCompanyId(companyId: string | null) {
  if (typeof window === "undefined") return;
  if (companyId) {
    window.localStorage.setItem(MASTER_COMPANY_CONTEXT_KEY, companyId);
  } else {
    window.localStorage.removeItem(MASTER_COMPANY_CONTEXT_KEY);
  }
  cachedCompanyId = companyId;
  cachedCompanyIdResolved = true;
  companyIdRequest = null;
}

async function getCurrentCompanyId(): Promise<string | null> {
  if (cachedCompanyIdResolved) return cachedCompanyId;
  if (companyIdRequest) return companyIdRequest;

  companyIdRequest = (async () => {
    const res = await fetchWithAuthRetry("/api/me");
    const data = await readResponseJson<{ user?: CurrentUser; error?: string }>(res);

    if (!res.ok) {
      throw new Error(data.error || "Nao foi possivel identificar a empresa atual.");
    }

    if (!data.user) {
      throw new Error("Perfil sem contexto de empresa.");
    }

    primeResolvedCompanyContext(data.user);
    return cachedCompanyId;
  })().finally(() => {
    companyIdRequest = null;
  });

  return companyIdRequest;
}

async function withCompanyId<T extends Record<string, unknown>>(payload: T): Promise<T & { company_id?: string }> {
  const companyId = await getCurrentCompanyId();
  return companyId ? { ...payload, company_id: companyId } : payload;
}

async function uploadDeliverySignature(
  signatureFile: File,
  employeeId: string,
  authMethod?: Delivery["auth_method"] | null,
): Promise<string> {
  const formData = new FormData();
  const companyId = await getCurrentCompanyId();
  const storedMasterCompanyId = getStoredMasterCompanyId();
  const targetCompanyId = companyId || storedMasterCompanyId;

  formData.append("signatureFile", signatureFile);
  formData.append("employee_id", employeeId);
  if (authMethod) formData.append("auth_method", authMethod);
  if (targetCompanyId) formData.append("company_id", targetCompanyId);

  const response = await fetchWithAuthRetry("/api/signature-upload", {
    method: "POST",
    body: formData,
  });
  const result = await readResponseJson<{ error?: string; publicUrl?: string; signedUrl?: string; path?: string }>(response);

  if (!response.ok || !result.path) {
    throw new Error(result.error || "Nao foi possivel salvar a assinatura.");
  }

  return result.path;
}

function storagePathShadowKey(field: string) {
  if (field === "document_url") return "storage_path";
  return field.replace(/_url$/, "_storage_path");
}

function shouldSignStorageValue(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    !value.startsWith("data:") &&
    !value.startsWith("blob:") &&
    !value.startsWith("/");
}

async function getPrivateAssetUrl(
  value?: string | null,
  mode: PrivateAssetMode = "view",
  downloadName?: string,
  bucket?: string,
): Promise<string | null> {
  if (!value) return null;
  if (!shouldSignStorageValue(value)) return value;

  const response = await fetchWithAuthRetry("/api/storage/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assets: [{ key: "asset", path: value, mode, downloadName, bucket }],
    }),
  });

  const data = await readResponseJson<PrivateAssetResponse>(response);
  if (!response.ok) throw new Error(data.error || "Nao foi possivel gerar URL temporaria.");
  return data.assets?.[0]?.signedUrl || null;
}

async function signStorageFields<T extends Record<string, unknown>>(
  rows: T[],
  fields: string[],
  mode: PrivateAssetMode = "view",
  bucket?: string,
): Promise<T[]> {
  const assets: Array<{ key: string; path: string; mode: PrivateAssetMode; bucket?: string }> = [];

  rows.forEach((row, rowIndex) => {
    fields.forEach((field) => {
      const value = row[field];
      if (shouldSignStorageValue(value)) {
        assets.push({ key: `${rowIndex}:${field}`, path: value, mode, bucket });
      }
    });
  });

  if (assets.length === 0) return rows;

  const signedByKey = new Map<string, string>();
  for (let index = 0; index < assets.length; index += 50) {
    const batch = assets.slice(index, index + 50);
    const response = await fetchWithAuthRetry("/api/storage/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assets: batch }),
    });
    const data = await readResponseJson<PrivateAssetResponse>(response);
    if (!response.ok) throw new Error(data.error || "Nao foi possivel assinar arquivos privados.");
    for (const asset of data.assets || []) {
      if (asset.signedUrl) signedByKey.set(asset.key, asset.signedUrl);
    }
  }

  return rows.map((row, rowIndex) => {
    const next: Record<string, unknown> = { ...row };
    fields.forEach((field) => {
      const originalValue = row[field];
      const shadowKey = storagePathShadowKey(field);
      if (shouldSignStorageValue(originalValue) && !next[shadowKey]) {
        next[shadowKey] = originalValue;
      }
      const signedUrl = signedByKey.get(`${rowIndex}:${field}`);
      if (signedUrl) next[field] = signedUrl;
    });
    return next as T;
  });
}

async function uploadEmployeePhoto(photoFile: File, employeeId?: string): Promise<string> {
  const formData = new FormData();
  const companyId = await getCurrentCompanyId();
  const storedMasterCompanyId = getStoredMasterCompanyId();
  const targetCompanyId = companyId || storedMasterCompanyId;

  formData.append("photoFile", photoFile);
  formData.append("employee_id", employeeId || "new");
  if (targetCompanyId) formData.append("company_id", targetCompanyId);

  const response = await fetchWithAuthRetry("/api/employee-photo-upload", {
    method: "POST",
    body: formData,
  });
  const result = await readResponseJson<{ error?: string; publicUrl?: string; signedUrl?: string; path?: string }>(response);

  if (!response.ok || !result.path) {
    throw new Error(result.error || "Nao foi possivel salvar a foto do colaborador.");
  }

  return result.path;
}

export const api = {
  async getAuthHeaders(): Promise<Record<string, string>> {
    return getSessionAuthHeaders();
  },

  async getPrivateAssetUrl(value?: string | null, mode: PrivateAssetMode = "view", downloadName?: string, bucket?: string) {
    return getPrivateAssetUrl(value, mode, downloadName, bucket);
  },

  // --- Autenticação ---
  async login(email: string, password: string) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await readResponseJson<{ error?: string; user?: Session["user"] }>(response);

    if (!response.ok || !data.user) {
      throw new Error(data.error || "Falha ao autenticar.");
    }

    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error || !sessionData.session) throw error || new Error("Sessao nao foi persistida.");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_CONTEXT_SYNC_EVENT));
    }
    return sessionData;
  },

  async logout() {
    clearCompanyContextCache(true);
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

  primeCompanyContext(user: Pick<CurrentUser, "role" | "company_id">) {
    primeResolvedCompanyContext(user);
  },

  resetCompanyContext() {
    clearCompanyContextCache(true);
  },

  async getCurrentCompanyContext() {
    return getCurrentCompanyId();
  },

  async searchGlobal(query: string, signal?: AbortSignal): Promise<GlobalSearchResults> {
    const params = new URLSearchParams({ q: query.trim() });
    const companyId = await getCurrentCompanyId();
    if (companyId) params.set("company_id", companyId);

    const response = await fetchWithAuthRetry(`/api/search?${params.toString()}`, { signal });
    const result = await readResponseJson<GlobalSearchResults & { error?: string }>(response);
    if (!response.ok) throw new Error(result.error || "Falha ao realizar a busca.");
    return {
      employees: result.employees || [],
      ppes: result.ppes || [],
      workplaces: result.workplaces || [],
    };
  },

  async getNotifications(): Promise<SystemNotification[]> {
    const params = new URLSearchParams();
    const companyId = await getCurrentCompanyId();
    if (companyId) params.set("company_id", companyId);
    const response = await fetchWithAuthRetry(`/api/notifications${params.size ? `?${params.toString()}` : ""}`);
    const result = await readResponseJson<{ notifications?: SystemNotification[]; error?: string }>(response);
    if (!response.ok) throw new Error(result.error || "Falha ao carregar alertas.");
    return result.notifications || [];
  },

  async getDashboardSummary(filters: {
    allHistory: boolean;
    start: string;
    end: string;
    chartStart: string;
    chartEnd: string;
    scope: "own" | "third_party" | "all";
  }, signal?: AbortSignal): Promise<DashboardSummary> {
    const params = new URLSearchParams({
      all: String(filters.allHistory),
      start: filters.start,
      end: filters.end,
      chart_start: filters.chartStart,
      chart_end: filters.chartEnd,
      scope: filters.scope,
    });
    const companyId = await getCurrentCompanyId();
    if (companyId) params.set("company_id", companyId);
    const response = await fetchWithAuthRetry(`/api/dashboard?${params.toString()}`, { signal });
    const result = await readResponseJson<DashboardSummary & { error?: string }>(response);
    if (!response.ok) throw new Error(result.error || "Falha ao carregar o dashboard.");
    return result;
  },

  setMasterCompanyContext(companyId: string | null) {
    setStoredMasterCompanyId(companyId);
  },

  async archiveSignedDocument(payload: SignedDocumentArchivePayload) {
    const formData = new FormData();
    const sha256Hash = payload.sha256Hash || await sha256Hex(payload.pdfBlob);
    let companyId: string | null = null;
    try {
      companyId = await getCurrentCompanyId();
    } catch (error) {
      if (!payload.linkToken) throw error;
    }

    let preuploadedPdf: { storagePath: string; documentUrl: string } | null = null;
    if (payload.pdfBlob.size >= SIGNED_DOCUMENT_DIRECT_UPLOAD_THRESHOLD_BYTES) {
      const uploadFormData = new FormData();
      uploadFormData.append("document_type", payload.documentType);
      uploadFormData.append("file_name", payload.fileName);
      if (companyId) uploadFormData.append("company_id", companyId);
      if (payload.employeeId) uploadFormData.append("employee_id", payload.employeeId);
      if (payload.linkToken) uploadFormData.append("link_token", payload.linkToken);

      const uploadTargetResponse = await fetch("/api/signed-documents/upload-url", {
        method: "POST",
        headers: await this.getAuthHeaders(),
        body: uploadFormData,
      });
      const uploadTarget = await readResponseJson<SignedDocumentUploadTarget>(uploadTargetResponse);

      if (!uploadTargetResponse.ok || !uploadTarget.path || !uploadTarget.token) {
        throw new Error(uploadTarget.error || "Nao foi possivel preparar upload direto do PDF.");
      }

      const { error: uploadError } = await supabase.storage
        .from("ppe_signatures")
        .uploadToSignedUrl(uploadTarget.path, uploadTarget.token, payload.pdfBlob, {
          contentType: "application/pdf",
        });

      if (uploadError) {
        throw new Error(uploadError.message || "Nao foi possivel enviar o PDF para o Storage.");
      }

      preuploadedPdf = {
        storagePath: uploadTarget.path,
        documentUrl: uploadTarget.path,
      };
    }

    formData.append("document_type", payload.documentType);
    if (companyId) formData.append("company_id", companyId);
    formData.append("file_name", payload.fileName);
    if (preuploadedPdf) {
      formData.append("storage_path", preuploadedPdf.storagePath);
      formData.append("document_url", preuploadedPdf.documentUrl);
    } else {
      formData.append("pdfFile", new File([payload.pdfBlob], payload.fileName, { type: "application/pdf" }));
    }
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
    let sdQuery = supabase.from("signed_documents").select("*").order("created_at", { ascending: false });
    if (companyId) sdQuery = sdQuery.eq("company_id", companyId);
    const { data, error } = await withSessionRetry(() => sdQuery);

    if (error) {
      if (isMissingSignedDocumentsTableIssue(error)) return [] as SignedDocument[];
      throw error;
    }

    return signStorageFields((data || []) as unknown as Record<string, unknown>[], [
      "document_url",
      "signature_url",
      "photo_evidence_url",
    ]) as Promise<SignedDocument[]>;
  },

  async getTrainingCertificateDocument(trainingId: string) {
    const companyId = await getCurrentCompanyId();
    let tcQuery = supabase.from("signed_documents").select("*").eq("document_type", "training_certificate").eq("training_id", trainingId).order("created_at", { ascending: false }).limit(1);
    if (companyId) tcQuery = tcQuery.eq("company_id", companyId);
    const { data, error } = await withSessionRetry(() => tcQuery);

    if (error) {
      if (isMissingSignedDocumentsTableIssue(error)) return null;
      throw error;
    }

    const signed = await signStorageFields((data || []) as unknown as Record<string, unknown>[], [
      "document_url",
      "signature_url",
      "photo_evidence_url",
    ]);
    return (signed?.[0] || null) as SignedDocument | null;
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
    const res = await fetchWithAuthRetry('/api/companies');
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

  async getPendingDeliverySignatureLinks() {
    const companyId = await getCurrentCompanyId();
    const storedMasterCompanyId = getStoredMasterCompanyId();
    const targetCompanyId = companyId || storedMasterCompanyId;
    const params = new URLSearchParams({
      type: "delivery",
      status: "pending",
      signature_pending_only: "1",
    });

    if (targetCompanyId) params.set("company_id", targetCompanyId);

    const res = await fetchWithAuthRetry(`/api/remote-links?${params.toString()}`);
    const data = await readResponseJson<{ error?: string; links?: PendingDeliveryRemoteLink[] }>(res);
    if (!res.ok) throw new Error(data.error || "Nao foi possivel carregar pendencias de assinatura.");
    return data.links || [];
  },

  // --- Canteiros (Workplaces) ---
  async getWorkplaces() {
    const companyId = await getCurrentCompanyId();
    let query = supabase.from('workplaces').select('*').order('name', { ascending: true });
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await withSessionRetry(() => query);
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

  // --- Terceiros / Tomadores ---
  async getThirdParties() {
    const companyId = await getCurrentCompanyId();
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);

    const response = await fetchWithAuthRetry(`/api/third-parties${params.size ? `?${params.toString()}` : ""}`);
    const result = await readResponseJson<{ error?: string; thirdParties?: ThirdParty[] }>(response);

    if (!response.ok) {
      throw new Error(result.error || "Erro ao carregar terceiros.");
    }

    return result.thirdParties || [];
  },

  async addThirdParty(thirdParty: Omit<ThirdParty, 'id' | 'created_at' | 'updated_at'>) {
    const payload = await withCompanyId(thirdParty as Record<string, unknown>);

    const response = await fetchWithAuthRetry("/api/third-parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thirdParty: payload,
        company_id: payload.company_id || getStoredMasterCompanyId(),
      }),
    });
    const result = await readResponseJson<{ error?: string; thirdParty?: ThirdParty; code?: string }>(response);

    if (!response.ok) {
      if (result.code === "42P01" || result.code === "PGRST205") {
        throw new Error("A tabela third_parties ainda nao existe no Supabase. Rode o SQL safeepi_third_parties.sql antes de cadastrar terceiros.");
      }
      throw new Error(result.error || "Erro ao cadastrar terceiro.");
    }

    return result.thirdParty as ThirdParty;
  },

  async updateThirdParty(id: string, updates: Partial<ThirdParty>) {
    const response = await fetchWithAuthRetry("/api/third-parties", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, updates, company_id: getStoredMasterCompanyId() }),
    });
    const result = await readResponseJson<{ error?: string; thirdParty?: ThirdParty }>(response);

    if (!response.ok) throw new Error(result.error || "Erro ao atualizar terceiro.");
    return result.thirdParty as ThirdParty;
  },

  async deleteThirdParty(id: string) {
    const companyId = await getCurrentCompanyId();
    const params = new URLSearchParams({ id });
    if (companyId) params.set("company_id", companyId);
    const storedMasterCompanyId = getStoredMasterCompanyId();
    if (!companyId && storedMasterCompanyId) params.set("company_id", storedMasterCompanyId);

    const response = await fetchWithAuthRetry(`/api/third-parties?${params.toString()}`, {
      method: "DELETE",
    });
    const result = await readResponseJson<{ error?: string }>(response);
    if (!response.ok) throw new Error(result.error || "Erro ao remover terceiro.");
  },

  // --- Cargos e Setores ---
  async getJobTitles() {
    const companyId = await getCurrentCompanyId();
    let query = supabase.from('job_titles').select('*').eq('active', true).order('name', { ascending: true });
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await withSessionRetry(() => query);
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
    let query = supabase.from('departments').select('*').eq('active', true).order('name', { ascending: true });
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await withSessionRetry(() => query);
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
    const buildEmployeeQuery = (selectColumns: string) => {
      let empQuery = supabase.from('employees').select(selectColumns).order('full_name', { ascending: true });
      if (companyId) empQuery = empQuery.eq('company_id', companyId);
      return empQuery;
    };

    const { data, error } = await withSessionRetry(() => buildEmployeeQuery(EMPLOYEE_BASE_SELECT));

    if (error) throw error;

    const rows = ((data || []) as unknown) as Employee[];
    const hasSoftDeleteColumn = rows.some((employee) =>
      Object.prototype.hasOwnProperty.call(employee as Record<string, unknown>, "deleted_at")
    );
    let employees = rows.filter(employee => !employee.deleted_at);

    if (!hasSoftDeleteColumn) {
      const archivedIds = await getArchivedEmployeeIds(companyId);
      employees = employees.filter(employee => !archivedIds.has(employee.id));
    }

    return signStorageFields(employees as unknown as Record<string, unknown>[], ["photo_url"], "view", BIOMETRIC_BUCKET) as Promise<Employee[]>;
  },

  async addEmployee(employee: Omit<Employee, 'id' | 'created_at'> & EmployeeBiometricWrite, photoFile?: File) {
    let photoUrl = employee.photo_url;
    await ensureActiveSession();

    if (photoFile) {
      photoUrl = await uploadEmployeePhoto(photoFile);
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

  async updateEmployee(id: string, updates: Partial<Employee> & EmployeeBiometricWrite, photoFile?: File) {
    const finalUpdates = { ...updates };
    await ensureActiveSession();

    if (photoFile) {
      finalUpdates.photo_url = await uploadEmployeePhoto(photoFile, id);
    }

    const response = await fetch('/api/employees/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({ id, updates: finalUpdates, company_id: getStoredMasterCompanyId() })
    });

    const result = await readResponseJson<{ error?: string; employee?: Employee }>(response);

    if (!response.ok) {
      if (isDuplicateCpfIssue(result)) {
        throw new Error("Este CPF já está cadastrado em outro colaborador.");
      }
      throw new Error(result.error || 'Erro ao atualizar colaborador');
    }
    return result.employee as Employee;
  },

  async removeEmployeePhoto(id: string) {
    const response = await fetch('/api/employees/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify({ id, removePhoto: true, company_id: getStoredMasterCompanyId() })
    });

    const result = await readResponseJson<{ error?: string; employee?: Employee }>(response);
    if (!response.ok) throw new Error(result.error || 'Erro ao remover foto');
    return result.employee as Employee;
  },

  async deleteEmployeeBiometric(id: string, reason = "manual_deletion") {
    const response = await fetch(`/api/employees/${id}/biometric?reason=${encodeURIComponent(reason)}`, {
      method: 'DELETE',
      headers: await this.getAuthHeaders(),
    });

    const result = await readResponseJson<{ error?: string; success?: boolean }>(response);
    if (!response.ok) throw new Error(result.error || 'Erro ao remover dados biometricos');
    return result;
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
        .update({ active: false })
        .eq('id', employeeId)
    );
    
    if (error) throw error;

  },

  // --- EPIs ---
  async getPpes() {
    const companyId = await getCurrentCompanyId();
    let query = supabase.from('ppes').select('*').eq('active', true).order('name', { ascending: true });
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await withSessionRetry(() => query);
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
    const response = await fetchWithAuthRetry("/api/ppes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, updates, company_id: getStoredMasterCompanyId() }),
    });
    const result = await readResponseJson<{ error?: string; ppe?: PPE }>(response);

    if (!response.ok) throw new Error(result.error || "Erro ao atualizar EPI/CA.");
    return result.ppe as PPE;
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
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);

    const response = await fetchWithAuthRetry(`/api/stock-movements${params.size ? `?${params.toString()}` : ""}`);
    const result = await readResponseJson<{ error?: string; movements?: StockMovement[] }>(response);

    if (!response.ok) {
      throw new Error(result.error || "Erro ao carregar auditoria de estoque.");
    }

    return result.movements || [];
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
  async getDeliveries(options: { all?: boolean; limit?: number; offset?: number; signAssets?: boolean } = {}) {
    const companyId = await getCurrentCompanyId();
    const pageSize = options.all ? 1000 : Math.min(Math.max(options.limit || 500, 1), 1000);
    const rows: Record<string, unknown>[] = [];
    let from = Math.max(options.offset || 0, 0);

    while (true) {
      let query = supabase
        .from('deliveries')
        .select(`*, employee:employees(full_name, cpf, job_title, third_party_id), ppe:ppes(name, ca_number, ca_expiry_date, cost, lifespan_days), workplace:workplaces(name, third_party_id)`)
        .is('deleted_at', null)
        .order('delivery_date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (companyId) query = query.eq('company_id', companyId);
      const { data, error } = await withSessionRetry(() => query);
      if (error) throw error;

      const page = (data || []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      if (!options.all || page.length < pageSize) break;
      from += pageSize;
    }

    if (options.signAssets === false) return rows as unknown as DeliveryWithRelations[];
    return signStorageFields(rows, ["signature_url"]) as Promise<DeliveryWithRelations[]>;
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
        .is('deleted_at', null)
        .order('delivery_date', { ascending: false })
    );
    
    if (error) throw error;
    return signStorageFields((data || []) as unknown as Record<string, unknown>[], ["signature_url"]) as Promise<DeliveryWithRelations[]>;
  },

  async saveDelivery(delivery: Omit<Delivery, 'id' | 'created_at'>, signatureFile?: File) {
    let signatureUrl = null;
    await ensureActiveSession();
    const normalizedReason = getDeliveryReasonStorageVariants(delivery.reason)[0] as Delivery["reason"];

    if (signatureFile) {
      signatureUrl = await uploadDeliverySignature(signatureFile, delivery.employee_id, delivery.auth_method);
    }

    const payload = await withCompanyId({
      ...delivery,
      reason: normalizedReason,
      signature_url: signatureUrl,
      delivery_date: delivery.delivery_date || new Date().toISOString(),
      idempotency_key: crypto.randomUUID(),
    } as Record<string, unknown>);

    const response = await fetchWithAuthRetry("/api/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await readResponseJson<{ data?: Delivery; error?: string }>(response);
    if (!response.ok || !result.data) {
      throw new Error(result.error || "Falha ao salvar entrega.");
    }
    return result.data;
  },

  async deleteDelivery(deliveryId: string) {
    const companyId = await getCurrentCompanyId();
    const params = new URLSearchParams({ id: deliveryId });
    if (companyId) params.set("company_id", companyId);
    const storedMasterCompanyId = getStoredMasterCompanyId();
    if (!companyId && storedMasterCompanyId) params.set("company_id", storedMasterCompanyId);

    const response = await fetchWithAuthRetry(`/api/deliveries?${params.toString()}`, {
      method: "DELETE",
    });

    const result = await readResponseJson<{ error?: string; ok?: boolean; restored_quantity?: number }>(response);
    if (!response.ok) {
      throw new Error(result.error || "Erro ao excluir o registro da entrega.");
    }
    return result;
  },

  async returnDelivery(deliveryId: string, motive: string) {
    const response = await fetchWithAuthRetry("/api/deliveries/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryId, motive, company_id: getStoredMasterCompanyId() }),
    });
    const result = await readResponseJson<{ error?: string }>(response);
    if (!response.ok) throw new Error(result.error || "Erro ao devolver entrega.");
  },

  async returnDeliveryQuantity(deliveryId: string, motive: string, quantity: number) {
    if (quantity <= 0) return;

    const response = await fetchWithAuthRetry("/api/deliveries/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryId, motive, quantity, company_id: getStoredMasterCompanyId() }),
    });
    const result = await readResponseJson<{ error?: string }>(response);
    if (!response.ok) throw new Error(result.error || "Erro ao devolver entrega.");
  },

  async returnMultipleDeliveries(deliveryIds: string[], motive: string) {
    for (const deliveryId of deliveryIds) {
      await this.returnDelivery(deliveryId, motive);
    }
  },

  // --- Treinamentos ---
  async getTrainings() {
    const companyId = await getCurrentCompanyId();
    const storedMasterCompanyId = getStoredMasterCompanyId();
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);
    if (!companyId && storedMasterCompanyId) params.set("company_id", storedMasterCompanyId);

    const response = await fetchWithAuthRetry(`/api/trainings${params.size ? `?${params.toString()}` : ""}`);
    const result = await readResponseJson<{ error?: string; trainings?: TrainingWithRelations[] }>(response);
    if (!response.ok) throw new Error(result.error || "Erro ao carregar treinamentos.");
    return result.trainings || [];
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
