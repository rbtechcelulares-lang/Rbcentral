# Prompt para o Claude Code do sistema de OS: vendas e estoque pela RB Central

Abra o Claude Code no repositório do sistema de OS (Reparo Simples) e cole o texto abaixo.

---

Quero que o meu assistente RB Central também registre vendas e cadastre aparelhos no estoque, pela
API /api/central que já existe. A Central sempre pede a minha confirmação antes de chamar essas rotas.

Importante: este sistema é usado por vários lojistas. Estas rotas, como as outras de /api/central,
só leem e alteram dados da loja CENTRAL_LOJA, com a mesma autenticação (Authorization: Bearer
CENTRAL_API_TOKEN), e toda resposta leva "loja": "rbtechcelulares" no topo e em cada item.

Use as funções e regras que o sistema JÁ usa nas telas "Venda de Produtos" (Vender) e
"Aparelhos" (Vender / troca, Comprar aparelho, Cadastrar aparelho no estoque). Não duplique regra
de negócio: a venda feita pela Central precisa ficar igual a uma venda feita pela tela (estoque,
caixa, financeiro, histórico, comissões, o que o sistema já faz).

## Rotas novas em /api/central

1. GET /aparelhos?status=&busca=&limite=30
   Resposta: { "loja", "aparelhos": [APARELHO, ...] } com os celulares do estoque.
   APARELHO = { "id", "loja", "marca", "modelo", "armazenamento", "cor", "imei", "condicao" ("novo" ou "seminovo"),
   "bateria" (%), "status" (como o sistema usa: Preparação, Em estoque, Disponível, Reservado...),
   "custo", "preco_venda", "entrada_em" }

2. POST /aparelhos
   Corpo: { "marca", "modelo", "armazenamento", "cor", "imei", "condicao", "bateria" (% ou null), "custo",
   "preco_venda" (ou null), "origem": "compra" | "troca" | "outro", "fornecedor_ou_cliente", "observacoes" }
   Cadastra no estoque como o botão "Cadastrar aparelho no estoque" (ou "Comprar aparelho", se
   origem = compra e o sistema registra a compra/saída de caixa), no status inicial do sistema.
   Resposta: { "loja", "aparelho": APARELHO }

3. GET /produtos?busca=&limite=30
   Resposta: { "loja", "produtos": [{ "id", "loja", "nome", "preco", "estoque" }] } (acessórios e
   produtos da Venda de Produtos).

4. POST /vendas
   Corpo:
   {
     "cliente": { "nome", "whatsapp" },
     "itens": [ { "tipo": "aparelho" | "produto", "id", "quantidade", "valor" (preço unitário) } ],
     "desconto": número,
     "pagamentos": [ { "forma", "valor", "parcelas" } ],
     "troca": { "marca", "modelo", "armazenamento", "cor", "imei", "condicao", "bateria", "valor_avaliado", "observacoes" } ou null,
     "garantia": "texto",
     "observacoes": "texto"
   }
   - Registra a venda igual à tela: aparelho vendido sai do estoque (vendido), o estoque dos produtos
     diminui, os pagamentos entram no caixa/financeiro, o cliente é achado pelo WhatsApp ou criado.
   - Aparelho na troca (parte do pagamento): entra no estoque de aparelhos com origem "troca",
     custo = valor_avaliado, no status inicial do sistema (ex.: Preparação), ligado a esta venda, e
     conta como pagamento da venda com a forma "troca".
   - As contas precisam fechar: soma dos pagamentos + valor_avaliado = soma dos itens − desconto.
     Se não fechar, responda 400 { "erro": "..." } dizendo a diferença, sem registrar nada.
   - Aparelho que não está disponível, produto sem estoque, forma de pagamento que o sistema não aceita
     ou id de outra loja: 400/404 com o motivo, sem registrar nada.
   - Faça tudo numa transação: ou registra a venda inteira (venda, itens, pagamentos e aparelho da
     troca), ou não registra nada.
   - Se a regra de "caixa aberto" estiver ligada e o caixa estiver fechado, faça o mesmo que a tela.
   Resposta: { "loja", "venda": { "id", "loja", "numero", "total", "criado_em" }, "aparelho_troca": APARELHO ou null }

5. Em GET /status, inclua também as formas de pagamento aceitas nas vendas (se forem diferentes das
   da OS), por exemplo "formas_pagamento_venda": ["pix", "dinheiro", "cartão de crédito", ...].

## Regras

- Valide tudo: números ≥ 0, quantidades inteiras ≥ 1, textos com tamanho máximo, IMEI só números
  (pode vir vazio).
- Nunca devolva custo interno ou lucro em telas de cliente; nesta API (só da Central) pode.
- Se o evento de venda para a RB Central já estiver ligado (POST /api/evento com "tipo": "venda"), a
  venda registrada por esta rota também dispara esse evento, como uma venda feita pela tela.

No fim, me diga as formas de pagamento aceitas, a lista de status de aparelho e o que acontece com o
caixa numa venda feita pela Central.
