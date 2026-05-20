# Responsividade — SafeEPI

## Breakpoints

O projeto usa Tailwind CSS 4 com breakpoints padrao:

- `sm` (640px): pequenos ajustes de botao, grids e alinhamento.
- `md` (768px): troca principal entre mobile e desktop. Abaixo de `md`, tabelas viram cards e modais viram BottomSheet. Em `md+`, tabelas e dialogs desktop permanecem.
- `lg` (1024px): layouts de duas colunas, paineis auxiliares e grids mais amplos.
- `xl` (1280px): paineis laterais sticky e composicoes densas de dashboard/relatorios.
- `2xl` (1536px): largura maxima herdada dos containers existentes.

## Componentes criados

- `MobileTableCard` — usar sempre que uma tabela precisar sumir no mobile. Props: `title`, `subtitle`, `badge`, `fields`, `actions`, `expandable` e `leading`. Em mobile renderiza card `w-full`; em desktop nao renderiza.
- `BottomSheet` — usar em todos os modais. Props: `open`, `onClose`, `title`, `description`, `children`, `className`, `contentClassName`, `closeLabel` e `desktop`. Em mobile abre por baixo; em desktop pode manter dialog central ou painel lateral.

## Páginas revisadas

Revisao final em 2026-05-20:

- `dashboard`
- `history`
- `inventory`
- `employees`
- `movements`
- `ppes`
- `returns`
- `training`
- `reports`
- `third-parties`
- `companies`
- `users`
- `workplaces`
- `job-sectors`
- `account`
- `support`
- `unauthorized`

## Regras do projeto

- Toda tabela nova deve ter versao mobile com `MobileTableCard` e tabela desktop apenas em `md+`.
- Todo modal novo deve usar `BottomSheet`.
- Filtros no mobile ficam empilhados, `w-full`, com botoes de no minimo 44px de altura.
- Acoes principais em fluxos criticos usam `w-full` no mobile.
- Graficos devem usar largura fluida, container `w-full` e altura reduzida no mobile.
- Informacao importante nao deve usar `text-xs`.
- Campos numericos/documentos usam `inputMode="numeric"`; telefone usa `inputMode="tel"`; email usa `inputMode="email"`.
- Evitar largura fixa em px para cards, tabelas, formularios e charts.
- Nenhuma pagina deve depender de scroll horizontal em 360px.
- Arquivos revisados devem manter o cabecalho `// responsive: revisado — mobile-first ✓`.

## Como testar

1. Rode `npm run dev`.
2. Abra o app no navegador e ative o Device Toolbar.
3. Teste larguras de 360px, 375px, 390px, 768px e desktop.
4. Verifique se tabelas somem abaixo de `md` e cards aparecem.
5. Abra filtros, acordeoes, botoes de acao e modais em mobile.
6. Rode `npx tsc --noEmit`, `npm run lint` e `npm run build` antes de entregar.
