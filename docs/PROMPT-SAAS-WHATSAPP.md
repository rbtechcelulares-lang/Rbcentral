# Prompt para o Claude Code do sistema de OS: WhatsApp com botão de confirmação (Z-API Omni)

Abra o Claude Code no repositório do sistema de OS e cole o texto abaixo.

---

Quero que o sistema mande WhatsApp para o cliente a cada mudança de status de OS, venda, OS aberta,
orçamento e follow-up, **sempre com um botão de confirmação** e **sem abrir o WhatsApp Web**: a
pessoa confere a mensagem, toca em "Enviar" e o servidor manda pela API da Z-API Omni.

Este sistema é usado por vários lojistas. Cada loja configura o próprio WhatsApp, e nada de uma loja
pode aparecer ou ser enviado por outra.

## 1. Configuração do WhatsApp por loja

- Na tela de configurações da loja (só o dono/administrador da loja vê), crie a seção
  **"WhatsApp automático (Z-API Omni)"** com:
  - **Secret Key** (a chave do menu Segurança da Z-API Omni)
  - **ID do canal** (o ID da conexão WhatsApp Web, em Conexões na Z-API Omni)
  - botão **"Testar"**: manda "Teste da RB Tech ✅" para um número que a pessoa digita
  - liga/desliga
- Guarde a Secret Key **só no servidor**, criptografada (AES-256-GCM com uma chave na variável de
  ambiente `WHATSAPP_CRIPTO_CHAVE`). Depois de salva, nunca devolva a chave para o navegador:
  mostre só os 4 últimos caracteres. Logs nunca mostram a chave.
- Sempre filtre pela loja do usuário logado ao ler ou salvar essa configuração.

## 2. Envio pelo servidor (Z-API Omni)

Crie uma função de servidor `enviarWhatsApp(lojaId, telefone, texto)`:

- `POST https://api.omni.z-api.io/v1/channels/{ID do canal}/messages`
- Header `Authorization: Bearer {Secret Key da loja}` e `Content-Type: application/json`
- Corpo:

```json
{ "recipient": { "identifier": "5548988887777" }, "content": { "type": "TEXT", "body": { "message": "texto" } } }
```

- Sucesso: `200` com `{ "messageId": "..." }`.
- Erros: `401` = Secret Key errada; `422` com `"subCode": "CHANNEL_DISCONNECTED"` = o WhatsApp da loja
  desconectou (ler o QR code de novo em Conexões na Z-API Omni); `502` = Z-API fora do ar. Mostre
  esses motivos em português na tela.
- Telefone sempre com DDI + DDD + número, só números.
- Documentação: https://developer.omni.z-api.io
- O navegador nunca chama a Z-API: ele chama uma rota do sistema, que confere o usuário e a loja e
  então envia.

## 3. Botão de confirmação (nada sai sem clique)

Em cada acontecimento abaixo, abra uma janela **"Avisar o cliente?"** com: nome e telefone do cliente,
a mensagem pronta **editável**, e os botões **"Enviar pelo WhatsApp"** e **"Agora não"**.

- **Mudança de status de OS** (em qualquer tela onde o status muda), depois de salvar.
- **Venda finalizada.**
- **OS aberta.**
- **Orçamento pronto ou enviado.**
- **Follow-ups:** na lista de follow-ups, cada follow-up vencido tem o botão **"Enviar pelo WhatsApp"**
  (com a mesma janela). Se o sistema não tem follow-ups automáticos, crie uma rotina diária (10h,
  Brasília) que cria, uma vez só por registro: orçamento sem resposta há 2 dias, OS concluída e não
  retirada há 3 dias, 7 dias depois de uma venda e 7 dias depois da entrega de uma OS.

Depois de enviar, registre no histórico da OS ou da venda: "Mensagem enviada pelo WhatsApp", com o
texto, a data e quem enviou. Se a loja não configurou a Z-API, o botão vira "Abrir no WhatsApp"
(link `https://wa.me/<telefone>?text=<mensagem>`), como fallback.

**Textos padrão** (troque {nome} pelo primeiro nome do cliente; a pessoa pode editar antes de enviar):

