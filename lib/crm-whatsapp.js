// CRM do WhatsApp: a Z-API Omni manda cada mensagem do WhatsApp da loja para api/whatsapp-webhook,
// a Central guarda a conversa no Supabase do site (90 dias) e o Claude Haiku mantém a ficha de cada
// cliente: tipo, etapa, interesse, resumo, próximo passo e valor. Grupos e a equipe (CENTRAL_EQUIPE) ficam de fora.
// O CRM mostra só quem quer COMPRAR iPhone; quem vende para a loja, cliente de reparo e outros assuntos
// ficam guardados (aba "Outros"), sem próximo passo: a loja não precisa mandar nada para eles.
// Variáveis (opcionais): CENTRAL_URL (padrão https://rbcentral.vercel.app), CENTRAL_LIMITE_CRM_IA (fichas por dia, padrão 300)
const { Anthropic } = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const rb = require('./rb');
const auth = require('./auth');
const equipe = require('./equipe');
const whatsapp = require('./whatsapp');
const uso = require('./uso');

const ETAPAS = ['novo', 'em_atendimento', 'orcamento', 'negociando', 'fechado', 'comprou', 'perdido', 'pos_venda'];
// em que pé está o cliente (calculado no Supabase pelos horários das mensagens): ver central_wa_situacao
const SITUACOES = ['loja_sem_responder', 'aguardando_loja', 'cliente_sumiu', 'fechado', 'nao_buscou', 'comprou', 'perdido', 'em_conversa'];
const TIPOS = ['compra_iphone', 'vende_para_loja', 'reparo', 'outro'];
const LIMITE_IA = () => Math.max(0, parseInt(process.env.CENTRAL_LIMITE_CRM_IA || '300', 10) || 0);
const baseUrl = () => String(process.env.CENTRAL_URL || 'https://rbcentral.vercel.app').replace(/\/+$/, '');
const ativo = () => whatsapp.caminho() === 'zapi' && rb.githubOk() && rb.supabaseOk();

// ---------- mensagem que chegou pelo webhook → { id, numero, nome, de_mim, texto, quando } ----------
const ROTULO_ANEXO = { IMAGE: '[foto]', AUDIO: '[áudio]', VIDEO: '[vídeo]', STICKER: '[figurinha]', DOCUMENT: '[documento]', FILE: '[arquivo]' };
function lerMensagem(m) {
  if (!m || typeof m !== 'object') return null;
  const itens = [].concat(m.contents || [], m.attachments || []).filter((x) => x && typeof x === 'object');
  if (itens.some((x) => x.internal_information && x.internal_information.group_id)) return null; // grupo
  const partes = [];
  (m.contents || []).forEach((c) => {
    if (!c || c.type === 'MessageStatusCallback') return;
    if (typeof c.message === 'string' && c.message.trim()) partes.push(c.message.trim());
    else if (c.type === 'CONTACT_ARRAY') partes.push('[contato]');
    else if (c.type) partes.push('[' + String(c.type).toLowerCase() + ']');
  });
  (m.attachments || []).forEach((a) => {
    if (!a) return;
    partes.push((ROTULO_ANEXO[a.type] || '[anexo]') + (typeof a.caption === 'string' && a.caption.trim() ? ' ' + a.caption.trim() : ''));
  });
  const texto = partes.join('\n').trim().slice(0, 4000);
  if (!texto) return null; // só status de entrega/leitura
  const deMim = !!(m.metadata && m.metadata.from_me);
  const quem = deMim ? m.recipient : m.sender;
  const ident = String((quem && quem.identifier) || '');
  if (/@lid\b|@g\.us\b/i.test(ident)) return null; // identificador sem telefone, ou grupo
  const numero = equipe.normalizar(ident.split('@')[0]);
  if (!numero) return null;
  if (equipe.equipe().some((p) => p.numero === numero)) return null; // conversa com a equipe não entra no CRM
  const quando = Number(m.created || (m.metadata && m.metadata.moment)) || Date.now();
  // código que o site põe na mensagem pronta ("Ref. RB-7K2Q9X"): liga o número à visita no site
  const ref = deMim ? null : texto.match(/\bRB-?([A-Z0-9]{6})\b/i);
  return {
    codigo: ref ? ref[1].toUpperCase() : '',
    id: String(m._id || numero + ':' + quando).slice(0, 80),
    numero,
    nome: deMim ? '' : String((m.sender && m.sender.name) || '').slice(0, 80),
    de_mim: deMim,
    texto,
    quando: new Date(quando).toISOString()
  };
}

