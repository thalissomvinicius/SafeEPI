# Guia de Configuração: Supabase (SafeEPI)

Siga estes passos para deixar o banco de dados pronto para o sistema:

### 1. Criar o Projeto
1. Acesse [supabase.com](https://supabase.com) e faça login.
2. Clique em **"New Project"**.
3. **Name:** `SafeEPI`
4. **Region:** Escolha `South America (São Paulo)` para menor latência.
5. **Database Password:** Crie uma senha forte e salve em local seguro.

### 2. Criar as Tabelas (SQL)
1. No menu lateral esquerdo, clique no ícone de "pincel" (**SQL Editor**).
2. Clique em **"New Query"**.
3. Abra seu projeto local e copie TODO o conteúdo do arquivo `supabase_schema.sql`.
4. Cole no editor do Supabase e clique em **"Run"**.
   - *Isso criará automaticamente as tabelas de Funcionários, EPIs e Entregas.*

### 3. Configurar Armazenamento (Storage)
1. No menu lateral, clique em **"Storage"** (balde).
2. Clique em **"New Bucket"**.
3. **Name:** `ppe_signatures`
4. **IMPORTANTE:** Marque como **"Public bucket"** para que o sistema possa gerar os links dos PDFs.

### 4. Pegar as Chaves de API
1. Clique no ícone de engrenagem (**Project Settings**) > **API**.
2. Copie os valores de:
   - **Project URL**
   - **anon (public) key**
3. Volte aqui e me envie essas chaves ou cole-as no seu arquivo `.env.local`!

---
**Próximo passo:** Assim que você terminar, estarei pronto para ligar os formulários ao banco de dados real.
