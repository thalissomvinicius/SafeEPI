-- Adiciona colunas para controle de devolução nas entregas
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS return_motive VARCHAR(150);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;

-- Atualiza a tabela employees para suportar o status 'Desligado'
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date TIMESTAMP WITH TIME ZONE;

-- Permite os novos campos nas políticas de RLS de Deliveries
DROP POLICY IF EXISTS "Permitir update anon de entregas" ON deliveries;
CREATE POLICY "Permitir update anon de entregas" ON deliveries FOR UPDATE USING (true) WITH CHECK (true);
