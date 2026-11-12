// Microfone da RB Central: recebe o áudio gravado no navegador e transcreve com o Whisper large-v3
// da Groq (gratuito, muito bom em português). Variável na Vercel: GROQ_API_KEY (console.groq.com › API Keys).
// POST { audio: base64, tipo: 'audio/webm' | 'audio/mp4' | ... } → { texto }
const auth = require('../lib/auth');
const equipe = require('../lib/equipe');

const MODELO = process.env.GROQ_MODELO || 'whisper-large-v3';
const MAX_BYTES = 3 * 1024 * 1024;
// palavras da loja que o Whisper deve escrever certo
const VOCABULARIO = 'RB Tech Celulares, RB Central. OS, ordem de serviço, orçamento, iPhone 11, iPhone 13 Pro Max, iPhone 15, iPad, MacBook, Xiaomi, Redmi, Samsung Galaxy, Motorola, vitrine, CRM, Pix, peça, tela, bateria, conector de carga, fornecedor, meta, seminovo, garantia.';
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
  fd.append('prompt', VOCABULARIO + (nomes ? ' Equipe: ' + nomes + '.' : ''));
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
    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(502).json({ erro: 'Não consegui falar com o serviço de transcrição.' });
  }
};
