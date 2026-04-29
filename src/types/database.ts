export type Employee = {
  id: string;
  full_name: string;
  cpf: string;
  job_title: string;
  department: string | null;
  admission_date: string;
  active: boolean;
  workplace_id: string | null;
  termination_date?: string | null;
  photo_url?: string | null;
  face_descriptor?: number[] | null; // Armazenado como JSONB
  created_at?: string;
};

export type Workplace = {
  id: string;
  name: string;
  address: string | null;
  manager_name: string | null;
  active: boolean;
  created_at?: string;
};

export type CatalogItem = {
  id: string;
  name: string;
  active: boolean;
  created_at?: string;
};

export type PPE = {
  id: string;
  name: string;
  manufacturer: string | null;
  ca_number: string;
  ca_expiry_date: string;
  lifespan_days: number;
  cost: number;
  active: boolean;
  current_stock: number;
  created_at?: string;
};

export type StockMovement = {
  id: string;
  ppe_id: string;
  quantity: number;
  type: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
  motive: string | null;
  created_by_id?: string | null;
  created_by_name?: string | null;
  created_at?: string;
  ppe?: { name: string };
};

export type Delivery = {
  id: string;
  employee_id: string;
  ppe_id: string;
  delivery_date: string;
  reason: 'Primeira Entrega' | 'Substituição (Desgaste/Validade)' | 'Perda' | 'Dano';
  quantity: number;
  signature_url: string | null;
  auth_method?: 'manual' | 'facial' | 'manual_facial';
  ip_address: string | null;
  workplace_id: string | null;
  returned_at?: string | null;
  return_motive?: string | null;
  created_at?: string;
};

export type Training = {
  id: string;
  employee_id: string;
  training_name: string;
  completion_date: string;
  expiry_date: string;
  status: 'Válido' | 'Vencendo' | 'Vencido';
  instructor_id?: string | null;
  instructor_name?: string | null;
  instructor_role?: string | null;
  signature_url?: string | null;
  auth_method?: 'manual' | 'facial' | 'manual_facial' | null;
  created_at?: string;
};

export type DeliveryWithRelations = Delivery & {
  employee?: {
    full_name: string;
    cpf: string;
    job_title?: string;
  };
  ppe?: {
    name: string;
    ca_number: string;
    ca_expiry_date?: string;
    cost?: number;
    lifespan_days?: number;
  };
  workplace?: {
    name: string;
  };
};

export type TrainingWithRelations = Training & {
  employee?: {
    full_name: string;
    cpf: string;
  };
};

export type SignedDocument = {
  id: string;
  document_type: 'delivery' | 'remote_delivery' | 'return' | 'nr06' | 'training_certificate';
  employee_id: string | null;
  delivery_id: string | null;
  delivery_ids: string[] | null;
  training_id: string | null;
  file_name: string;
  document_url: string;
  storage_path: string;
  sha256_hash: string;
  auth_method: string | null;
  signature_url: string | null;
  photo_evidence_url: string | null;
  ip_address: string | null;
  geo_location: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'ADMIN' | 'ALMOXARIFE' | 'DIRETORIA';
  created_at?: string;
};
