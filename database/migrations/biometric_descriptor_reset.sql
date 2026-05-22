-- Migration para resetar as biometrias antigas e registrar o log de mudança
-- A migração para ArcFace/InsightFace server-side altera a dimensão do
-- face_descriptor legado de 128 para 512.

-- 1. Limpar os descritores antigos de todos os empregados
UPDATE employees
SET face_descriptor = NULL
WHERE face_descriptor IS NOT NULL;

-- 2. Adicionar um comentário na coluna explicando a nova dimensão
COMMENT ON COLUMN employees.face_descriptor IS 'Vetor biométrico JSONB legado de 512 dimensões (ArcFace/InsightFace server-side)';
