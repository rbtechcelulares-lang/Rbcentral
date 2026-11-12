# Prompt para o Claude Code do sistema de OS: link de acompanhamento em toda OS

Abra o Claude Code no repositório do sistema de OS (Reparo Simples) e cole o texto abaixo.

---

O meu assistente RB Central não está recebendo o link de acompanhamento das OS pela API /api/central
(ex.: a OS #409 vem sem link). Quero que toda OS da loja CENTRAL_LOJA tenha o link e que ele venha na API.

1. Toda OS tem link de acompanhamento. Se uma OS ainda não tem (OS antigas, criadas antes desse recurso,
   ou criadas por algum caminho que não gera), gere o link do mesmo jeito que a tela do sistema gera e
   salve, na hora em que a OS for lida pela API. Se fizer sentido, rode também uma vez para todas as OS
   abertas da loja CENTRAL_LOJA.
2. Devolva "link_acompanhamento" com a URL completa (https://...) em: GET /os, GET /os/:id, na resposta
   do PATCH /os/:id, em POST /os/:id/editar e em POST /os/:id/aviso-pronto. Só use null se a loja tiver a
   página de acompanhamento desligada.
3. No "comando": { "acao": "avisar_cliente", "mensagem" } (ao concluir pelo PATCH e no aviso-pronto),
   inclua o link de acompanhamento na mensagem.
4. Segurança: o link de uma OS só abre aquela OS (token aleatório e longo, não o número da OS), não mostra
   custo interno nem dados de outras OS, e nunca devolva link de OS de outra loja.

No fim, me diga: a OS #409 tem link agora? Qual o formato do link? A página de acompanhamento está
ligada para a loja rbtechcelulares?
