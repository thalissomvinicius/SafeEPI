# SafeEPI

Sistema SaaS para gestao de EPIs, entregas, estoque, treinamentos e documentos de SESMT.

## Ambiente local

Crie um `.env.local` com:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Depois rode:

```bash
npm install
npm run dev
```

## Deploy

O deploy deve usar um projeto Vercel separado e apontar para o projeto Supabase SafeEPI.