// acha as mensagens dentro do corpo do webhook: um evento, uma lista, ou a sincronização inicial (INITIAL_DATA)
function coletar(no, saida, nivel) {
  if (!no || typeof no !== 'object' || nivel > 5 || saida.length >= 300) return saida;
  if (Array.isArray(no)) { no.forEach((x) => coletar(x, saida, nivel + 1)); return saida; }
  if ((no.contents || no.attachments) && (no.sender || no.recipient)) { saida.push(no); return saida; }
  Object.values(no).forEach((v) => { if (v && typeof v === 'object') coletar(v, saida, nivel + 1); });
  return saida;
}

async function registrar(corpo) {
  const msgs = coletar(corpo, [], 0).map(lerMensagem).filter(Boolean);
  let n = 0;
  for (let i = 0; i < msgs.length; i += 10) { // de 10 em 10, para responder à Z-API em menos de 5 s
    await Promise.all(msgs.slice(i, i + 10).map(async (msg) => {
      await rb.rpcPainel('central_wa_registrar', { p_id: msg.id, p_numero: msg.numero, p_nome: msg.nome, p_de_mim: msg.de_mim, p_texto: msg.texto, p_quando: msg.quando });
      if (msg.codigo) await rb.rpcPainel('central_wa_vincular', { p_numero: msg.numero, p_codigo: msg.codigo }).catch(() => false); // SQL antigo: segue sem ligar
      n++;
    }));
  }
  return n;
}

// ---------- leitura ----------
// tipo: 'compra_iphone' (padrão: só quem quer comprar iPhone), 'outros' (vende para a loja, reparo, outro) ou 'todos'
let semTipo = false; // true = o SQL com a separação por tipo ainda não foi rodado (mostra todo mundo, como antes)
async function listar({ filtro, busca, limite, tipo } = {}) {
  const corpo = {
    p_filtro: ['todos', 'sem_resposta', 'para_analisar'].concat(ETAPAS, SITUACOES).includes(filtro) ? filtro : 'todos',
    p_busca: String(busca || '').slice(0, 60),
    p_limite: Math.min(Math.max(parseInt(limite, 10) || 30, 1), 100)
  };
  const t = ['compra_iphone', 'outros', 'todos'].includes(tipo) ? tipo : 'compra_iphone';
  try {
    const l = await rb.rpcPainel('central_wa_listar', Object.assign({}, corpo, { p_tipo: t }));
    semTipo = false;
    return l;
  } catch (e) {
    if (!/falta rodar o SQL/.test(e.message)) throw e;
    const l = await rb.rpcPainel('central_wa_listar', corpo); // SQL antigo: sem a coluna tipo
    semTipo = true;
    return t === 'outros' ? [] : l;
  }
}
const precisaSql = () => semTipo;

// venda registrada (pelo sistema de OS ou pela Central) para este WhatsApp: o cliente vira "comprou" no funil
async function marcarVenda(numero) {
  const n = equipe.normalizar(numero);
  if (!n || !rb.githubOk() || !rb.supabaseOk()) return false;
  return rb.rpcPainel('central_wa_venda', { p_numero: n }).catch(() => false);
}

async function conversa(numero, limite) {
  const n = equipe.normalizar(numero);
  if (!n) throw new Error('Número inválido.');
  return rb.rpcPainel('central_wa_conversa', { p_numero: n, p_limite: Math.min(Math.max(parseInt(limite, 10) || 30, 1), 80) });
}