- Abertura de todas: `Olá, {nome}! Aqui é da *RB Tech Celulares*.` (use o nome da loja logada)
- Concluído/pronto: `Seu {aparelho} (OS #{numero}) já está *pronto para retirada*. ✅` + `Valor: R$ {valor}.` se não estiver pago
- Em análise: `Seu {aparelho} (OS #{numero}) está *em análise*. Assim que terminarmos, te passamos o orçamento.`
- Em serviço/reparo: `Seu {aparelho} (OS #{numero}) já está *em reparo*. Avisamos quando ficar pronto.`
- Aguardando peça: `Seu {aparelho} (OS #{numero}) está *aguardando peça*. Avisamos assim que ela chegar.`
- Orçamento: `O orçamento do seu {aparelho} (OS #{numero}) ficou em *R$ {valor}* ({serviço}). Podemos seguir com o conserto? É só responder *SIM*.`
- Entregue: `Seu {aparelho} (OS #{numero}) foi *entregue*. Obrigado por confiar na RB Tech! Qualquer coisa, estamos à disposição.`
- Cancelado: `A OS #{numero} ({aparelho}) foi *cancelada*. Se precisar de algo, é só chamar.`
- Outro status: `Atualização da sua OS #{numero} ({aparelho}): agora está *{status}*.`
- OS aberta: `Recebemos seu {aparelho} (OS #{numero}) para *{defeito}*. Previsão: {previsão}. Vamos te avisando a cada etapa.`
- Venda: `Obrigado pela sua compra! 🙌` + uma linha por item (`• 2x Película — R$ 40,00`) + `Total: R$ {total} ({forma de pagamento}).` + `Garantia: {garantia}.`
- Follow-ups: orçamento sem resposta: `Conseguiu ver o orçamento do seu {aparelho} (OS #{numero})? Se quiser seguir com o conserto, é só responder *SIM*. 😊` · aguardando retirada: `Seu {aparelho} (OS #{numero}) está pronto e te esperando aqui na loja. Qual o melhor dia para você buscar?` · pós-venda: `Passando para saber: está tudo certo com seu {produto}? Qualquer coisa, estamos à disposição.` · pós-reparo: `Passando para saber: seu {aparelho} está funcionando direitinho depois do conserto?`
- Fecho (nas que não terminam com pergunta): `Qualquer dúvida, é só responder esta mensagem.`

## 4. Integração com a RB Central (só a minha loja, a de `CENTRAL_LOJA`)

A RB Central também mostra essas mensagens para eu confirmar de lá. Para não mandar duas vezes:

- **No momento do acontecimento**, continue chamando a Central como já combinado:
  `POST {CENTRAL_URL}/api/evento` (venda, os_criada, orcamento, follow_up) ou
  `/api/os-status` (status), com `Authorization: Bearer {CENTRAL_API_TOKEN}`. Se isso ainda não
  existe, faça primeiro o prompt anterior (o dos eventos para a RB Central), que tem o formato.
- **Se a pessoa tocar em "Enviar pelo WhatsApp" aqui no sistema**, depois de enviar chame a Central de
  novo com o mesmo corpo e mais `"ja_enviado": true` e `"mensagem": "<texto enviado>"`. A Central tira
  a mensagem da lista dela.
- **"Agora não"** não muda nada: a mensagem continua esperando na Central.
- Crie a rota `POST /api/central/eventos/enviado` (mesma autenticação da API `/api/central`, só a loja
  `CENTRAL_LOJA`), com o corpo `{ "tipo", "id", "status" }`. A Central chama quando eu envio por lá:
  marque o aviso/follow-up correspondente como enviado (para o sistema não oferecer de novo) e
  registre no histórico "Mensagem enviada pela RB Central". Responda
  `{ "loja": "rbtechcelulares", "ok": true }`.
- Para a minha loja, a Secret Key e o ID do canal são os mesmos que eu uso na RB Central.

## Regras

- Nunca envie sem o clique em "Enviar" (exceto o botão "Testar", que também é um clique).
- Tudo filtrado pela loja do usuário; a integração com a Central só para a loja `CENTRAL_LOJA`.
- Não mande custos internos nem dados que o cliente não deve ver.
- Não trave a tela: envios e chamadas à Central com timeout de 8 segundos e mensagem de erro clara.

No fim, me diga onde ficou a configuração do WhatsApp, em quais telas aparece o botão de
confirmação, como ficaram os follow-ups e a lista exata de status da minha loja.
