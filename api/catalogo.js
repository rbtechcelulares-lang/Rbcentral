// Painel de aparelhos do site na Central (só o dono logado).
// GET  → { aparelhos, cores, condicoes, promocao_id }  (o catálogo como está publicado)
// POST { alteracoes: [...], publicar: false } → { linhas }  prévia, não grava nada
// POST { alteracoes: [...], publicar: true }  → { feito }   publica tudo num commit só (como o Publicar do admin)
// alteracoes: [{ op: 'editar', id, campos }, { op: 'novo', dados }, { op: 'remover', id }]
const auth = require('../lib/auth');
const rb = require('../lib/rb');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  if (!rb.githubOk()) return res.status(200).json({ aparelhos: [], motivo: 'Falta configurar RB_GITHUB_TOKEN na Vercel para a Central mexer no site.' });
  try {
    if (req.method === 'GET') return res.status(200).json(await rb.catalogoCompleto());
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    const alteracoes = Array.isArray(b.alteracoes) ? b.alteracoes : [];
    if (!b.publicar) return res.status(200).json({ linhas: await rb.previaAlteracoes(alteracoes) });
    const feito = await rb.executarAlteracoes(alteracoes);
    console.log('rb-central catalogo', JSON.stringify({ quando: new Date().toISOString(), alteracoes: alteracoes.length }));
    return res.status(200).json({ feito });
  } catch (e) {
    return res.status(400).json({ erro: e.message });
  }
};
