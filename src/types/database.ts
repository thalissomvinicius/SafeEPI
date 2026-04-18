export type Employee = {
  id: string;
  full_name: string;
  cpf: string;
  job_title: string;
  department: string | null;
  admission_date: string;
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
  created_at?: string;
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
  created_at?: string;
};
