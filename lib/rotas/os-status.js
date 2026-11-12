// O sistema de OS chama aqui quando uma OS da loja muda de status: a Central monta o aviso para o cliente
// e deixa pendente para o dono confirmar na Central (botão "Enviar").
// POST { "os_id": "<id da OS>" } com Authorization: Bearer <a mesma chave SAAS_API_TOKEN combinada com o sistema>.
// A Central lê a OS de novo pela API do sistema (só da loja SAAS_LOJA) antes de montar qualquer aviso.
// Resposta: { pendente: true, aviso: { id, titulo, linhas } } ou { pendente: false, motivo }
const crypto = require('crypto');
const avisos = require('../avisos');

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
    const b = req.body || {};
    const mensagem = typeof b.mensagem === 'string' ? b.mensagem.replace(/\r/g, '').trim().slice(0, 1500) : '';
    // "ja_enviado": true = o sistema já mandou pelo botão dele; a Central só registra, sem pôr na lista
    return res.status(200).json(await avisos.prepararAviso(osId, b.ja_enviado === true, mensagem));
  } catch (e) {
    return res.status(502).json({ pendente: false, motivo: e.message });
  }
};
