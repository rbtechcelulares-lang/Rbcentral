# Prompt para o Claude Code do sistema de OS: mandar vendas, OS, orçamentos, status e follow-ups para a Central

Abra o Claude Code no repositório do sistema de OS e cole o texto abaixo.

---

Quero que o sistema avise o meu assistente RB Central a cada acontecimento importante da minha loja:
venda, OS aberta, orçamento, mudança de status e follow-up. A Central monta a mensagem de WhatsApp
para o cliente e eu confirmo lá antes de ela sair.

Importante: este sistema é usado por vários lojistas. Os avisos são só para a minha loja, a mesma da
variável CENTRAL_LOJA que a API /api/central já usa. Registros de outras lojas nunca disparam nada.

## Como avisar a Central

Uma função única, por exemplo avisarCentral(evento), que faz:

- POST {CENTRAL_URL}/api/evento
- Headers: Authorization: Bearer {CENTRAL_API_TOKEN} (a mesma chave que a API /api/central já usa)
  e Content-Type: application/json
- Timeout de 8 segundos. Se falhar, só registre no log: nunca trave a tela nem desfaça o que o
  usuário fez.
- Crie a variável de ambiente CENTRAL_URL com o valor https://rbcentral.vercel.app

Corpo (JSON):

{
  "loja": "rbtechcelulares",
  "tipo": "venda" | "os_criada" | "orcamento" | "status" | "follow_up",
  "id": "<id do registro no sistema>",
  "cliente": { "nome": "Maria Souza", "whatsapp": "5548988887777" },
  "dados": { ... conforme o tipo, abaixo ... },
  "mensagem": "opcional: texto pronto, se o sistema já tiver um"
}

## Quando disparar e o que mandar em "dados"

1. venda: quando uma venda é finalizada.
   dados: { "numero", "itens": [{ "descricao", "quantidade", "valor" }], "total", "forma_pagamento", "garantia" }
2. os_criada: quando uma OS nova é aberta.
   dados: { "numero", "aparelho" (marca + modelo), "defeito", "previsao" (texto, ex.: "amanhã às 17h") }
3. orcamento: quando um orçamento fica pronto ou é enviado ao cliente.
   dados: { "numero" (da OS), "aparelho", "servico", "valor", "validade" }
4. status: toda vez que o status de uma OS MUDA (salvar sem mudar o status não dispara).
   Basta { "loja", "tipo": "status", "id": "<id da OS>" }: a Central lê a OS pela API /api/central/os/:id.
   Se este aviso de status já estiver ligado para /api/os-status, pode manter ou trocar por este.
5. follow_up: quando um follow-up vence.
   dados: { "motivo", "numero", "aparelho" ou "produto", "valor" } e, se o follow-up tiver texto, mande em "mensagem".
   Motivos que a Central já sabe escrever: orcamento_sem_resposta, aguardando_retirada, pos_venda, pos_reparo.
   - Se o sistema já tem follow-ups ou lembretes, dispare quando cada um vencer.
   - Se não tem, crie uma rotina diária (por volta das 10h, horário de Brasília) que dispara, uma vez só por registro:
     - orcamento_sem_resposta: orçamento enviado há 2 dias sem resposta;
     - aguardando_retirada: OS concluída há 3 dias e ainda não retirada;
     - pos_venda: 7 dias depois de uma venda;
     - pos_reparo: 7 dias depois da entrega de uma OS.

## Regras

- Só registros da loja CENTRAL_LOJA. Nunca mande dados de outra loja.
- O WhatsApp do cliente vai com DDI + DDD + número, só números (ex.: 5548988887777).
- Não mande custos internos, senhas nem dados que o cliente não deve ver.
- Cada acontecimento dispara uma vez só (a Central também ignora repetidos).

No fim, me diga em quais lugares do código cada evento foi ligado, a lista exata de status da minha
loja e como ficaram os follow-ups (se já existiam ou se você criou a rotina diária).
