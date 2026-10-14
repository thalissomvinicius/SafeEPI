# Hospedagem gratuita do facial: decisão sem cartão

Consulta às fontes oficiais em 13/10/2026. Nenhuma conta ou recurso foi criado.

## Candidato atual (não publicado)

Como o requisito é **não depender do PC ligado** e **não usar cartão**, a opção
gratuita em avaliação para o piloto é **Render Free Web Service** com Docker.
O provedor declara que é possível começar sem cartão:
[informação oficial](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026).

O SafeEPI continua na Vercel e o banco continua no Supabase. Somente a inferência
facial ficaria fora, como um microserviço FastAPI HTTPS protegido por token Bearer.
O endereço é público; isso não equivale a rede privada. O serviço
não precisa acessar o banco e não deve gravar fotos/templates no filesystem.

Esta escolha é para **piloto funcional**, não para produção pesada. A documentação
oficial da Render diz que Free instances têm limitações e não devem ser usadas em
produção. Também documenta:

- Web services podem rodar de graça.
- O plano `free` tem **0.1 CPU / 512 MB RAM**.
- O serviço dorme após **15 minutos sem tráfego** e pode levar cerca de **1 minuto**
  para acordar.
- Cada workspace tem **750 Free instance hours** por mês.
- Se não houver método de pagamento e o uso incluído acabar, os serviços gratuitos
  são suspensos/desabilitados em vez de gerar cobrança suplementar.
- Free web services não têm disco persistente e podem reiniciar a qualquer momento.

Fontes:

- [Render Free](https://render.com/docs/free)
- [CPU e memória](https://render.com/docs/compute-plans)
- [Render Blueprint/plan/envVars](https://render.com/docs/blueprint-spec)
- [Render Docker](https://render.com/docs/docker)

## O que foi preparado no repositório

- `render.yaml`: blueprint do serviço `safeepi-biometric` em `plan: free`.
- `biometric_service/Dockerfile`: passa a respeitar `${PORT:-8001}` e limita
  concorrência por variável.
- `biometric_service/.dockerignore`: evita enviar ambientes locais, testes e
  artefatos privados de calibração/modelos.

Esses arquivos são preparação local. Não estão confirmados no GitHub nem houve
deploy no Render. O limite HTTP do Uvicorn é 8; o limite de inferência da aplicação
continua 1. Não usar limite HTTP 1: a conexão atual já o esgota e recebe 503.

No Render, o segredo `SAFE_EPI_BIOMETRIC_SERVICE_TOKEN` deve ser preenchido pelo
painel. O mesmo valor precisa ir na Vercel como `BIOMETRIC_SERVICE_TOKEN`, junto
com `BIOMETRIC_SERVICE_URL=https://<servico>.onrender.com`.

## Limitações que impactam o produto

O cold start pode deixar a primeira assinatura facial lenta ou falhar se o backend
esperar pouco tempo. O SafeEPI deve tratar isso como indisponibilidade temporária,
sem registrar assinatura facial falsa. Para uso em empresa grande, manter o fluxo
manual/photo como alternativa operacional.

Com 512 MB RAM e 0.1 CPU, precisamos validar:

1. build do Docker no Render (somente build local validado até aqui);
2. carregamento dos modelos YuNet/SFace;
3. memória de pico;
4. latência em captura real;
5. timeout do backend Vercel chamando o serviço após cold start.

O teste local em Linux com 512 MiB, sem swap e 0,1 CPU completou com pico RSS de
192,8 MiB, usando somente pixels sintéticos. Medições dessa execução: carga dos
modelos 35,8 s; detector em imagem vazia 2,2 s; extração sintética SFace 5,23 s;
carga mais inferência do PAD candidato 9,5 s. As importações/inicialização do
processo não estão incluídas no tempo de carga dos modelos.

Isso demonstra que esse smoke coube, **não** que fotos reais, servidor HTTP,
concorrência ou a operação de mil colaboradores cabem. A latência é um risco
concreto: o backend tem timeout limitado e uma retomada fria pode falhar. Antes
de integrar, validar disponibilidade/retentativa explícitas sem duplicar entrega.
Não criar pings artificiais para evitar a suspensão do plano gratuito.

Oracle foi descartada pelo usuário porque exige cartão, não é uma solução
automática se o Render não atender. Nenhuma opção gratuita sem cartão pesquisada
foi homologada para a operação crítica deste sistema.

## Opções descartadas para “sem cartão”

| Opção | Motivo |
| --- | --- |
| Hugging Face Spaces | A documentação atual diz que Static Spaces são grátis, mas Gradio/Docker em compute exigem plano pago para criar; ZeroGPU grátis vale para Gradio e não é bom encaixe para nosso FastAPI privado. Fonte: https://huggingface.co/docs/hub/spaces-overview |
| Oracle Always Free | Exige cartão e não atende à restrição explícita do usuário. [FAQ](https://www.oracle.com/cloud/free/faq/) |
| Cloud Run | Tem free tier, mas exige billing e pode cobrar fora da cota. Fonte: https://cloud.google.com/run/pricing |

## Passo operacional seguro

1. O usuário cria conta Render sem adicionar método de pagamento, se aceitar as
   limitações do piloto. Se o cadastro exigir cartão, parar sem contornar a regra.
2. Comparar a cópia local com o GitHub e publicar código/blueprint somente com
   autorização; esta pasta está sem `.git`. Não criar serviço com código antigo.
3. Criar somente Web Service gratuito e definir segredo aleatório forte em
   `SAFE_EPI_BIOMETRIC_SERVICE_TOKEN` pelo painel, nunca em chat/repositório.
4. Testar `/health` e chamadas sintéticas. HTTP 200 não significa PAD aprovado.
5. Após testes, preparar a Vercel, sem chaves públicas no navegador:
   - `BIOMETRIC_SERVICE_URL`
   - `BIOMETRIC_SERVICE_TOKEN`
6. Resolver revisão dos artefatos, calibração/PAD, privacidade, retenção e ensaios
   autorizados descritos no [roteiro de homologação](facial-validation-checklist.md).
7. Coordenar migração SQL, versão compatível e segredos adicionais, incluindo
   `BIOMETRIC_ENCRYPTION_KEY` e `CRON_SECRET`. Não aplicar SQL isolado com frontend
   legado. Liberar para clientes somente após aprovação do piloto e recuperação.

Não usar dados biométricos reais enquanto o serviço estiver sem validação de
latência, segurança, logs e política de privacidade.