// ---------- ficha feita pela IA ----------
const REGRAS_FICHA = [
  'Você mantém o CRM da RB Tech Celulares (loja de iPhones, celulares e assistência técnica em São José/SC).',
  'Leia a conversa de WhatsApp entre a loja e a pessoa e preencha a ficha, usando só o que está na conversa.',
  'tipo (o mais importante: o CRM mostra só compra_iphone):',
  '- compra_iphone: a pessoa quer COMPRAR um iPhone da loja (ou um celular sem dizer a marca). Conta também quem quer dar o aparelho dela como parte do pagamento de um iPhone, e quem já comprou um iPhone e está no pós-venda.',
  '- vende_para_loja: a loja é que está comprando: a pessoa oferece ou vende para a loja um aparelho, peça ou produto (fornecedor, ou alguém vendendo o próprio celular sem comprar outro).',
  '- reparo: conserto, assistência técnica, orçamento de reparo, aparelho deixado na loja, garantia de conserto.',
  '- outro: qualquer outra coisa (comprar acessório ou aparelho que não é iPhone, assunto pessoal, cobrança, propaganda) ou quando não dá para saber.',
  'Se a pessoa tem mais de um assunto e um deles é comprar iPhone (ex.: deixou o celular no conserto e também quer comprar um iPhone), use compra_iphone.',
  'etapa: novo (só perguntou), em_atendimento (a loja está respondendo, sem proposta), orcamento (a loja passou preço ou orçamento), negociando (cliente discutindo preço, pagamento, entrada ou parcelas), fechado (o cliente FECHOU: pediu para separar ou reservar, disse "vou levar", combinou dia de buscar ou de pagar, mas a conversa ainda não mostra que pagou e retirou), comprou (pagou e retirou, ou a conversa mostra que a compra foi concluída; ou deixou o aparelho para conserto), perdido (desistiu, comprou em outro lugar, ou sumiu depois da proposta), pos_venda (depois da compra ou da entrega).',
  'retirada_em: só quando o cliente combinou um dia para buscar ou pagar, a data AAAA-MM-DD desse dia (use a data de hoje para entender "amanhã", "sábado", "dia 20"); vazio se não combinou.',
  'interesse: o produto ou serviço em poucas palavras (ex.: "iPhone 13 128GB", "troca de tela Galaxy S21").',
  'resumo: 1 ou 2 frases sobre o que o cliente quer e em que pé está.',
  'proxima_acao: só para compra_iphone, o que a loja deve fazer agora para vender (ex.: "Responder o preço no Pix", "Confirmar a reserva para amanhã", "Lembrar que o aparelho está separado"); vazio se não houver nada. Para os outros tipos, sempre vazio: a loja não precisa mandar nada.',
  'valor: o valor em reais cotado ou negociado (número); 0 se não houver.'
].join('\n');
const FORMATO_FICHA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { tipo: { type: 'string', enum: TIPOS }, etapa: { type: 'string', enum: ETAPAS }, interesse: { type: 'string' }, resumo: { type: 'string' }, proxima_acao: { type: 'string' }, valor: { type: 'number' }, retirada_em: { type: 'string' } },
    required: ['tipo', 'etapa', 'interesse', 'resumo', 'proxima_acao', 'valor', 'retirada_em'],
    additionalProperties: false
  }
};
const dataBR = (iso) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace(/^(\d\d)-(\d\d)/, '$2/$1');

async function fichaComIA(conv) {
  const c = conv.contato || {};
  const linhas = (conv.mensagens || []).map((m) => '[' + dataBR(m.criado) + '] ' + (m.de_mim ? 'Loja' : 'Cliente') + ': ' + String(m.texto).replace(/\s+/g, ' ').slice(0, 500));
  const client = new Anthropic({ timeout: 15000, maxRetries: 1 });
  const r = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 800,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: FORMATO_FICHA },
    system: REGRAS_FICHA,
    messages: [{ role: 'user', content: 'Cliente: ' + (c.nome || 'sem nome') + '\nHoje: ' + dataBR(new Date().toISOString()) + '\n<conversa>\n' + linhas.join('\n') + '\n</conversa>' }]
  });
  if (r.stop_reason !== 'end_turn') return null;
  const bloco = r.content.find((b) => b.type === 'text');
  if (!bloco) return null;
  const ficha = JSON.parse(bloco.text);
  if (ficha.tipo !== 'compra_iphone') ficha.proxima_acao = ''; // não é venda de iPhone: nada para mandar
  return ficha;
}

