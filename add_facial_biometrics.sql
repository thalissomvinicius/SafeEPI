-- Adiciona suporte a Biometria Facial na tabela de Colaboradores
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS face_descriptor JSONB;

-- Comentários para o Supabase
COMMENT ON COLUMN employees.photo_url IS 'URL da foto mestra do rosto do colaborador para validação biométrica';
COMMENT ON COLUMN employees.face_descriptor IS 'Vetor matemático (Float32Array) extraído da foto mestra usado para comparar a similaridade facial';
