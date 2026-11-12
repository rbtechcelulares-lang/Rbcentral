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
| `CENTRAL_SENHA` | A senha que você vai usar para entrar (8+ caracteres) |
| `CENTRAL_SEGREDO` | Um texto aleatório longo (32+ caracteres) que assina o login e as confirmações. Gere um, por exemplo, numa ferramenta de senha forte com 40 caracteres |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic (platform.claude.com › API Keys). Pode ser a mesma do site ou uma nova, para separar os gastos |
| `RB_GITHUB_TOKEN` | Token do GitHub com acesso **só** ao repositório do site (fine-grained token › Repository access: RB-TECH-CELULARES › Contents: Read and write) |
| `RB_GITHUB_REPO` | `rbtechcelulares-lang/RB-TECH-CELULARES` |
| `RB_GITHUB_BRANCH` | A mesma branch que o site publica: o valor de `GITHUB_BRANCH` no projeto do site na Vercel. Se lá estiver vazio, deixe vazio aqui também |
| `RB_PAINEL_CHAVE` | A chave do painel (a mesma das abas Clientes e Cliques do admin do site) |
| `SAAS_API_URL` | Endereço base da API do sistema de OS (ex.: `https://rbtechcelulares.reparosimples.com/api/central`) |
| `SAAS_API_TOKEN` | O mesmo valor de `CENTRAL_API_TOKEN` configurado no sistema de OS |

As variáveis de cada sistema são independentes: com só as do site, ele já funciona para o
site. O sistema de OS entra quando a API dele estiver pronta.

## Ligar o sistema de OS

O sistema de OS precisa oferecer a API descrita em [`docs/CONTRATO-API-SAAS.md`](docs/CONTRATO-API-SAAS.md).
Para isso, abra o Claude Code no repositório do sistema e use o prompt de
[`docs/PROMPT-SISTEMA-OS.md`](docs/PROMPT-SISTEMA-OS.md). Depois, configure `SAAS_API_URL` e
`SAAS_API_TOKEN` aqui.

## Segurança

- **Acesso:** só com `CENTRAL_SENHA`. O login vale 12 horas, e são 5 tentativas erradas por
  IP antes de esperar 10 minutos.
- **Confirmações:** as alterações são assinadas pelo servidor, valem 15 minutos e não rodam duas
  vezes.
- **Chaves:** nenhuma chave vai para o navegador; todas ficam nas variáveis da Vercel.
- **Registro:** cada ação confirmada fica no log da Vercel (Logs › procure `rb-central acao`).
- **Buscadores:** a página não aparece no Google (`noindex`).