// ---------- por que o cliente não fechou ----------
const MOTIVOS_PERDA = {
  preco: 'Preço / achou caro',
  pagamento: 'Forma de pagamento (parcelas, cartão, entrada)',
  troca: 'Valor da troca / avaliação do usado',
  estoque: 'Não tinha o modelo, cor ou capacidade',
  aparelho: 'Estado do aparelho (bateria, seminovo, detalhes)',
  confianca: 'Garantia, procedência ou confiança',
  concorrente: 'Comprou em outro lugar',
  demora_loja: 'Demora da loja para responder',
  entrega: 'Prazo, entrega ou distância',
  desistiu: 'Desistiu / não precisa mais',
  sumiu: 'Sumiu sem dar pista',
  outro: 'Outro'
};
const REGRAS_MOTIVO = [
  'Você analisa vendas perdidas da RB Tech Celulares (loja de iPhones em São José/SC).',
  'Leia a conversa de WhatsApp entre a loja e um cliente que queria comprar iPhone e NÃO fechou, e diga o motivo principal.',
  'motivo (um só): ' + Object.entries(MOTIVOS_PERDA).map(([k, v]) => k + ' = ' + v).join('; ') + '.',
  'Se o cliente disse o motivo, use certeza "certo". Se ele só parou de responder, deduza pelo que aconteceu antes (ex.: sumiu logo depois de receber o preço = preco; pediu parcelamento que a loja não fez = pagamento; a loja levou horas para responder = demora_loja) e use certeza "provavel". Use sumiu só quando não houver nenhuma pista.',
  'detalhe: uma frase curta e concreta com o que aconteceu (ex.: "Achou por R$ 2.600 em outra loja", "Queria em 12x sem juros", "Esperou 5 h pela resposta"). Use só o que está na conversa.'
].join('\n');
const FORMATO_MOTIVO = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { motivo: { type: 'string', enum: Object.keys(MOTIVOS_PERDA) }, detalhe: { type: 'string' }, certeza: { type: 'string', enum: ['certo', 'provavel'] } },
    required: ['motivo', 'detalhe', 'certeza'],
    additionalProperties: false
  }
};

async function motivoComIA(conv) {
  const c = conv.contato || {};
  const linhas = (conv.mensagens || []).map((m) => '[' + dataBR(m.criado) + '] ' + (m.de_mim ? 'Loja' : 'Cliente') + ': ' + String(m.texto).replace(/\s+/g, ' ').slice(0, 500));
  const client = new Anthropic({ timeout: 15000, maxRetries: 1 });
  const r = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 400,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: FORMATO_MOTIVO },
    system: REGRAS_MOTIVO,
    messages: [{ role: 'user', content: 'Cliente: ' + (c.nome || 'sem nome') + ' · interesse: ' + (c.interesse || '?') + '\nHoje: ' + dataBR(new Date().toISOString()) + '\n<conversa>\n' + linhas.join('\n') + '\n</conversa>' }]
  });
  if (r.stop_reason !== 'end_turn') return null;
  const bloco = r.content.find((b) => b.type === 'text');
  return bloco ? JSON.parse(bloco.text) : null;
}

