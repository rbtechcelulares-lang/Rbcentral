# Prompt para o Claude Code do sistema de OS: editar OS pela RB Central

Abra o Claude Code no repositório do sistema de OS (Reparo Simples) e cole o texto abaixo.

---

Quero que o meu assistente RB Central também edite as ordens de serviço (corrigir nome ou WhatsApp do
cliente, aparelho, defeito, relato, laudo, valor, previsão de entrega, observações etc.), pela API
/api/central que já existe. A Central sempre mostra ao dono o "antes → depois" de cada campo e só chama
a rota depois que ele toca em Confirmar.

Importante: este sistema é usado por vários lojistas. Estas mudanças, como o resto de /api/central,
só leem e alteram dados da loja CENTRAL_LOJA, com a mesma autenticação (Authorization: Bearer
CENTRAL_API_TOKEN). OS de outra loja ou que não existe: 404 {"erro": "não encontrado"}, sem dizer que
existe em outra loja. O UPDATE também leva o filtro de loja, não só o SELECT antes. Toda resposta leva
"loja": "rbtechcelulares" no topo e em cada OS.

Use a mesma função e as mesmas regras que a tela de EDITAR OS do sistema já usa. Não duplique regra de
negócio: uma edição feita pela Central precisa ficar igual a uma feita pela tela (validações, histórico
ou log da OS, recálculo de totais, o que o sistema já faz). No histórico, registre que a alteração veio
da "RB Central".

## 1. GET /status: inclua "campos_os"

A lista dos campos que o dono pode editar numa OS, com os nomes que você vai aceitar em /editar:

"campos_os": [
  { "campo": "cliente_nome", "nome": "Nome do cliente", "tipo": "texto" },
  { "campo": "cliente_whatsapp", "nome": "WhatsApp do cliente", "tipo": "texto" },
  { "campo": "marca", "nome": "Marca", "tipo": "texto" },
  { "campo": "modelo", "nome": "Modelo", "tipo": "texto" },
  { "campo": "defeito", "nome": "Defeito", "tipo": "texto" },
  { "campo": "relato", "nome": "Relato do cliente", "tipo": "texto" },
  { "campo": "valor", "nome": "Valor do orçamento", "tipo": "numero" },
  ... os outros campos que a tela de editar OS tem (ex.: imei, cor, laudo, observacoes,
  previsao_entrega "data", tecnico "opcao" com "opcoes": [...], garantia...)
]

- tipo: "texto", "numero" (reais ou quantidade), "data" (AAAA-MM-DD) ou "opcao" (com "opcoes": a lista
  exata de valores aceitos).
- NÃO coloque em campos_os: status (tem a rota PATCH /os/:id), pagamento (POST /os/:id/pagamento), loja,
  id, número da OS, datas de criação, e nunca a senha ou o padrão de desbloqueio do aparelho.
- Use nomes simples em minúsculas com "_" e mantenha a lista estável.

## 2. GET /os/:id e GET /os: devolva esses campos

Cada OS devolvida passa a ter, no nível de cima, os campos de campos_os com o valor atual (além de
"cliente": { "nome", "whatsapp" } e "aparelho": { "marca", "modelo" } que já existem). A Central usa
isso para mostrar o "antes".

## 3. Rota nova: POST /os/:id/editar

Corpo: { "alterar": { "cliente_nome": "Maria Souza", "valor": 350, "previsao_entrega": "2026-11-20" } }

- :id = id ou número da OS (número procurado só dentro da loja CENTRAL_LOJA).
- Muda só os campos enviados. Cada campo precisa estar em campos_os; se algum não estiver, ou se o
  valor for inválido para o tipo (número negativo, data fora do formato, opção que não existe, texto
  grande demais, WhatsApp sem DDD), responda 400 {"erro": "..."} dizendo qual, sem mudar nada.
- "numero" pode vir null para apagar o valor; texto vazio apaga o texto (se a tela permitir).
- Tudo numa transação: ou muda todos os campos enviados, ou nenhum.
- Nunca muda status nem pagamento por esta rota.
- Se o valor do orçamento mudar e o evento de orçamento para a RB Central estiver ligado
  (POST /api/evento com "tipo": "orcamento"), dispare como a tela faria.
- Resposta: { "loja": "rbtechcelulares", "os": OS } com a OS já atualizada.

## Regras

- Valide tudo no servidor, mesmo que a Central já confira.
- Limite o tamanho dos textos como a tela limita.

No fim, me diga a lista final de campos_os (campo, nome, tipo e opções).
