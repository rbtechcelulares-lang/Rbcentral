// Pedidos de peças na tela da Central (só o dono logado). Os toques do dono no painel valem como confirmação.
// GET ?status=abertos|todos|<status>&busca= → { pedidos, fornecedores, status }
// POST { acao: 'mensagem', id, tipo: 'cotar'|'pedir' } → { cartao }   cartão de um toque para o fornecedor
//      { acao: 'status', id, status }                       → { pedido } muda o status (ex.: chegou)
//      { acao: 'adicionar', dados }                         → { pedido } novo pedido (dados do formulário)
const auth = require('../auth');
const pecas = require('../pecas');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  if (!pecas.ativo()) return res.status(200).json({ pedidos: [], fornecedores: [], motivo: 'Falta ligar o Supabase do site na Central (RB_GITHUB_TOKEN e RB_PAINEL_CHAVE na Vercel).' });
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const [pedidos, fornecedores] = await Promise.all([pecas.listar({ status: q.status, busca: q.busca, limite: 60 }), pecas.fornecedores()]);
      return res.status(200).json({ pedidos, fornecedores, status: pecas.STATUS });
    }
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    if (b.acao === 'mensagem') return res.status(200).json({ cartao: await pecas.cartaoMensagem(b.id, b.tipo) });
    if (b.acao === 'status') return res.status(200).json({ pedido: (await pecas.atualizar({ pedido: b.id, status: b.status })).depois });
    if (b.acao === 'adicionar') return res.status(200).json({ pedido: await pecas.adicionar(b.dados || {}) });
    return res.status(400).json({ erro: 'Ação desconhecida.' });
  } catch (e) {
    const sql = /falta rodar o SQL|não existe/i.test(e.message);
    return res.status(sql ? 200 : 400).json(sql ? { pedidos: [], fornecedores: [], motivo: 'Falta rodar de novo o SQL da Central no Supabase (supabase/central_conversas.sql): ele cria a lista de pedidos de peças.' } : { erro: e.message });
  }
};