// classifica os clientes perdidos que ainda não têm motivo (até `max` por vez, dentro do limite do dia)
async function analisarPerdas(max) {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const lista = await listar({ filtro: 'perda_sem_motivo', tipo: 'compra_iphone', limite: Math.min(max || 5, 10) }).catch(() => []);
  let feitas = 0;
  await Promise.all((Array.isArray(lista) ? lista : []).filter((c) => c.situacao === 'perdido' && !c.motivo_perda).map(async (c) => {
    const cota = await uso.contar('crm_ia', LIMITE_IA());
    if (!cota.ok) return;
    try {
      const m = await motivoComIA(await conversa(c.numero, 30));
      if (!m) return;
      await rb.rpcPainel('central_wa_salvar_motivo', { p_numero: c.numero, p_dados: m });
      feitas++;
    } catch (e) { /* tenta na próxima vez */ }
  }));
  return feitas;
}

// relatório: por que os clientes de iPhone não fecharam nos últimos `dias` (classifica os que faltam antes)
async function relatorioPerdas(dias) {
  await analisarPerdas(8).catch(() => 0);
  const r = await rb.rpcPainel('central_wa_relatorio_perdas', { p_dias: Math.min(Math.max(parseInt(dias, 10) || 30, 1), 90) });
  (r && r.motivos || []).forEach((m) => { m.nome = MOTIVOS_PERDA[m.motivo] || m.motivo; });
  return r;
}

// ---------- responder direto do CRM ----------
// O dono escreve (ou pede uma sugestão à IA) e toca em Enviar: sai pelo WhatsApp da loja na hora e já
// entra na conversa (o eco do webhook com o mesmo texto não duplica, pelo SQL).
async function responder(numero, mensagem) {
  const n = equipe.normalizar(numero);
  if (!n) throw new Error('Número inválido.');
  const msg = String(mensagem || '').replace(/\r/g, '').trim();
  if (!msg) throw new Error('Escreva a mensagem.');
  if (msg.length > 1500) throw new Error('Mensagem longa demais (máximo 1500 letras).');
  if (!whatsapp.ok()) return { enviado: false, link: equipe.link(n, msg) }; // sem Z-API: abre o WhatsApp com o texto
  const r = await whatsapp.enviar(n, msg);
  const quando = new Date().toISOString();
  const id = String((r && r.id) || 'central-' + crypto.randomBytes(8).toString('hex')).slice(0, 80);
  await rb.rpcPainel('central_wa_registrar', { p_id: id, p_numero: n, p_nome: '', p_de_mim: true, p_texto: msg, p_quando: quando }).catch(() => null);
  console.log('rb-central crm-resposta', JSON.stringify({ quando, para: n.slice(0, 4) + '…' + n.slice(-4) }));
  return { enviado: true, mensagem: { de_mim: true, texto: msg, criado: quando } };
}

const REGRAS_RESPOSTA = [
  'Você escreve, em nome da RB Tech Celulares (loja de iPhones, celulares e assistência técnica em São José/SC), a próxima mensagem de WhatsApp da loja para esta pessoa.',
  'Português do Brasil, cordial e direto, como um bom vendedor: no máximo 4 linhas, no máximo 1 emoji, sem formalidade exagerada.',
  'Responda ao que a pessoa falou por último. Se ela sumiu depois da última mensagem da loja, retome o assunto com leveza, sem pressão.',
  'Preços e aparelhos: use SÓ os da lista de aparelhos do site (preço à vista; diga que também dá para parcelar no cartão se ela perguntar). Se o que ela quer não está na lista, diga que vai verificar a disponibilidade e já retorna.',
  'Nunca invente prazo, estoque, valor de troca, desconto, garantia diferente ou endereço. Não prometa o que não está na conversa nem na lista.',
  'Sem markdown. Para destacar, use *texto* (negrito do WhatsApp). Responda só com o texto da mensagem, sem aspas e sem explicação.'
].join('\n');

