# Prompt para o Claude Code do sistema de OS: lista de vendas para a Central (sorteio)

Cole o texto abaixo no Claude Code do sistema de OS (Reparo Simples).

---

Na API da Central (`/api/central`, a mesma chave `CENTRAL_API_TOKEN` e a mesma loja `CENTRAL_LOJA` das
outras rotas), crie a rota abaixo para a RB Central ler as vendas da loja. Ela é usada para o sorteio
de clientes: a Central gera um cupom para cada cliente que comprou celular nos dias pedidos.

## GET /api/central/vendas?desde=AAAA-MM-DD&ate=AAAA-MM-DD&limite=1000

- `desde` e `ate`: datas no horário de Brasília, as duas inclusive (`ate` vale o dia inteiro, até 23:59).
- Use os mesmos dados da tela **Venda de Produtos › Histórico** (número, data e hora, forma de
  pagamento, quem comprou, itens e total), e inclua também as vendas de aparelhos feitas por
  "Vender / troca", se elas ficarem em outro lugar. Todas as vendas do período, de todos os vendedores.
- Só vendas da loja `CENTRAL_LOJA`. Ordem: da mais antiga para a mais nova. `limite` padrão 1000.

Resposta:

```json
{
  "loja": "rbtechcelulares",
  "vendas": [
    {
      "id": "<id da venda>",
      "loja": "rbtechcelulares",
      "numero": 488,
      "criado_em": "2026-11-14T11:44:00-03:00",
      "cancelada": false,
      "vendedor": "Nizael",
      "cliente": { "nome": "Maria Souza", "whatsapp": "5548988887777" },
      "itens": [
        { "tipo": "aparelho", "descricao": "iPhone 14 Plus 128GB Preto", "quantidade": 1, "valor": 2500, "aparelho_id": "<id do aparelho no estoque>" },
        { "tipo": "produto", "descricao": "Película 3D", "quantidade": 1, "valor": 40 }
      ],
      "total": 2540,
      "pagamentos": [{ "forma": "pix", "valor": 2540 }]
    }
  ]
}
```

## Regras

- `tipo` de cada item:
  - `"aparelho"` quando o item é um celular do estoque (a parte "Celulares" da Venda de Produtos, ou
    Vender / troca), mesmo que o texto do item no Histórico não tenha o nome do modelo. Nesse caso,
    mande em `descricao` o modelo do aparelho do estoque (marca, modelo, armazenamento e cor);
  - `"produto"` para acessórios e produtos cadastrados;
  - `"avulso"` para item digitado na hora, sem cadastro.
- `descricao`: o texto do item como aparece no Histórico (para aparelho: marca, modelo, armazenamento e cor).
- `cliente`: quem comprou, ou seja, o nome que aparece no selo com o ícone de pessoa em cada venda do
  Histórico, com o WhatsApp do cadastro desse cliente (DDI + DDD, só números). Se o cliente foi
  digitado só como nome, mande o nome e `"whatsapp": ""`. Se a venda não tem cliente, mande
  `"cliente": null`. Nunca ponha o nome da loja ou do vendedor no lugar do cliente.
- `criado_em` em ISO 8601 com o fuso de Brasília (`-03:00`).
- Venda cancelada ou estornada: mande com `"cancelada": true` (a Central ignora).
- Toda venda leva o campo `"loja"` (a Central confere e recusa qualquer outra loja).
- Não mande custo, lucro nem nenhum dado de outra loja.
- Datas inválidas: `400 {"erro": "..."}`.

## Teste

`GET /api/central/vendas?desde=2026-11-14&ate=2026-11-14` deve trazer as vendas #486, #487 e #488 de
14/11/2026, cada uma com os itens e o cliente.
