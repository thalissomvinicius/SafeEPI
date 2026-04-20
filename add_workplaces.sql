-- 1. Criação da Tabela de Canteiros (Workplaces)
CREATE TABLE workplaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    address TEXT,
    manager_name VARCHAR(100),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Habilita RLS para Canteiros
ALTER TABLE workplaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir leitura anon de canteiros" ON workplaces FOR SELECT USING (true);
CREATE POLICY "Permitir inserção anon de canteiros" ON workplaces FOR INSERT WITH CHECK (true);

-- 3. Atualização das Tabelas Existentes
-- Adiciona vínculo de canteiro aos colaboradores
ALTER TABLE employees ADD COLUMN workplace_id UUID REFERENCES workplaces(id) ON DELETE SET NULL;

-- Adiciona vínculo de canteiro às entregas (facilita relatórios históricos caso o colaborador mude de obra)
ALTER TABLE deliveries ADD COLUMN workplace_id UUID REFERENCES workplaces(id) ON DELETE SET NULL;