async function sugerirResposta(numero) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('A IA não está configurada (ANTHROPIC_API_KEY).');
  const cota = await uso.contar('crm_ia', LIMITE_IA());
  if (!cota.ok) throw new Error('Acabaram as leituras da IA de hoje (limite CENTRAL_LIMITE_CRM_IA). Escreva a resposta à mão.');
  const conv = await conversa(numero, 30);
  const c = conv.contato || {};
  let estoque = '';
  try {
    const l = await rb.listarAparelhos({ busca: '' });
    estoque = (l.aparelhos || []).filter((a) => a.no_catalogo || a.vitrine || a.topo).slice(0, 60)
      .map((a) => '- ' + a.aparelho + ' ' + a.cor + ' · ' + a.condicao + (a.bateria ? ' · bateria ' + a.bateria : '') + ' · ' + a.preco + (a.sob_encomenda ? ' · sob encomenda' : '')).join('\n');
  } catch (e) { /* sem a lista, a IA diz que vai verificar */ }
  const linhas = (conv.mensagens || []).map((m) => '[' + dataBR(m.criado) + '] ' + (m.de_mim ? 'Loja' : 'Cliente') + ': ' + String(m.texto).replace(/\s+/g, ' ').slice(0, 500));
  const client = new Anthropic({ timeout: 20000, maxRetries: 1 });
  const r = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 500,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: REGRAS_RESPOSTA,
    messages: [{ role: 'user', content: 'Pessoa: ' + (c.nome || 'sem nome') + (c.interesse ? ' · interesse: ' + c.interesse : '') + (c.resumo ? '\nResumo: ' + c.resumo : '') +
      '\nHoje: ' + dataBR(new Date().toISOString()) + '\n<aparelhos_do_site>\n' + (estoque || '(lista indisponível agora)') + '\n</aparelhos_do_site>\n<conversa>\n' + linhas.join('\n') + '\n</conversa>' }]
  });
  if (r.stop_reason === 'refusal') throw new Error('A IA não quis sugerir essa resposta. Escreva à mão.');
  const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim().replace(/^["“]|["”]$/g, '');
  if (!t) throw new Error('A IA não conseguiu sugerir agora. Tente de novo.');
  return { sugestao: t.slice(0, 1500) };
}

// atualiza as fichas dos contatos com mensagens novas (até `max` por vez, dentro do limite do dia)
async function analisarPendentes(max) {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const lista = await listar({ filtro: 'para_analisar', tipo: 'todos', limite: Math.min(max || 5, 10) });
  let feitas = 0;
  await Promise.all((Array.isArray(lista) ? lista : []).map(async (c) => {
    const cota = await uso.contar('crm_ia', LIMITE_IA());
    if (!cota.ok) return;
    try {
      const conv = await conversa(c.numero, 25);
      const ficha = await fichaComIA(conv);
      if (!ficha) return;
      await rb.rpcPainel('central_wa_salvar_analise', { p_numero: c.numero, p_dados: ficha });
      feitas++;
    } catch (e) { /* tenta na próxima vez */ }
  }));
  return feitas;
}

// ---------- ligar o webhook na Z-API Omni (cria ou atualiza; não duplica) ----------
async function ligarWebhook() {
  if (whatsapp.caminho() !== 'zapi') throw new Error('Primeiro ligue a Z-API Omni (ZAPI_OMNI_KEY e ZAPI_OMNI_CANAL na Vercel).');
  if (!auth.tokenWebhook()) throw new Error('A Central ainda não tem segredo configurado.');
  const canal = await whatsapp.canalOmni();
  const url = baseUrl() + '/api/whatsapp-webhook';
  const corpo = {
    url,
    description: 'RB Central: CRM do WhatsApp',
    events: ['MESSAGE_RECEIVED', 'MESSAGE_DELIVERY'],
    auth: { type: 'BEARER', token: auth.tokenWebhook() },
    payloadFormat: 'DEFAULT'
  };
  const base = '/v1/channels/' + encodeURIComponent(canal) + '/webhooks';
  const lista = await whatsapp.omni('GET', base);
  const itens = Array.isArray(lista.d) ? lista.d : Array.isArray(lista.d && lista.d.content) ? lista.d.content : [];
  const existente = lista.r.ok ? itens.find((w) => w && w.url === url) : null;
  const enviar = () => (existente
    ? whatsapp.omni('PATCH', base + '/' + encodeURIComponent(existente.id), Object.assign({ status: 'ENABLED' }, corpo))
    : whatsapp.omni('POST', base, corpo));
  let { r, d } = await enviar();
  // a Z-API recusa eventos que o tipo de canal não tem (ex.: "Events [X] are not supported by middleware Z_API_WHATSAPP"):
  // tira esses eventos e tenta de novo uma vez
  const recusados = !r.ok && String((d && (d.message || d.error)) || '').match(/Events?\s*\[([^\]]+)\]\s*(?:is|are) not supported/i);
  if (recusados) {
    const fora = recusados[1].split(',').map((x) => x.trim().toUpperCase());
    corpo.events = corpo.events.filter((e) => !fora.includes(e));
    if (corpo.events.length) ({ r, d } = await enviar());
  }
  if (!r.ok) throw new Error('A Z-API não ligou o webhook: ' + whatsapp.erroOmni(r, d) + '.');
  return { ligado: true, url, atualizado: !!existente, eventos: corpo.events };
}

