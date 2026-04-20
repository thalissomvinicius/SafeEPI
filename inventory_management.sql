-- 1. Adiciona coluna de estoque na tabela de EPIs
ALTER TABLE ppes ADD COLUMN current_stock INTEGER DEFAULT 0;

-- 2. Tabela de Histórico de Movimentações (Entradas/Ajustes)
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ppe_id UUID REFERENCES ppes(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    type VARCHAR(20) CHECK (type IN ('ENTRADA', 'SAIDA', 'AJUSTE')),
    motive TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Habilita RLS para Movimentações
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir leitura anon de estoque" ON stock_movements FOR SELECT USING (true);
CREATE POLICY "Permitir inserção anon de estoque" ON stock_movements FOR INSERT WITH CHECK (true);

-- 4. Função e Trigger para REDUÇÃO AUTOMÁTICA de estoque na entrega
CREATE OR REPLACE FUNCTION handle_delivery_stock_reduction()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE ppes
    SET current_stock = GREATEST(0, current_stock - NEW.quantity)
    WHERE id = NEW.ppe_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_reduce_stock_on_delivery
AFTER INSERT ON deliveries
FOR EACH ROW
EXECUTE FUNCTION handle_delivery_stock_reduction();

-- 5. Função e Trigger para ATUALIZAÇÃO de estoque na entrada manual (stock_movements)
CREATE OR REPLACE FUNCTION handle_manual_stock_adjustment()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.type = 'ENTRADA') THEN
        UPDATE ppes SET current_stock = current_stock + NEW.quantity WHERE id = NEW.ppe_id;
    ELSIF (NEW.type = 'SAIDA') THEN
        UPDATE ppes SET current_stock = GREATEST(0, current_stock - NEW.quantity) WHERE id = NEW.ppe_id;
    ELSIF (NEW.type = 'AJUSTE') THEN
        UPDATE ppes SET current_stock = NEW.quantity WHERE id = NEW.ppe_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ppe_stock_on_movement
AFTER INSERT ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION handle_manual_stock_adjustment();
