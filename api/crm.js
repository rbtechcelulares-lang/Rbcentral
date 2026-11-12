// CRM do WhatsApp na tela da Central.
// GET ?filtro=sem_resposta|todos|<etapa>&tipo=compra_iphone|outros&busca= → { ativo, contatos, precisa_sql }
// POST { acao: 'conversa', numero } · { acao: 'analisar' } · { acao: 'ligar' }
const auth = require('../lib/auth');
const crm = require('../lib/crm-whatsapp');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const contatos = await crm.listar({ filtro: q.filtro, busca: q.busca, tipo: q.tipo === 'outros' ? 'outros' : 'compra_iphone', limite: 50 });
      return res.status(200).json({ ativo: crm.ativo(), contatos, precisa_sql: crm.precisaSql() });
    }
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    if (b.acao === 'conversa') return res.status(200).json(await crm.conversa(b.numero, 40));
    if (b.acao === 'analisar') {
      // primeiro as conversas com mensagem nova; sobrando vez, o motivo de quem não fechou
      const n = await crm.analisarPendentes(6);
      return res.status(200).json({ analisados: n + (n < 6 ? await crm.analisarPerdas(Math.min(4, 6 - n)).catch(() => 0) : 0) });
    }
    if (b.acao === 'ligar') return res.status(200).json(await crm.ligarWebhook());
    if (b.acao === 'diagnostico') return res.status(200).json(await crm.diagnostico());
    return res.status(400).json({ erro: 'Ação desconhecida.' });
  } catch (e) {
    if (req.method === 'GET') return res.status(200).json({ ativo: crm.ativo(), contatos: [], motivo: e.message });
    return res.status(502).json({ erro: e.message });
  }
};
