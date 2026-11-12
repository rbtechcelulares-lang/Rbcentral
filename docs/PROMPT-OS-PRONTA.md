# Prompt para o Claude Code do sistema de OS: avisar a Central quando a OS ficar pronta

Abra o Claude Code no repositório do sistema de OS e cole o texto abaixo.

---

Quero que, quando uma OS da minha loja ficar pronta, o sistema avise o meu assistente RB Central,
que manda o WhatsApp de "pronto para retirada" para o cliente.

**Importante:** este sistema é usado por vários lojistas. O aviso é **só para a minha loja**, a
mesma da variável `CENTRAL_LOJA` que a API `/api/central` já usa. OS de outras lojas nunca disparam
nada.

**O que fazer:**

1. Ache **todos** os lugares em que o status de uma OS muda: telas, a API `/api/central`
   (`PATCH /os/:id`), automações. O ideal é que exista uma função única de mudança de status. Se não
   existir, crie e use em todos esses lugares.
2. Quando o status **mudar** para o status de pronta (o que significa "pronto para retirada"), e a OS
   for da loja `CENTRAL_LOJA`, faça esta chamada:
   - `POST {CENTRAL_URL}/api/os-pronta`
   - Headers: `Authorization: Bearer {CENTRAL_API_TOKEN}` (a mesma chave que a API `/api/central`
     já usa) e `Content-Type: application/json`
   - Corpo: `{ "os_id": "<id da OS>" }`. Não mande telefone nem outros dados do cliente: a Central
     lê a OS pela API `/api/central/os/:id`.
3. Só dispare quando o status **muda** para pronta. Salvar de novo uma OS que já estava pronta não
   dispara.
4. **Não trave nada:** timeout de 8 segundos. Se a chamada falhar, só registre no log. A mudança de
   status continua valendo e não é desfeita.
5. A resposta da Central é `{ "enviado": true, "para", "mensagem" }` ou
   `{ "enviado": false, "motivo" }`. Se `enviado` for `true`, registre no histórico da OS:
   "Cliente avisado pelo WhatsApp (RB Central)". Se for `false`, registre o `motivo`.
6. Crie a variável de ambiente `CENTRAL_URL` com o valor `https://rbcentral.vercel.app`.
7. No fim, me diga:
   - o nome **exato** do status de pronta usado na minha loja (a Central precisa saber);
   - em quais lugares do código o aviso foi ligado.
