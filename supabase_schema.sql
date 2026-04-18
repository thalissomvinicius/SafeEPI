-- ==========================================
-- Sistema de Gestão de EPIs - Modelo Inicial
-- ==========================================

-- 1. Tabela de Colaboradores
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    job_title VARCHAR(100) NOT NULL,
    department VARCHAR(100),
    admission_date DATE NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Tabela de Equipamentos de Proteção Individual (EPI)
CREATE TABLE ppes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    manufacturer VARCHAR(100),
    ca_number VARCHAR(20) NOT NULL,
    ca_expiry_date DATE NOT NULL,
    lifespan_days INTEGER NOT NULL DEFAULT 30, -- Vida útil recomendada
    cost NUMERIC(10,2) DEFAULT 0.00,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Tabela de Entregas / Fichas de EPI
-- Obs: A URL da assinatura apontará para o arquivo no Storage do Supabase
CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    ppe_id UUID REFERENCES ppes(id) ON DELETE RESTRICT,
    delivery_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    reason VARCHAR(50) CHECK (reason IN ('Primeira Entrega', 'Substituição (Desgaste/Validade)', 'Perda', 'Dano')),
    quantity INTEGER DEFAULT 1,
    signature_url TEXT, -- Link para o PDF/Imagem da Ficha Assinada
    ip_address VARCHAR(45), -- Segurança/Auditoria
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- ==========================================
-- Configuração de RLS (Row Level Security)
-- ==========================================
-- Por enquanto, habilitamos mas deixamos aberto para acesso anônimo autenticado 
-- para focar na prototipação das telas. Em produção, você limitará por roles de usuário.

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppes ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura anon de colaboradores" ON employees FOR SELECT USING (true);
CREATE POLICY "Permitir inserção anon de colaboradores" ON employees FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir leitura anon de epis" ON ppes FOR SELECT USING (true);
CREATE POLICY "Permitir inserção anon de epis" ON ppes FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir leitura anon de entregas" ON deliveries FOR SELECT USING (true);
CREATE POLICY "Permitir inserção anon de entregas" ON deliveries FOR INSERT WITH CHECK (true);

-- Lembrete: Crie um bucket público no Supabase Storage chamado "ppe_signatures"
