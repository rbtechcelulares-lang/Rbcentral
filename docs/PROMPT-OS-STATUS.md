# Prompt para o Claude Code do sistema de OS: avisar a Central em toda mudança de status

Abra o Claude Code no repositório do sistema de OS e cole o texto abaixo.

---

Quero que, toda vez que uma OS da minha loja mudar de status, o sistema avise o meu assistente
RB Central. A Central monta a mensagem de WhatsApp para o cliente ("em análise", "concluído", etc.)
e eu confirmo lá antes de ela sair.

**Importante:** este sistema é usado por vários lojistas. O aviso é **só para a minha loja**, a
mesma da variável `CENTRAL_LOJA` que a API `/api/central` já usa. OS de outras lojas nunca disparam
nada.

**O que fazer:**

1. Ache **todos** os lugares em que o status de uma OS muda: telas, a API `/api/central`
   (`PATCH /os/:id`), automações. O ideal é que exista uma função única de mudança de status. Se não
   existir, crie e use em todos esses lugares.
2. Quando o status de uma OS da loja `CENTRAL_LOJA` **mudar** (qualquer status novo), faça esta
   chamada:
   - `POST {CENTRAL_URL}/api/os-status`
   - Headers: `Authorization: Bearer {CENTRAL_API_TOKEN}` (a mesma chave que a API `/api/central`
     já usa) e `Content-Type: application/json`
   - Corpo: `{ "os_id": "<id da OS>" }`. Não mande telefone nem outros dados do cliente: a Central
     lê a OS pela API `/api/central/os/:id`.
3. Só dispare quando o status **muda**. Salvar a OS sem mudar o status não dispara.
4. **Não trave nada:** timeout de 8 segundos. Se a chamada falhar, só registre no log. A mudança de
   status continua valendo e não é desfeita.
5. A resposta da Central é `{ "pendente": true, "aviso": { ... } }` (o aviso está esperando a minha
   confirmação na Central) ou `{ "pendente": false, "motivo": "..." }`. Registre no log.
6. Crie a variável de ambiente `CENTRAL_URL` com o valor `https://rbcentral.vercel.app`.
7. No fim, me diga a lista **exata** de status usados na minha loja e em quais lugares do código o
   aviso foi ligado.
