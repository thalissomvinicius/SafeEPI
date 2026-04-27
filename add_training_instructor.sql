-- Script para adicionar campos de instrutor e assinatura na tabela de treinamentos

ALTER TABLE public.trainings 
ADD COLUMN instructor_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
ADD COLUMN instructor_name TEXT,
ADD COLUMN instructor_role TEXT,
ADD COLUMN signature_url TEXT,
ADD COLUMN auth_method TEXT CHECK (auth_method IN ('manual', 'facial'));

-- Opcional: Atualizar a definição da tabela para o PostgREST caso necessário
NOTIFY pgrst, 'reload schema';
