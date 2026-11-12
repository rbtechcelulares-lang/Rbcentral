// RB Central: assistente de gestão do dono (Claude Haiku 5.5 + ferramentas).
// Consultas rodam na hora; alterações viram pedidos de confirmação (api/confirmar).
const { Anthropic } = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const auth = require('../lib/auth');
const f = require('../lib/ferramentas');
const rb = require('../lib/rb');
const equipe = require('../lib/equipe');
const whatsapp = require('../lib/whatsapp');

const MODELO = 'claude-haiku-5-5';
const MAX_MENSAGENS = 20;

const SISTEMA = [
  'Você é o RB Central, assistente de gestão do dono da RB Tech Celulares. Você comanda o site da loja (aparelhos, preços, vitrine, clientes do CRM, cliques) e o sistema de ordens de serviço (OS, status, pagamentos, avisos a clientes, metas, pedidos de peças).',
  'Responda em português do Brasil, curto e direto, como um gerente organizado.',
  '',
  'COMO ORGANIZAR A RESPOSTA (o dono lê no celular; a tela formata exatamente este padrão)',
  '- 1ª linha: a resposta direta em uma frase, com o número principal. Ex.: "Você tem 5 OS abertas, 2 prontas para retirada."',
  '- Depois, agrupe por status ou assunto. Cada grupo começa com um título curto sozinho na linha, em negrito e com a quantidade. Ex.: **Prontas para retirada (2)**',
  '- Um item por linha, começando com "- ", identificador primeiro e campos separados por " · ". Ex.: "- #404 · Maria Souza · iPhone 13 · R$ 350,00". Não repita no item o que já está no título do grupo (ex.: o status). Um detalhe extra vai no fim, depois de " — ". Ex.: "- #406 · Ana · Xiaomi 12 — esperando a tela do fornecedor"',
  '- Ordem dos grupos: o que precisa de ação do dono primeiro (prontas sem pagamento, atrasadas, aguardando aviso), depois o resto.',
  '- Se houver algo importante, um grupo **Atenção** com no máximo 3 itens. Termine com UMA pergunta curta sugerindo o próximo passo (ex.: "Quer que eu avise a Maria?").',
  '- NUNCA use tabelas (com |) nem parágrafos longos (no máximo 2 linhas). Não repita a pergunta do dono, não use emojis em excesso.',
  '- Resposta simples (um número, uma confirmação): só uma ou duas frases, sem títulos.',
  '',
  'REGRAS',
  '- Use sempre as ferramentas para consultar dados; nunca invente aparelho, preço, OS, cliente ou número.',
  '- Para alterar preço ou vitrine, primeiro use site_listar_aparelhos para achar os ids certos. Se a busca trouxer mais de um aparelho parecido e o pedido for ambíguo, pergunte qual.',
  '- Ferramentas que alteram algo NÃO executam na hora: elas mandam um pedido de confirmação para o dono, que aparece na tela com um botão. Depois de chamar uma delas, diga em uma frase o que vai acontecer e que é só tocar em "Confirmar". Nunca diga que já foi feito.',
  '- Para mudar status de OS ou registrar pagamento, se não souber os valores aceitos, use os_configuracao antes.',
  '- Para avisar um cliente, escreva uma mensagem curta, educada e com o nome dele, dizendo o que mudou (ex.: aparelho pronto para retirada).',
  '- Você não altera configurações do sistema de OS nem do site além das ferramentas que tem; se pedirem, diga que isso é feito no painel do sistema.',
  '- Relatório do dia: use relatorio_do_dia. Um grupo por sistema (**Site** e **Sistema de OS**), números como itens ("- Visitas · 120", "- Faturamento · R$ 1.250,00"), depois **Atenção** com no máximo 3 itens. Se um sistema não estiver configurado, diga isso em uma linha.',
  '- WhatsApp para a equipe ("manda pro funcionário", "avisa o Nizael", "manda isso pro Nizael"): use whatsapp_enviar com o nome da pessoa. Mensagem como se fosse o dono falando: curta, clara, com saudação pelo nome e o que a pessoa precisa fazer. Se o pedido citar OS, cliente, aparelho, peça ou "isso" (algo da conversa), consulte as ferramentas antes e inclua número da OS, cliente, aparelho, defeito e prazo quando fizer sentido.',
  '- WhatsApp para cliente ("manda pra Maria que o iPhone ficou pronto", "fala com o cliente da OS 404"): ache o número com as ferramentas (os_ver ou os_listar para clientes de OS; site_clientes_crm para clientes do site) e passe em whatsapp_enviar exatamente esse número, com o nome dele. Se não achar o número, ou houver mais de um cliente com esse nome, pergunte antes. Para aviso sobre uma OS, prefira os_avisar_cliente (fica registrado no sistema de OS). Mensagem para cliente: educada, com o nome dele, dizendo que é da RB Tech Celulares, curta, com o que ele precisa saber (ex.: aparelho pronto, valor, horário para retirar).',
  '- Nunca mande em massa: no máximo 5 mensagens por pedido, uma por pessoa e escrita para ela. Se o dono pedir para mandar para muitos clientes (promoção, lista), explique em uma frase que isso arrisca bloquear o WhatsApp da loja e ofereça mandar para até 5 de cada vez. Não invente dados nem números. Depois diga em uma frase qual botão tocar, conforme o aviso que a ferramenta devolver ("Confirmar" ou "Enviar no WhatsApp").',
  '- Valores em reais no formato R$ 1.234,00. Datas e "hoje" no horário de Brasília.'
].join('\n');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ erro: 'Falta configurar ANTHROPIC_API_KEY na Vercel.' });

  const entrada = Array.isArray((req.body || {}).mensagens) ? req.body.mensagens : [];
  const mensagens = entrada.slice(-MAX_MENSAGENS)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
  if (!mensagens.length || mensagens[mensagens.length - 1].role !== 'user') return res.status(400).json({ erro: 'Mensagem vazia.' });

  const ferramentas = f.ferramentasDisponiveis();
  const conectados = 'Hoje é ' + rb.hojeBR() + ' (Brasília). Conectado: ' +
    [ferramentas.some((t) => t.name === 'site_listar_aparelhos') ? 'site' : null, ferramentas.some((t) => t.name === 'site_clientes_crm') ? 'CRM do site' : null, ferramentas.some((t) => t.name === 'os_listar') ? 'sistema de OS' : null].filter(Boolean).join(', ') + '.' +
    ' Equipe no WhatsApp: ' + (equipe.nomes() || 'ninguém cadastrado ainda (variável CENTRAL_EQUIPE na Vercel)') + '.';

  const client = new Anthropic();
  const conversa = mensagens.slice();
  const acoes = [];
  const usadas = new Set(); // ferramentas usadas: a tela acende os neurônios desses sistemas
  try {
    for (let rodada = 0; rodada < 8; rodada++) {
      const resp = await client.messages.create({
        model: MODELO,
        max_tokens: 4000,
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }, { type: 'text', text: conectados }],
        tools: ferramentas,
        messages: conversa
      });
      if (resp.stop_reason === 'refusal') return res.status(200).json({ resposta: 'Não posso ajudar com isso.', acoes, usadas: [...usadas] });
      if (resp.stop_reason !== 'tool_use') {
        const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return res.status(200).json({ resposta: texto || 'Pronto.', acoes, usadas: [...usadas] });
      }
      conversa.push({ role: 'assistant', content: resp.content });
      const resultados = await Promise.all(resp.content.filter((b) => b.type === 'tool_use').map(async (b) => {
        usadas.add(b.name);
        try {
          if (b.name === 'whatsapp_enviar') {
            if (acoes.filter((a) => a.whatsapp).length >= 5) throw new Error('limite de 5 mensagens por pedido, para não arriscar bloqueio do WhatsApp da loja. Diga ao dono para pedir o resto depois');
            const p = equipe.destino(b.input.para, b.input.nome);
            const msg = String(b.input.mensagem || '').trim().slice(0, 1500);
            if (!msg) throw new Error('mensagem vazia');
            const link = equipe.link(p.numero, msg);
            const linhas = (p.equipe ? [] : ['Para: ' + p.nome + ' · ' + equipe.formatar(p.numero)]).concat([msg]);
            if (whatsapp.ok()) { // envio automático ligado: sai sozinho depois do "Confirmar" (o botão manual fica de reserva)
              const token = auth.selar({ tipo: 'acao', uid: crypto.randomUUID(), nome: 'whatsapp_enviar', entrada: { nome: p.nome, numero: p.numero, mensagem: msg } }, 15);
              acoes.push({ token, titulo: 'Enviar WhatsApp para ' + p.nome, linhas, link, whatsapp: true });
              return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ aguardando_confirmacao: true, para: p.nome, aviso: 'Ainda NÃO foi enviado: o dono toca em "Confirmar" e a mensagem sai sozinha pelo WhatsApp da loja.' }) };
            }
            acoes.push({ tipo: 'whatsapp', titulo: 'WhatsApp para ' + p.nome, linhas, link, whatsapp: true });
            return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ pronto: true, para: p.nome, aviso: 'Apareceu na tela o botão "Enviar no WhatsApp". Ainda não foi enviado: o dono toca no botão e envia no WhatsApp.' }) };
          }
          if (f.NOMES_ALTERACAO.has(b.name)) {
            const p = await f.previa(b.name, b.input);
            const token = auth.selar({ tipo: 'acao', uid: crypto.randomUUID(), nome: b.name, entrada: b.input }, 15);
            acoes.push({ token, titulo: p.titulo, linhas: p.linhas });
            return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ aguardando_confirmacao: true, titulo: p.titulo, previa: p.linhas, aviso: 'Ainda NÃO foi feito: o dono precisa tocar em Confirmar.' }) };
          }
          const saida = await f.lerFerramenta(b.name, b.input);
          return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(saida).slice(0, 30000) };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: b.id, content: 'erro: ' + e.message, is_error: true };
        }
      }));
      conversa.push({ role: 'user', content: resultados });
    }
    return res.status(200).json({ resposta: 'Essa tarefa ficou grande demais para uma vez só. Pode dividir em partes?', acoes, usadas: [...usadas] });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ erro: 'Muitas requisições agora. Tente de novo em instantes.' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ erro: 'ANTHROPIC_API_KEY inválida.' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ erro: 'A IA está instável agora (' + e.status + ').' });
    return res.status(500).json({ erro: 'Erro: ' + e.message });
  }
};