// confere, item por item, o que falta para o CRM receber as mensagens
async function diagnostico() {
  const itens = [];
  const url = baseUrl() + '/api/whatsapp-webhook';
  const zapi = whatsapp.caminho() === 'zapi';
  itens.push({ ok: zapi, texto: zapi ? 'Z-API Omni ligada (ZAPI_OMNI_KEY)' : 'Falta a ZAPI_OMNI_KEY na Vercel' });
  let canal = '';
  if (zapi) {
    try { canal = await whatsapp.canalOmni(); itens.push({ ok: true, texto: 'Canal do WhatsApp configurado (ZAPI_OMNI_CANAL)' }); } catch (e) { itens.push({ ok: false, texto: e.message.replace(/^WhatsApp não enviou: /, '') }); }
  }
  const supa = rb.githubOk() && rb.supabaseOk();
  itens.push({ ok: supa, texto: supa ? 'Supabase do site ligado (RB_PAINEL_CHAVE)' : 'Falta RB_GITHUB_TOKEN ou RB_PAINEL_CHAVE na Vercel' });
  if (supa) {
    try {
      const l = await listar({ filtro: 'todos', tipo: 'todos', limite: 100 });
      itens.push({ ok: true, texto: 'SQL do CRM rodado · ' + l.length + (l.length === 1 ? ' contato guardado' : ' contatos guardados') });
      if (semTipo) itens.push({ ok: false, texto: 'Falta rodar de novo o SQL (supabase/central_conversas.sql) para o CRM mostrar só quem quer comprar iPhone' });
    } catch (e) { itens.push({ ok: false, texto: 'SQL do CRM: ' + e.message }); }
  }
  if (canal) {
    const { r, d } = await whatsapp.omni('GET', '/v1/channels/' + encodeURIComponent(canal) + '/webhooks');
    const lista = Array.isArray(d) ? d : Array.isArray(d && d.content) ? d.content : [];
    if (!r.ok) itens.push({ ok: false, texto: 'Não consegui ler os webhooks na Z-API: ' + whatsapp.erroOmni(r, d) });
    else {
      const w = lista.find((x) => x && x.url === url);
      if (!w) itens.push({ ok: false, texto: 'O webhook ainda não está cadastrado na Z-API: toque em "Ligar a leitura do WhatsApp"' + (lista.length ? ' (a Z-API tem ' + lista.length + ' webhook(s) com outro endereço)' : '') });
      else itens.push({ ok: w.status !== 'DISABLED', texto: 'Webhook cadastrado na Z-API · ' + (w.status === 'DISABLED' ? 'PAUSADO: toque em "Ligar a leitura do WhatsApp"' : 'ativo') + ' · eventos: ' + (w.events || []).join(', ') });
    }
  }
  return { url, itens };
}

module.exports = { ETAPAS, TIPOS, SITUACOES, MOTIVOS_PERDA, ativo, precisaSql, marcarVenda, analisarPerdas, relatorioPerdas, responder, sugerirResposta, lerMensagem, coletar, registrar, listar, conversa, analisarPendentes, ligarWebhook, diagnostico };
