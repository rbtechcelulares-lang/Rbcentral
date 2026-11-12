# Contrato da API do sistema de OS para o RB Central

O RB Central chama estes endereços do sistema de OS. Todos ficam sob um endereço base
(ex.: `https://rbtechcelulares.reparosimples.com/api/central`) e usam JSON.

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

**OS** = `{ "id", "numero", "cliente": {"nome", "whatsapp"}, "aparelho": {"marca", "modelo"}, "defeito", "relato", "status", "valor", "pago", "criado_em", "atualizado_em" }`

## Fora do contrato (não expor)

Configurações do sistema e da página pública, usuários e permissões, apagar OS, dados de
outras lojas, custos internos e chaves.
