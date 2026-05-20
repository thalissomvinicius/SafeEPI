-- ==========================================
-- Atualização: Tabela de Treinamentos (NR-01/NR-06)
-- Rode este script no SQL Editor do seu Supabase
-- ==========================================

CREATE TABLE trainings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    training_name VARCHAR(150) NOT NULL,
    completion_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'Válido' CHECK (status IN ('Válido', 'Vencendo', 'Vencido')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura anon de treinamentos" ON trainings FOR SELECT USING (true);
CREATE POLICY "Permitir inserção anon de treinamentos" ON trainings FOR INSERT WITH CHECK (true);
