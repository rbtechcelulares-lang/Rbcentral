# RB Central

Assistente de gestão com IA (Claude Haiku 5.5) que comanda o **site RB Tech Celulares** e o
**sistema de OS**. Só o dono acessa, com senha. Tudo que altera algo aparece como um cartão
**Confirmar / Cancelar** antes de acontecer.

| O que ele faz | Sistema |
|---|---|
| Mudar preço de aparelhos e publicar | Site |
| Tirar ou colocar aparelhos na vitrine e publicar | Site |
| Listar aparelhos e clientes novos do CRM | Site |
| Criar OS, mudar status, marcar como paga, avisar o cliente | Sistema de OS |
| Ver e mudar metas, listar pedidos de peças aos fornecedores | Sistema de OS |
| Relatório do dia dos dois sistemas | Os dois |

Ele **não** mexe nas configurações do sistema de OS nem da página do site.

## Como colocar no ar (Vercel)

1. Na Vercel: **Add New › Project**, importe o repositório `Rbcentral` e clique **Deploy**.
   Não precisa configurar build.
2. Em **Settings › Environment Variables**, crie as variáveis abaixo e depois faça **Redeploy**.

| Variável | O que é |
|---|---|
| `CENTRAL_SENHA` | **Opcional.** Sem ela, você entra com a **mesma senha do admin do site** |
| `CENTRAL_SEGREDO` | **Opcional.** Texto aleatório (32+ caracteres) que assina o login e as confirmações; sem ele, é gerado a partir das chaves do servidor |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic (platform.claude.com › API Keys). Pode ser a mesma do site ou uma nova, para separar os gastos |
| `RB_GITHUB_TOKEN` | Token do GitHub com acesso **só** ao repositório do site (fine-grained token › Repository access: RB-TECH-CELULARES › Contents: Read and write) |
| `RB_GITHUB_REPO` | `rbtechcelulares-lang/RB-TECH-CELULARES` |
| `RB_GITHUB_BRANCH` | A mesma branch que o site publica: o valor de `GITHUB_BRANCH` no projeto do site na Vercel. Se lá estiver vazio, deixe vazio aqui também |
| `RB_PAINEL_CHAVE` | A chave do painel (a mesma das abas Clientes e Cliques do admin do site) |
| `SAAS_API_URL` | Endereço base da API do sistema de OS (ex.: `https://rbtechcelulares.reparosimples.com/api/central`) |
| `SAAS_API_TOKEN` | O mesmo valor de `CENTRAL_API_TOKEN` configurado no sistema de OS |
| `SAAS_LOJA` | A sua loja no sistema de OS: `rbtechcelulares` (é o padrão se ficar vazio) |
| `GROQ_API_KEY` | **Microfone.** Chave grátis da Groq (console.groq.com › API Keys) para transcrever a voz com o Whisper large-v3. Sem ela, o microfone usa o reconhecimento do navegador ou o ditado do teclado |
| `CENTRAL_LIMITE_VOZ_CLAUDE` | **Opcional.** Quantas transcrições por dia o Claude Haiku revisa depois do Whisper (padrão `40`; `0` desliga). Passando do limite, segue só com o Whisper grátis até o dia seguinte. A API do Claude não recebe áudio, por isso ele revisa o texto em vez de ouvir |
| `ZAPI_OMNI_KEY` | **Opcional, envio automático pelo WhatsApp da loja.** A Secret Key da Z-API Omni (painel › Segurança). Precisa de uma conexão **WhatsApp Web** (QR code) em Conexões. Tem prioridade sobre a API da Meta |
| `ZAPI_OMNI_CANAL` | **Opcional.** O ID do canal na Z-API Omni; sem ele, a Central usa a conexão WhatsApp Web conectada |
| `WHATSAPP_TOKEN` | **Opcional, envio automático pela API oficial da Meta.** Token permanente do usuário do sistema da Meta (Configurações do negócio › Usuários do sistema › Gerar token, validade "Nunca", permissões `whatsapp_business_messaging` e `whatsapp_business_management`) |
| `WHATSAPP_PHONE_ID` | O "Phone Number ID" do número que envia (developers.facebook.com › seu app › WhatsApp) |
| `WHATSAPP_MODELO` | Nome do modelo aprovado (Utilidade, com `{{1}}` no meio do texto), ex.: `aviso_equipe`. Sem ele, a mensagem vai como texto livre e só chega se a pessoa mandou mensagem para o número nas últimas 24 h |
| `WHATSAPP_IDIOMA` | **Opcional.** Idioma do modelo (padrão `pt_BR`) |
| `CENTRAL_EQUIPE` | **Equipe no WhatsApp.** `Nome:número com DDD`, várias pessoas separadas por vírgula (ex.: `Nizael:5548999999999`). Fica aqui e não no código porque o repositório é público |

As variáveis de cada sistema são independentes: com só as do site, ele já funciona para o
site. O sistema de OS entra quando a API dele estiver pronta.

## Histórico na nuvem (o mesmo no iPhone e no computador)

A Central guarda as 6 últimas conversas. Para elas serem as mesmas em todos os aparelhos, rode
[`supabase/central_conversas.sql`](supabase/central_conversas.sql) no Supabase do site (o mesmo do
CRM): **SQL Editor › New query › cole tudo › Run**. Usa a mesma `RB_PAINEL_CHAVE` do CRM. Sem
isso, cada aparelho guarda as suas.

## Ligar o sistema de OS

O sistema de OS precisa oferecer a API descrita em [`docs/CONTRATO-API-SAAS.md`](docs/CONTRATO-API-SAAS.md).
Para isso, abra o Claude Code no repositório do sistema e use o prompt de
[`docs/PROMPT-SISTEMA-OS.md`](docs/PROMPT-SISTEMA-OS.md). Depois, configure `SAAS_API_URL` e
`SAAS_API_TOKEN` aqui.

## Segurança

- **Só a sua loja:** o sistema de OS é de vários lojistas, mas a chave da API só abre a sua loja
  (garantido no servidor do sistema). Como segunda trava, o Central recusa qualquer resposta que
  não seja da loja `SAAS_LOJA`.
- **Acesso:** com a senha do admin do site (ou `CENTRAL_SENHA`, se configurada). O login vale 12 horas, e são 5 tentativas erradas por
  IP antes de esperar 10 minutos.
- **Confirmações:** as alterações são assinadas pelo servidor, valem 15 minutos e não rodam duas
  vezes.
- **Chaves:** nenhuma chave vai para o navegador; todas ficam nas variáveis da Vercel.
- **Registro:** cada ação confirmada fica no log da Vercel (Logs › procure `rb-central acao`).
- **Buscadores:** a página não aparece no Google (`noindex`).
