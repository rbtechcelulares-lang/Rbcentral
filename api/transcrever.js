// Microfone da RB Central: recebe o áudio gravado no navegador e transcreve em duas etapas.
// 1) Whisper large-v3 da Groq (gratuito) passa a fala para texto. Variável na Vercel: GROQ_API_KEY.
// 2) Claude Haiku 5.5 revisa o texto conhecendo a loja (nomes, modelos de aparelho, valores, termos).
//    A API do Claude não recebe áudio, por isso ele entra depois do Whisper. Limite: 40 revisões por dia
//    (CENTRAL_LIMITE_VOZ_CLAUDE); passando disso, segue só com o Whisper grátis até o dia seguinte.
// POST { audio: base64, tipo: 'audio/webm' | 'audio/mp4' | ... } → { texto, motor: 'claude' | 'whisper', claude: { usados, limite } }
const { Anthropic } = require('@anthropic-ai/sdk');
const auth = require('../lib/auth');
const equipe = require('../lib/equipe');
const uso = require('../lib/uso');

const MODELO = process.env.GROQ_MODELO || 'whisper-large-v3';
const MAX_BYTES = 3 * 1024 * 1024;
// palavras da loja que o Whisper deve escrever certo
const VOCABULARIO = 'RB Tech Celulares, RB Central. OS, ordem de serviço, orçamento, iPhone 11, iPhone 13 Pro Max, iPhone 15, iPad, MacBook, Xiaomi, Redmi, Samsung Galaxy, Motorola, vitrine, CRM, Pix, peça, tela, bateria, conector de carga, fornecedor, meta, seminovo, garantia.';
const LIMITE_CLAUDE = Math.max(0, parseInt(process.env.CENTRAL_LIMITE_VOZ_CLAUDE || '40', 10) || 0);
const REVISOR = [
  'Você revisa transcrições automáticas de voz (Whisper) em português do Brasil. Quem fala é o dono da RB Tech Celulares, loja de iPhones, celulares e assistência técnica em São José/SC, fazendo um pedido ao assistente RB Central.',
  'Corrija só erros de reconhecimento: nomes de pessoas da equipe, modelos de aparelho (ex.: "iPhone 13 Pro Max", "Redmi Note 13", "Galaxy S23"), termos da loja (OS, ordem de serviço, orçamento, Pix, vitrine, CRM, peça, tela, bateria, conector de carga, fornecedor, meta, seminovo, garantia), números de OS, valores em reais (ex.: R$ 350,00), pontuação e maiúsculas.',
  'Não mude o sentido, não responda ao pedido, não resuma e não acrescente nada. Se o texto já estiver certo, devolva igual.'
].join('\n');
const FORMATO = { type: 'json_schema', schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'], additionalProperties: false } };

// Claude Haiku 5.5 corrige o texto do Whisper; devolve null se não der (aí fica o texto do Whisper)
async function revisarComClaude(texto, nomes) {
  const client = new Anthropic({ timeout: 8000, maxRetries: 1 });
  const r = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: FORMATO },
    system: REVISOR + (nomes ? '\nPessoas da equipe: ' + nomes + '.' : ''),
    messages: [{ role: 'user', content: '<transcricao>' + texto + '</transcricao>' }]
  });
  if (r.stop_reason !== 'end_turn') return null;
  const bloco = r.content.find((b) => b.type === 'text');
  if (!bloco) return null;
  const t = String(JSON.parse(bloco.text).texto || '').replace(/\s+/g, ' ').trim();
  // se mudou demais, ele provavelmente respondeu em vez de corrigir: fica o texto do Whisper
  if (!t || t.length > texto.length * 1.35 + 15 || t.length < texto.length * 0.5) return null;
  const original = new Set(palavras(texto));
  const novas = palavras(t);
  if (novas.length && novas.filter((w) => original.has(w)).length / novas.length < 0.5) return null;
  return t;
}
const palavras = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// frases que o Whisper às vezes "inventa" em trechos sem fala
const INVENTADAS = /^(legendas? (pela|por) comunidade amara\.org|obrigad[oa] (por assistir|pela aten[cç][aã]o)\.?|inscreva-se( no canal)?\.?|tchau,? tchau\.?|\.+)$/i;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  const chave = String(process.env.GROQ_API_KEY || '').trim();
  if (!chave) return res.status(501).json({ erro: 'Falta configurar GROQ_API_KEY na Vercel.' });

  const b = req.body || {};
  const audio = Buffer.from(String(b.audio || ''), 'base64');
  if (audio.length < 500) return res.status(400).json({ erro: 'Áudio vazio.' });
  if (audio.length > MAX_BYTES) return res.status(413).json({ erro: 'Áudio grande demais (fale até 1 minuto).' });
  const tipo = String(b.tipo || 'audio/webm').split(';')[0].toLowerCase();
  const ext = /mp4|m4a|aac/.test(tipo) ? 'm4a' : /ogg/.test(tipo) ? 'ogg' : /wav/.test(tipo) ? 'wav' : /mpeg|mp3/.test(tipo) ? 'mp3' : 'webm';

  const nomes = equipe.nomes();
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: tipo }), 'fala.' + ext);
  fd.append('model', MODELO);
  fd.append('language', 'pt');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  fd.append('prompt', VOCABULARIO + (nomes ? ' Nomes: ' + nomes + '.' : ''));
  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (d.error && d.error.message) || '';
      if (r.status === 401) return res.status(502).json({ erro: 'A GROQ_API_KEY está inválida.' });
      if (r.status === 429) return res.status(429).json({ erro: 'Limite grátis de transcrição atingido por agora. Tente de novo em alguns minutos.' });
      return res.status(502).json({ erro: 'A transcrição falhou (' + r.status + (m ? ': ' + m.slice(0, 120) : '') + ').' });
    }
    let texto = String(d.text || '').replace(/\s+/g, ' ').trim();
    if (INVENTADAS.test(texto)) texto = '';
    if (!texto || !process.env.ANTHROPIC_API_KEY) return res.status(200).json({ texto, motor: 'whisper' });
    // revisão do Claude: só dentro do limite do dia
    const cota = await uso.contar('voz_claude', LIMITE_CLAUDE);
    if (!cota.ok) return res.status(200).json({ texto, motor: 'whisper', claude: { usados: cota.usados, limite: cota.limite, esgotado: true } });
    let revisado = null;
    try { revisado = await revisarComClaude(texto, nomes); } catch (e) { revisado = null; }
    return res.status(200).json({ texto: revisado || texto, motor: revisado ? 'claude' : 'whisper', claude: { usados: cota.usados, limite: cota.limite } });
  } catch (e) {
    return res.status(502).json({ erro: 'Não consegui falar com o serviço de transcrição.' });
  }
};
