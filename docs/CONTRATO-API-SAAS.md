# Contrato da API do sistema de OS para o RB Central

O RB Central chama estes endereços do sistema de OS. Todos ficam sob um endereço base
(ex.: `https://rbtechcelulares.reparosimples.com/api/central`) e usam JSON.

## Só a loja rbtechcelulares (o sistema tem vários lojistas)

Esta API existe só para a loja **rbtechcelulares**. Isso é garantido no servidor do sistema, não
por quem chama:

1. **A chave é presa a uma loja.** O token (`CENTRAL_API_TOKEN`) é ligado à loja `rbtechcelulares`
   no servidor (variável `CENTRAL_LOJA` = `rbtechcelulares`, ou o id interno dela). A loja **nunca**
   vem da URL, do corpo ou de um cabeçalho do pedido. Se aparecer um parâmetro de loja no pedido,
   ignore.
2. **Toda consulta filtra pela loja.** Listas, detalhes, relatórios, metas e pedidos de peças sempre
   têm `WHERE loja = CENTRAL_LOJA` (ou o equivalente com RLS). Nunca devolva dados agregados de
   várias lojas.
3. **Toda alteração confere o dono.** Antes de mudar status, registrar pagamento, avisar cliente
   ou mudar meta, confirme que o registro é da loja `CENTRAL_LOJA`. Se for de outra loja, ou se
   não existir, responda **404** `{"erro": "não encontrado"}`, sem dizer que existe em outra loja.
   O `UPDATE` também leva o filtro de loja, e não só o `SELECT` antes.
4. **Criar OS** grava sempre com a loja `CENTRAL_LOJA`.
5. **Toda resposta de sucesso** tem `"loja": "rbtechcelulares"` no nível de cima. Cada OS, meta e
   pedido devolvido também tem `"loja"`. O RB Central recusa qualquer resposta sem isso ou com
   outra loja.
6. **Se o banco usa a chave de serviço (que ignora o RLS):** os filtros acima são obrigatórios em
   todas as consultas, sem exceção. Prefira centralizar numa função única de acesso que já aplica a
   loja.

## Autenticação

Toda chamada vem com o cabeçalho `Authorization: Bearer <SAAS_API_TOKEN>`.

- O token é um texto longo e aleatório (40+ caracteres), guardado no sistema como variável de
  ambiente, nunca no código. É o mesmo valor configurado no RB Central.
- Token ausente ou errado: responda `401 {"erro": "não autorizado"}`. Compare em tempo constante.
- A API só mexe nos dados da loja `rbtechcelulares`.
- Erros: status 4xx/5xx com `{"erro": "mensagem curta em português"}`.

## Endereços

| Método | Caminho | Corpo / query | Resposta |
|---|---|---|---|
| GET | `/status` | — | `{ "status_os": ["Recebido", "Em análise", ...], "formas_pagamento": ["pix", "dinheiro", "cartão"] }` |
| GET | `/os` | `?status=&desde=AAAA-MM-DD&busca=&limite=30` | `{ "os": [OS, ...] }` |
| GET | `/os/:id` | `:id` = id ou número da OS | `{ "os": OS }` |
| POST | `/os` | `{ "cliente": {"nome", "whatsapp"}, "aparelho": {"marca", "modelo"}, "defeito", "relato", "valor": número ou null }` | `{ "os": OS }` |
| PATCH | `/os/:id` | `{ "status": "<um de status_os>" }` | `{ "os": OS }` |
| POST | `/os/:id/pagamento` | `{ "valor": número, "forma": "<uma de formas_pagamento>" }` | `{ "os": OS }` (com `pago: true`) |
| POST | `/os/:id/avisar` | `{ "mensagem": "texto" }` | `{ "enviado": true }` se o sistema enviou pelo WhatsApp dele, ou `{ "enviado": false, "link_whatsapp": "https://wa.me/55...?text=..." }` |
| GET | `/metas` | — | `{ "metas": [{ "id", "nome", "periodo", "valor_meta", "valor_atual" }] }` |
| PUT | `/metas/:id` | `{ "valor_meta": número }` | `{ "meta": {...} }` |
| GET | `/pedidos-pecas` | `?status=` | `{ "pedidos": [{ "id", "fornecedor", "peca", "os_numero", "quantidade", "valor", "status", "previsao", "criado_em" }] }` |
| GET | `/relatorio` | `?dia=AAAA-MM-DD` (Brasília) | `{ "dia", "os_abertas", "os_criadas_no_dia", "os_concluidas_no_dia", "faturamento_dia", "recebido_dia", "ticket_medio", "pedidos_pecas_pendentes", "metas": [...] }` |

**Aviso de mudança de status (sistema → Central):** quando o status de uma OS da loja
`CENTRAL_LOJA` **muda**, o sistema faz `POST {CENTRAL_URL}/api/os-status` com `Authorization: Bearer
<CENTRAL_API_TOKEN>` (a mesma chave) e corpo `{ "os_id": "<id da OS>" }`. A Central lê a OS de novo
por `GET /os/:id`, monta o aviso para o dono confirmar e responde `{ "pendente": true, "aviso" }` ou
`{ "pendente": false, "motivo" }`.

**Eventos (sistema → Central):** a cada venda, OS aberta, orçamento, mudança de status ou
follow-up da loja `CENTRAL_LOJA`, o sistema faz `POST {CENTRAL_URL}/api/evento` com a mesma chave e
o corpo `{ "loja", "tipo": "venda" | "os_criada" | "orcamento" | "status" | "follow_up", "id",
"cliente": { "nome", "whatsapp" }, "dados": { ... }, "mensagem"? }`. Os campos de `dados` de cada
tipo estão em `docs/PROMPT-EVENTOS.md`. A Central monta a mensagem para o dono confirmar e responde
`{ "pendente": true, "aviso" }` ou `{ "pendente": false, "motivo" }`.

**OS** = `{ "id", "loja", "numero", "cliente": {"nome", "whatsapp"}, "aparelho": {"marca", "modelo"}, "defeito", "relato", "status", "valor", "pago", "criado_em", "atualizado_em" }`

Exemplo: `GET /os?status=Pronto` → `{ "loja": "rbtechcelulares", "os": [{ "id": "…", "loja": "rbtechcelulares", "numero": 42, … }] }`

Os números de OS (`numero`) podem se repetir entre lojas. Ao buscar por número, procure só
dentro da loja `CENTRAL_LOJA`.

## Fora do contrato (não expor)

Configurações do sistema e da página pública, usuários e permissões, apagar OS, **qualquer dado
de outras lojas**, custos internos e chaves.
