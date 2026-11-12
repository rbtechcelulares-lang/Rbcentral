// CRM do WhatsApp: a Z-API Omni manda cada mensagem do WhatsApp da loja para api/whatsapp-webhook,
// a Central guarda a conversa no Supabase do site (90 dias) e o Claude Haiku mantém a ficha de cada
// cliente: etapa, interesse, resumo, próximo passo e valor. Grupos e a equipe (CENTRAL_EQUIPE) ficam de fora.
// Variáveis (opcionais): CENTRAL_URL (padrão https://rbcentral.vercel.app), CENTRAL_LIMITE_CRM_IA (fichas por dia, padrão 300)
const { Anthropic } = require('@anthropic-ai/sdk');
const rb = require('./rb');
const auth = require('./auth');
const equipe = require('./equipe');
const whatsapp = require('./whatsapp');
const uso = require('./uso');

const ETAPAS = ['novo', 'em_atendimento', 'orcamento', 'negociando', 'comprou', 'perdido', 'pos_venda'];
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
  const numero = equipe.normalizar(quem && quem.identifier);
  if (!numero) return null;
  if (equipe.equipe().some((p) => p.numero === numero)) return null; // conversa com a equipe não entra no CRM
  const quando = Number(m.created || (m.metadata && m.metadata.moment)) || Date.now();
  return {
    id: String(m._id || numero + ':' + quando).slice(0, 80),
    numero,
    nome: deMim ? '' : String((m.sender && m.sender.name) || '').slice(0, 80),
    de_mim: deMim,
    texto,
    quando: new Date(quando).toISOString()
  };
}

// o corpo do webhook pode ser um evento ou uma lista de eventos
async function registrar(corpo) {
  const eventos = (Array.isArray(corpo) ? corpo : [corpo]).slice(0, 50);
  let n = 0;
  for (const ev of eventos) {
    const msg = lerMensagem(ev && (ev.message || ev));
    if (!msg) continue;
    await rb.rpcPainel('central_wa_registrar', { p_id: msg.id, p_numero: msg.numero, p_nome: msg.nome, p_de_mim: msg.de_mim, p_texto: msg.texto, p_quando: msg.quando });
    n++;
  }
  return n;
}

// ---------- leitura ----------
const listar = ({ filtro, busca, limite } = {}) => rb.rpcPainel('central_wa_listar', {
  p_filtro: ['todos', 'sem_resposta', 'para_analisar'].concat(ETAPAS).includes(filtro) ? filtro : 'todos',
  p_busca: String(busca || '').slice(0, 60),
  p_limite: Math.min(Math.max(parseInt(limite, 10) || 30, 1), 100)
});

async function conversa(numero, limite) {
  const n = equipe.normalizar(numero);
  if (!n) throw new Error('Número inválido.');
  return rb.rpcPainel('central_wa_conversa', { p_numero: n, p_limite: Math.min(Math.max(parseInt(limite, 10) || 30, 1), 80) });
}

// ---------- ficha feita pela IA ----------
const REGRAS_FICHA = [
  'Você mantém o CRM da RB Tech Celulares (loja de iPhones, celulares e assistência técnica em São José/SC).',
  'Leia a conversa de WhatsApp entre a loja e o cliente e preencha a ficha, usando só o que está na conversa.',
  'etapa: novo (só perguntou), em_atendimento (a loja está respondendo, sem proposta), orcamento (a loja passou preço ou orçamento), negociando (cliente discutindo preço, pagamento, reserva ou retirada), comprou (fechou a compra ou deixou o aparelho para conserto), perdido (desistiu, ou sumiu depois da proposta), pos_venda (depois da compra ou da entrega).',
  'interesse: o produto ou serviço em poucas palavras (ex.: "iPhone 13 128GB", "troca de tela Galaxy S21").',
  'resumo: 1 ou 2 frases sobre o que o cliente quer e em que pé está.',
  'proxima_acao: o que a loja deve fazer agora (ex.: "Responder o preço no Pix", "Confirmar a reserva para amanhã"); vazio se não houver nada.',
  'valor: o valor em reais cotado ou negociado (número); 0 se não houver.'
].join('\n');
const FORMATO_FICHA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { etapa: { type: 'string', enum: ETAPAS }, interesse: { type: 'string' }, resumo: { type: 'string' }, proxima_acao: { type: 'string' }, valor: { type: 'number' } },
    required: ['etapa', 'interesse', 'resumo', 'proxima_acao', 'valor'],
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
  return bloco ? JSON.parse(bloco.text) : null;
}

// atualiza as fichas dos contatos com mensagens novas (até `max` por vez, dentro do limite do dia)
async function analisarPendentes(max) {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const lista = await listar({ filtro: 'para_analisar', limite: Math.min(max || 5, 10) });
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
  const { r, d } = existente
    ? await whatsapp.omni('PATCH', base + '/' + encodeURIComponent(existente.id), Object.assign({ status: 'ENABLED' }, corpo))
    : await whatsapp.omni('POST', base, corpo);
  if (!r.ok) throw new Error('A Z-API não ligou o webhook: ' + whatsapp.erroOmni(r, d) + '.');
  return { ligado: true, url, atualizado: !!existente };
}

module.exports = { ETAPAS, ativo, lerMensagem, registrar, listar, conversa, analisarPendentes, ligarWebhook };
