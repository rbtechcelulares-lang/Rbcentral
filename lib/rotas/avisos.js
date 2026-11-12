// Avisos de status de OS esperando a confirmação do dono.
// GET → { avisos: [{ id, titulo, linhas, criado }] } · POST { acao: 'enviar' | 'descartar', id }
const auth = require('../auth');
const avisos = require('../avisos');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ avisos: await avisos.listar() });
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    const id = String(b.id || '');
    if (!/^[a-z0-9]{8,32}$/.test(id)) return res.status(400).json({ erro: 'Aviso inválido.' });
    if (b.acao === 'enviar') return res.status(200).json(await avisos.enviar(id));
    if (b.acao === 'descartar') return res.status(200).json(await avisos.descartar(id));
    return res.status(400).json({ erro: 'Ação desconhecida.' });
  } catch (e) {
    if (req.method === 'GET') return res.status(200).json({ avisos: [], motivo: e.message });
    return res.status(502).json({ erro: e.message });
  }
};
