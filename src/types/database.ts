export type Employee = {
  id: string;
  full_name: string;
  cpf: string;
  job_title: string;
  department: string | null;
  admission_date: string;
  active: boolean;
  workplace_id: string | null;
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
  created_at?: string;
  ppe?: {
    name: string;
  };
};

export type Delivery = {
  id: string;
  employee_id: string;
  ppe_id: string;
  delivery_date: string;
  reason: 'Primeira Entrega' | 'Substituição (Desgaste/Validade)' | 'Perda' | 'Dano';
  quantity: number;
  signature_url: string | null;
  ip_address: string | null;
  workplace_id: string | null;
  created_at?: string;
};

export type Training = {
  id: string;
  employee_id: string;
  training_name: string;
  completion_date: string;
  expiry_date: string;
  status: 'Válido' | 'Vencendo' | 'Vencido';
  created_at?: string;
};

export type DeliveryWithRelations = Delivery & {
  employee?: {
    full_name: string;
    cpf: string;
  };
  ppe?: {
    name: string;
    ca_number: string;
    cost?: number;
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
