# 🦺 SafeEPI

> Porque ficha de EPI em papel some. Processo trabalhista, não.

![Vercel](https://img.shields.io/badge/deploy-Vercel-000?style=for-the-badge&logo=vercel)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000?style=for-the-badge&logo=nextdotjs)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=0b1f17)

🔗 **[Ver demonstração ao vivo →](https://safeepi-pi.vercel.app)**

---

O fiscal chega. A pasta não.

A NR-06 pede prova. O papel tem rabisco, café seco e uma assinatura que ninguém reconhece.

O colaborador jura que recebeu. A empresa jura que entregou. No meio disso, alguém precisa provar.

SafeEPI nasceu para esse dia. O dia em que “depois eu acho a ficha” vira prejuízo.

---

## O Produto

🖊️ **Entrega com evidência real**  
Cada EPI entregue vira registro com assinatura, biometria facial, IP, geolocalização e data. O PDF nasce pronto para arquivo, auditoria e aquela conversa que ninguém queria ter.

📡 **Operação remota**  
O campo assina por link seguro, com token único e prazo curto. Não precisa chamar o almoxarifado, abrir o computador principal ou fazer malabarismo com foto no WhatsApp.

🏢 **Multiempresa desde o início**  
Cada empresa enxerga só o que é dela. RLS, tenant e permissões existem porque dado de colaborador não é panfleto.

| Módulo | O que registra |
|--------|---------------|
| Entregas | EPI, CA, quantidade, motivo, assinatura, biometria, IP, local e PDF |
| Devoluções | Baixa total ou parcial, motivo, data e reflexo no estoque |
| Treinamentos | Participante, validade, carga horária, certificado e assinatura |
| Documentos assinados | PDFs, hashes, evidências, metadados e trilha de arquivo |
| Estoque | Entradas, saídas, ajustes, saldo, custo e alerta de baixo estoque |
| Terceiros | Tomadores, vínculo com colaboradores, obras, custos e cobranças |
| Captura remota | Foto facial, descritor biométrico e validação por token |

---

## Feito Com

Cada ferramenta escolhida por um motivo.

| | Tecnologia | Por quê |
|---|---|---|
| ⚡ | Next.js 16 + TypeScript | Tela rápida, API no mesmo projeto e menos espaço para erro bobo |
| 🗄️ | Supabase | Auth, Postgres, RLS e Storage no lugar certo |
| 🎨 | Tailwind + shadcn/ui | Interface firme para rotina de SESMT, sem carnaval visual |
| 🤖 | FastAPI + InsightFace | Biometria facial server-side, sem IA pesada no navegador |
| 📄 | jsPDF | PDF auditável na hora, sem depender de editor externo |
| 🔒 | Zod + lru-cache | Entrada validada e abuso segurado antes de bater no banco |

---

## 🔐 Segurança

Dados de colaboradores merecem tratamento sério.

✅ Bucket privado — signed URLs com expiração curta  
✅ RLS ativo em 100% das tabelas  
✅ Middleware server-side com verificação real de sessão  
✅ Rate limiting em todas as rotas críticas  
✅ CSP com nonce por request  
✅ Uploads validados por magic bytes  
✅ Zero vulnerabilidades (`npm audit`)

> Veja [SECURITY.md](./SECURITY.md) para detalhes completos.

---

## Status Do Projeto

Honesto. Sem fumaça.

**O que está funcionando:**

- [x] Login com Supabase Auth
- [x] Gestão multiempresa com isolamento por tenant
- [x] Cadastro de colaboradores, cargos, setores e obras
- [x] Cadastro de EPIs e CAs
- [x] Entrega de EPI com assinatura manual ou facial
- [x] Links remotos para assinatura e captura biométrica
- [x] Estoque com entrada, saída, ajuste e baixa por entrega
- [x] Devolução total e parcial
- [x] Terceiros/tomadores com relatório de cobrança
- [x] Treinamentos e certificados
- [x] PDFs de entrega, NR-06, movimentações, estoque e treinamentos
- [x] Exportação Excel
- [x] Auditoria de documentos assinados
- [x] Hardening de segurança: RLS, CSP, rate limiting, upload seguro e Zod

**Em evolução:**

- [ ] Lapidar todos os PDFs para um padrão visual único
- [ ] Refinar indicadores por período no dashboard
- [ ] Ampliar testes automatizados de policies RLS
- [ ] Melhorar a instalação guiada das migrations
- [ ] Revisar UX fina em telas densas de operação

---

## Rodando Local

```bash
git clone https://github.com/thalissomvinicius/SafeEPI
cd SafeEPI
npm install
cp .env.local.example .env.local
npm run dev
```

Configure as variáveis em `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Migrations em `/database/migrations/` — ordem documentada em [`docs/database.md`](./docs/database.md).

---

Construído por [@thalissomvinicius](https://github.com/thalissomvinicius) — porque segurança do trabalho merece software de verdade.
