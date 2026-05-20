# Guia de contribuição

Este projeto cuida de dados sensíveis: CPF, assinatura, biometria, documentos de NR-06 e histórico de entrega de EPI.

Trate cada alteração como se ela pudesse aparecer em uma fiscalização.

## Rodando local

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Variáveis mínimas:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Antes de abrir PR ou subir alteração:

```bash
npm audit
npm run build
```

## Convenções de código

- Use TypeScript com tipos explícitos quando o dado vier de API, banco ou formulário.
- Valide entrada de API com Zod usando `src/lib/validateBody.ts`.
- Valide uploads por magic bytes usando `src/lib/validateUpload.ts`.
- Use helpers existentes antes de criar outro caminho paralelo.
- Mantenha mensagens de erro públicas genéricas. O detalhe real vai para `console.error`.
- Para arquivos privados, gere signed URL server-side.
- Preserve o padrão visual do sistema: interface densa, clara e voltada a operação.

## Segurança

Não faça:

- Não commitar `.env`, chaves, dumps ou tokens.
- Não usar `getPublicUrl()` para assinatura, PDF, foto, evidência ou documento.
- Não criar rota sem autenticação quando ela toca dados do sistema.
- Não devolver `error.message`, `error.code` ou `error.details` do Supabase para o cliente.
- Não criar policy RLS com `using (true)` em tabela sensível.
- Não aceitar upload confiando só em `Content-Type` ou extensão.
- Não acessar dados de outra empresa sem checagem explícita de tenant.

## Banco de dados

Migrations ficam em `database/migrations/`.

A ordem e os cuidados de aplicação ficam em `docs/database.md`.
