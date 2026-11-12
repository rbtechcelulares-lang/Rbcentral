# Prompt para rodar no Claude Code do sistema de OS

Abra o Claude Code no repositório do sistema de OS (reparosimples) e cole o texto abaixo.

---

Quero criar uma API para o meu assistente de gestão (RB Central) comandar este sistema.

**Contrato:** siga exatamente o contrato abaixo. Os nomes dos campos e o formato das respostas
precisam ser estes, porque o outro lado já está pronto.

[COLE AQUI O CONTEÚDO DO ARQUIVO docs/CONTRATO-API-SAAS.md DO REPOSITÓRIO rbcentral]

**Como fazer:**

1. Leia o projeto antes de mudar algo: rotas/API existentes, o banco (Supabase), as tabelas de
   OS, clientes, pagamentos, metas, pedidos de peças, e como o sistema já avisa clientes pelo
   WhatsApp.
2. Crie as rotas sob `/api/central`, usando as funções e tabelas que o sistema já tem (não
   duplique regras de negócio). Se algum campo do contrato não existir no banco, me diga qual,
   em vez de inventar.
3. **Segurança:**
   - Autenticação por `Authorization: Bearer` com a variável de ambiente `CENTRAL_API_TOKEN`,
     comparada em tempo constante.
   - Só dados da loja `rbtechcelulares`.
   - Nada de configurações, usuários, exclusões ou custos internos.
   - Valide as entradas: status e forma de pagamento só os valores de `/status`, valores
     numéricos maiores ou iguais a zero, textos com tamanho máximo.
   - Use a chave de serviço do banco só no servidor, nunca no navegador.
4. `/os/:id/avisar`: se o sistema já envia WhatsApp, envie e responda `{"enviado": true}`; se não,
   responda `{"enviado": false, "link_whatsapp": "https://wa.me/55<numero>?text=<mensagem>"}`.
5. `/relatorio`: calcule pelo dia de Brasília (UTC-3).
6. Registre cada alteração feita pela API (o que mudou, quando) no histórico/auditoria do sistema,
   se existir.
7. **Teste:** escreva testes ou um roteiro com `curl` para cada rota (token certo, token errado,
   dados inválidos), rode o lint e os testes do projeto e me mostre os resultados.
8. Faça o commit numa branch nova e me pergunte antes de fazer push ou deploy.

No fim, me diga o endereço base da API (ex.: `https://…/api/central`) e como eu gero e configuro
o `CENTRAL_API_TOKEN`.
