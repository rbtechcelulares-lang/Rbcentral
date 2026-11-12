// O sistema de OS chama aqui quando uma OS da loja fica pronta: a Central avisa o cliente pelo WhatsApp da loja.
// POST { "os_id": "<id da OS>" } com Authorization: Bearer <a mesma chave SAAS_API_TOKEN combinada com o sistema>.
// A Central lê a OS de novo pela API do sistema (só da loja SAAS_LOJA) antes de mandar qualquer coisa.
// Resposta: { enviado: true, para, mensagem } ou { enviado: false, motivo }
const crypto = require('crypto');
const avisos = require('../lib/avisos');

const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  const chave = String(process.env.SAAS_API_TOKEN || '').trim();
  const recebida = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!chave || !recebida || !igual(recebida, chave)) return res.status(401).json({ erro: 'Chave inválida.' });
  const osId = String((req.body || {}).os_id || '').trim().slice(0, 60);
  if (!osId) return res.status(400).json({ erro: 'Falta o os_id.' });
  try {
    return res.status(200).json(await avisos.avisarOsPronta(osId, 'sistema'));
  } catch (e) {
    return res.status(502).json({ enviado: false, motivo: e.message });
  }
};
