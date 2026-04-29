import { supabase } from "@/lib/supabase";
import { Employee, PPE, Delivery, Training, DeliveryWithRelations, TrainingWithRelations, Workplace, StockMovement, Profile, CatalogItem, SignedDocument } from "@/types/database";
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

const SESSION_REFRESH_BUFFER_SECONDS = 60;

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

async function insertStockOutMovement(ppeId: string, quantity: number, motive: string): Promise<void> {
  if (quantity <= 0) return;

  const firstTry = await withSessionRetry(() =>
    supabase
      .from("stock_movements")
      .insert([{
        ppe_id: ppeId,
        quantity,
        type: "SAIDA",
        motive,
        created_by_name: "Sistema (Entrega)",
      }])
      .select()
  );

  if (!firstTry.error) return;

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
        ppe_id: ppeId,
        quantity,
        type: "SAIDA",
        motive,
      }])
      .select()
  );

  if (fallbackTry.error) throw fallbackTry.error;
}

export const api = {
  async getAuthHeaders(): Promise<Record<string, string>> {
    const session = await ensureActiveSession();
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
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
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    return await ensureActiveSession();
  },

  async archiveSignedDocument(payload: SignedDocumentArchivePayload) {
    const formData = new FormData();
    const sha256Hash = payload.sha256Hash || await sha256Hex(payload.pdfBlob);

    formData.append("document_type", payload.documentType);
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
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from("signed_documents")
        .select("*")
        .order("created_at", { ascending: false })
    );

    if (error) {
      if (isMissingSignedDocumentsTableIssue(error)) return [] as SignedDocument[];
      throw error;
    }

    return data as SignedDocument[];
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
    const res = await fetch('/api/me', {
      headers: await this.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Nao foi possivel validar o perfil.");
    return data.user as Profile;
  },

  async getUsers() {
    const res = await fetch('/api/users', {
      headers: await this.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.users as (Profile & { email: string, created_at: string, last_sign_in_at: string })[];
  },

  async createUser(payload: { email: string, password?: string, full_name: string, role: string }) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async updateUser(payload: { id: string, password?: string, full_name?: string, role?: string }) {
    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async deleteUser(id: string) {
    const res = await fetch(`/api/users?id=${id}`, {
      method: 'DELETE',
      headers: await this.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async createRemoteLink(payload: {
    employee_id: string;
    type: 'capture' | 'delivery' | 'training_signature';
    data?: Record<string, unknown> | null;
    expires_hours?: number;
  }) {
    const res = await fetch('/api/remote-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getAuthHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data as { link: { token: string; status: string; expires_at: string } };
  },

  // --- Canteiros (Workplaces) ---
  async getWorkplaces() {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('workplaces')
        .select('*')
        .order('name', { ascending: true })
    );
    
    if (error) throw error;
    return data as Workplace[];
  },

  async addWorkplace(workplace: Omit<Workplace, 'id' | 'created_at'>) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('workplaces')
        .insert([workplace])
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
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('job_titles')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true })
    );

    if (error) {
      if (isMissingCatalogTableIssue(error)) return [] as CatalogItem[];
      throw error;
    }
    return data as CatalogItem[];
  },

  async addJobTitle(name: string) {
    const normalizedName = normalizeCatalogName(name);
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('job_titles')
        .insert([{ name: normalizedName, active: true }])
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
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('departments')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true })
    );

    if (error) {
      if (isMissingCatalogTableIssue(error)) return [] as CatalogItem[];
      throw error;
    }
    return data as CatalogItem[];
  },

  async addDepartment(name: string) {
    const normalizedName = normalizeCatalogName(name);
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('departments')
        .insert([{ name: normalizedName, active: true }])
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
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('employees')
        .select('*')
        .order('full_name', { ascending: true })
    );
    
    if (error) throw error;
    return data as Employee[];
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

    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('employees')
        .insert([{ ...employee, photo_url: photoUrl }])
        .select()
    );
    
    if (error) {
      if (isDuplicateCpfIssue(error)) {
        throw new Error("Este CPF já está cadastrado. Abra o cadastro existente para editar os dados do colaborador.");
      }
      throw error;
    }
    return data[0] as Employee;
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
      body: JSON.stringify({ id, updates: finalUpdates })
    });

    const result = await response.json();
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
      body: JSON.stringify({ id, removePhoto: true })
    });

    const result = await response.json();
    console.log('[removeEmployeePhoto] Server response:', result);

    if (!response.ok) throw new Error(result.error || 'Erro ao remover foto');
    return result.employee as Employee;
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
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('ppes')
        .select('*')
        .order('name', { ascending: true })
    );
    
    if (error) throw error;
    return data as PPE[];
  },

  async addPpe(ppe: Omit<PPE, 'id' | 'created_at'>) {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('ppes')
        .insert([ppe])
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

  // --- Estoque (Stock Movements) ---
  async getStockMovements() {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('stock_movements')
        .select(`
          *,
          ppe:ppes(name)
        `)
        .order('created_at', { ascending: false })
    );
    
    if (error) throw error;
    return data as StockMovement[];
  },

  async addStockMovement(movement: Omit<StockMovement, 'id' | 'created_at' | 'ppe'>) {
    // Insert the movement — the Supabase trigger fn_update_ppe_stock
    // automatically updates ppes.current_stock with SECURITY DEFINER (bypasses RLS)
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('stock_movements')
        .insert([movement])
        .select()
    )
    if (error) throw error
    return data[0] as StockMovement
  },

  // --- Entregas ---
  async getDeliveries() {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .select(`
          *,
          employee:employees(full_name, cpf, job_title),
          ppe:ppes(name, ca_number, ca_expiry_date, cost, lifespan_days),
          workplace:workplaces(name)
        `)
        .order('delivery_date', { ascending: false })
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
    const normalizedReason = normalizeDeliveryReason(delivery.reason);
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

    // 3. Salva o registro na tabela de entregas
    const insertPayload = {
      ...delivery,
      reason: normalizedReason,
      signature_url: signatureUrl,
      delivery_date: delivery.delivery_date || new Date().toISOString(),
    };

    const firstInsertResult = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .insert([insertPayload])
        .select()
    );

    if (!firstInsertResult.error && firstInsertResult.data?.[0]) {
      const stockAfterInsert = await getPpeCurrentStock(delivery.ppe_id);
      const desiredStock = stockBefore === null ? null : Math.max(0, stockBefore - delivery.quantity);

      // If delivery insert did not reduce stock (missing trigger/misconfig), compensate via stock movement.
      if (desiredStock !== null && stockAfterInsert !== null && stockAfterInsert > desiredStock) {
        const missingOut = stockAfterInsert - desiredStock;
        await insertStockOutMovement(delivery.ppe_id, missingOut, `Entrega de EPI (${normalizedReason})`);
      }

      return firstInsertResult.data[0];
    }

    let insertError = firstInsertResult.error;

    if (isDeliverySchemaCompatibilityIssue(insertError)) {
      const fallbackPayload = {
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
        const stockAfterInsert = await getPpeCurrentStock(delivery.ppe_id);
        const desiredStock = stockBefore === null ? null : Math.max(0, stockBefore - delivery.quantity);

        if (desiredStock !== null && stockAfterInsert !== null && stockAfterInsert > desiredStock) {
          const missingOut = stockAfterInsert - desiredStock;
          await insertStockOutMovement(delivery.ppe_id, missingOut, `Entrega de EPI (${normalizedReason})`);
        }

        return fallbackResult.data[0];
      }

      insertError = fallbackResult.error;
    }

    if (isDeliveryReasonConstraintIssue(insertError)) {
      throw new Error(
        "Falha ao salvar entrega por incompatibilidade de motivo no banco. Verifique o CHECK da coluna reason na tabela deliveries."
      );
    }

    throw insertError || new Error("Falha ao salvar entrega no Supabase.");
  },

  async returnDelivery(deliveryId: string, motive: string) {
    const { error } = await withSessionRetry(() =>
      supabase
        .from('deliveries')
        .update({ returned_at: new Date().toISOString(), return_motive: motive })
        .eq('id', deliveryId)
    );

    if (!error) return;

    if (isMissingDeliveryReturnMotiveIssue(error)) {
      const { error: fallbackError } = await withSessionRetry(() =>
        supabase
          .from('deliveries')
          .update({ returned_at: new Date().toISOString() })
          .eq('id', deliveryId)
      );

      if (!fallbackError) return;

      throw fallbackError;
    }

    throw error;
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
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('trainings')
        .select(`
          *,
          employee:employees!trainings_employee_id_fkey(full_name, cpf)
        `)
        .order('completion_date', { ascending: false })
    );
    
    if (error) throw error;
    return data as TrainingWithRelations[];
  },

  async addTraining(training: Omit<Training, 'id' | 'created_at'>): Promise<AddTrainingResult> {
    const { data, error } = await withSessionRetry(() =>
      supabase
        .from('trainings')
        .insert([training])
        .select()
    );

    if (!error) {
      return { training: data[0] as Training };
    }

    const message = error.message || "";
    const isTrainingSchemaIssue =
      message.includes("schema cache") ||
      message.includes("instructor_id") ||
      message.includes("instructor_name") ||
      message.includes("instructor_role") ||
      message.includes("signature_url") ||
      message.includes("auth_method");

    if (!isTrainingSchemaIssue) {
      throw error;
    }

    const fallbackTraining = {
      employee_id: training.employee_id,
      training_name: training.training_name,
      completion_date: training.completion_date,
      expiry_date: training.expiry_date,
      status: training.status,
    };

    const { data: fallbackData, error: fallbackError } = await withSessionRetry(() =>
      supabase
        .from('trainings')
        .insert([fallbackTraining])
        .select()
    );

    if (fallbackError) {
      throw new Error(
        "A tabela 'trainings' do Supabase ainda não está pronta para instrutor/assinatura. Rode o script add_training_instructor.sql e recarregue o schema do PostgREST."
      );
    }

    return {
      training: fallbackData[0] as Training,
      warning:
        "Treinamento salvo sem dados de instrutor/assinatura. Rode o script add_training_instructor.sql no Supabase para habilitar certificado completo.",
    };
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
