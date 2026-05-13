-- =============================================================================
-- SafeEPI :: vincular stock_movements -> deliveries
-- =============================================================================
-- Objetivo:
--   1. Permitir saber, sem heuristica, qual entrega gerou cada movimentacao
--      de estoque (SAIDA compensatoria, ENTRADA de devolucao, baixa parcial).
--   2. Quando o MASTER excluir uma entrega no app, todas as movimentacoes
--      ligadas a ela sumem automaticamente (ON DELETE CASCADE).
--
-- Seguranca:
--   * Operacoes puramente aditivas. Nada e apagado, nada e renomeado.
--   * A coluna nasce NULLABLE. Linhas antigas continuam validas (NULL).
--   * O FK e adicionado com NOT VALID e depois validado em separado, para
--     evitar locks pesados em tabelas grandes.
--   * Antes da migracao, criamos um SNAPSHOT (tabela de backup) so para
--     redundancia, alem do backup oficial do Supabase Dashboard.
--
-- Rode no Supabase: SQL Editor -> cole tudo -> Run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Snapshot de seguranca (timestamp UTC no nome para nao colidir).
--    Voce pode dropar essa tabela depois de validar que esta tudo ok.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    backup_name text := 'stock_movements_backup_' ||
        to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD_HH24MISS');
BEGIN
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I AS TABLE stock_movements', backup_name);
    RAISE NOTICE 'Snapshot criado: %', backup_name;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Adiciona coluna delivery_id (nullable).
--    Operacao de metadado em Postgres moderno: nao reescreve a tabela.
-- -----------------------------------------------------------------------------
ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS delivery_id uuid;

COMMENT ON COLUMN stock_movements.delivery_id IS
    'Entrega que gerou esta movimentacao. NULL para movimentacoes manuais '
    '(ajustes de estoque, ENTRADA de compra, etc).';

-- -----------------------------------------------------------------------------
-- 2. Indice para lookups e cascade rapidos.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stock_movements_delivery_id
    ON stock_movements (delivery_id);

-- -----------------------------------------------------------------------------
-- 3. FK com ON DELETE CASCADE.
--    Quando uma delivery for apagada, as movimentacoes vinculadas (e que
--    tiverem delivery_id preenchido) somem automaticamente.
--    Adicionada como NOT VALID para nao bloquear a tabela; em seguida
--    validamos no proximo passo, sem lock pesado.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'stock_movements_delivery_id_fkey'
    ) THEN
        ALTER TABLE stock_movements
            ADD CONSTRAINT stock_movements_delivery_id_fkey
            FOREIGN KEY (delivery_id)
            REFERENCES deliveries (id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

-- Valida em uma passagem sem AccessExclusiveLock global.
ALTER TABLE stock_movements
    VALIDATE CONSTRAINT stock_movements_delivery_id_fkey;

-- -----------------------------------------------------------------------------
-- 4. Backfill heuristico (somente onde delivery_id ainda esta NULL).
--    Usa os mesmos padroes de motivo que o codigo JS gera hoje.
--    Janela temporal: ate 15 minutos entre a criacao da entrega e a
--    movimentacao. Casamento extra por ppe_id + company_id.
-- -----------------------------------------------------------------------------

-- 4a. SAIDA compensatoria (caso o trigger de delivery nao tenha rodado).
--     Motivos esperados: "Entrega de EPI (...)" ou "Baixa automatica ..."
WITH candidates AS (
    SELECT
        sm.id  AS movement_id,
        d.id   AS delivery_id,
        ROW_NUMBER() OVER (
            PARTITION BY sm.id
            ORDER BY ABS(EXTRACT(EPOCH FROM (sm.created_at - d.created_at)))
        ) AS rn
    FROM stock_movements sm
    JOIN deliveries d
        ON d.ppe_id = sm.ppe_id
       AND COALESCE(d.company_id::text, '') = COALESCE(sm.company_id::text, '')
       AND d.quantity = sm.quantity
       AND sm.created_at BETWEEN d.created_at - INTERVAL '15 minutes'
                             AND d.created_at + INTERVAL '15 minutes'
    WHERE sm.delivery_id IS NULL
      AND sm.type = 'SAIDA'
      AND (
            lower(coalesce(sm.motive, '')) LIKE '%entrega de epi%'
         OR lower(coalesce(sm.motive, '')) LIKE '%baixa automatica%'
         OR lower(coalesce(sm.motive, '')) LIKE '%baixa automática%'
          )
)
UPDATE stock_movements sm
SET delivery_id = c.delivery_id
FROM candidates c
WHERE sm.id = c.movement_id
  AND c.rn = 1;

-- 4b. ENTRADAs geradas por devolucao desta entrega.
--     Motivos esperados: "Devolucao de EPI (...)", "Devolução de EPI (...)",
--     "Baixa parcial por substituicao (...)".
WITH candidates AS (
    SELECT
        sm.id  AS movement_id,
        d.id   AS delivery_id,
        ROW_NUMBER() OVER (
            PARTITION BY sm.id
            ORDER BY ABS(EXTRACT(EPOCH FROM (sm.created_at - d.delivery_date)))
        ) AS rn
    FROM stock_movements sm
    JOIN deliveries d
        ON d.ppe_id = sm.ppe_id
       AND COALESCE(d.company_id::text, '') = COALESCE(sm.company_id::text, '')
       AND sm.created_at >= d.delivery_date
       AND (d.returned_at IS NOT NULL OR COALESCE(d.returned_quantity, 0) > 0)
    WHERE sm.delivery_id IS NULL
      AND sm.type = 'ENTRADA'
      AND (
            lower(coalesce(sm.motive, '')) LIKE '%devolucao de epi%'
         OR lower(coalesce(sm.motive, '')) LIKE '%devolução de epi%'
         OR lower(coalesce(sm.motive, '')) LIKE '%baixa parcial por substituicao%'
         OR lower(coalesce(sm.motive, '')) LIKE '%baixa parcial por substituição%'
          )
)
UPDATE stock_movements sm
SET delivery_id = c.delivery_id
FROM candidates c
WHERE sm.id = c.movement_id
  AND c.rn = 1;

COMMIT;

-- =============================================================================
-- Pos-migracao (opcional, rodar separadamente quando quiser):
--
-- 1. Conferir quantas movimentacoes ficaram vinculadas vs nao vinculadas:
--      SELECT type,
--             COUNT(*) FILTER (WHERE delivery_id IS NOT NULL) AS com_entrega,
--             COUNT(*) FILTER (WHERE delivery_id IS NULL)     AS sem_entrega
--      FROM stock_movements
--      GROUP BY type;
--
-- 2. Conferir o snapshot criado:
--      SELECT relname FROM pg_class
--      WHERE relname LIKE 'stock_movements_backup_%';
--
-- 3. Quando estiver tudo certo, dropar os snapshots antigos:
--      DROP TABLE stock_movements_backup_YYYYMMDD_HHMMSS;
-- =============================================================================
