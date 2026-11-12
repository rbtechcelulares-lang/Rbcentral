# Prompt para rodar no Claude Code do sistema de OS

Abra o Claude Code no repositório do sistema de OS (reparosimples) e cole o texto abaixo.

---

Quero criar uma API para o meu assistente de gestão (RB Central) comandar este sistema.

**Importante:** este sistema é usado por vários lojistas. A API é **só para a minha loja**
(`rbtechcelulares`) e não pode ler nem alterar nada de outra loja, nem por engano, nem se alguém
mudar parâmetros do pedido. A regra está na seção "Só a loja rbtechcelulares" do contrato.

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
3. **Isolamento da loja (obrigatório):**
   - Crie a variável de ambiente `CENTRAL_LOJA` com a minha loja (descubra no banco qual é o
     identificador da loja `rbtechcelulares` e me diga).
   - A loja vem **só** dessa variável. Ignore qualquer loja enviada no pedido.
   - Faça uma única função de acesso aos dados da API que **sempre** aplica o filtro de loja. Use
     essa função em todas as rotas: SELECT, UPDATE e INSERT.
   - Registro de outra loja ou inexistente: responda 404 `{"erro": "não encontrado"}`.
   - Toda resposta leva `"loja": "rbtechcelulares"` no topo e em cada item, como está no contrato.
4. **Segurança:**
   - Autenticação por `Authorization: Bearer` com a variável de ambiente `CENTRAL_API_TOKEN`,
     comparada em tempo constante.
   - Nada de configurações, usuários, exclusões ou custos internos.
   - Valide as entradas: status e forma de pagamento só os valores de `/status`, valores
     numéricos maiores ou iguais a zero, textos com tamanho máximo.
   - Use a chave de serviço do banco só no servidor, nunca no navegador.
5. `/os/:id/avisar`: se o sistema já envia WhatsApp, envie e responda `{"enviado": true}`; se não,
   responda `{"enviado": false, "link_whatsapp": "https://wa.me/55<numero>?text=<mensagem>"}`.
6. `/relatorio`: calcule pelo dia de Brasília (UTC-3).
7. Registre cada alteração feita pela API (o que mudou, quando) no histórico/auditoria do sistema,
   se existir.
8. **Teste:** escreva testes para cada rota: token certo, token errado e dados inválidos.
   Inclua testes de **isolamento**:
   - com uma OS de **outra loja**, `GET /os/:id`, `PATCH`, `/pagamento` e `/avisar` respondem 404
     e não mudam nada;
   - `/os`, `/relatorio`, `/metas` e `/pedidos-pecas` nunca trazem itens de outra loja;
   - mandar `?loja=outra` ou `"loja": "outra"` no corpo não muda nada.

   Rode o lint e os testes do projeto e me mostre os resultados.
9. Faça o commit numa branch nova e me pergunte antes de fazer push ou deploy.

No fim, me diga o endereço base da API (ex.: `https://…/api/central`) e como eu gero e configuro
o `CENTRAL_API_TOKEN`.
