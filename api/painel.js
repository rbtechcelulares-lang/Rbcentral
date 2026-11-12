// Telas do dono na Central, num endereço só (a Vercel grátis aceita no máximo 12 funções):
//   /api/painel?rota=avisos    mensagens para confirmar (lib/rotas/avisos.js)
//   /api/painel?rota=crm       CRM do WhatsApp (lib/rotas/crm.js)
//   /api/painel?rota=catalogo  aparelhos do site (lib/rotas/catalogo.js)
//   /api/painel?rota=pecas     pedidos de peças aos fornecedores (lib/rotas/pecas.js)
// Os endereços antigos (/api/avisos, /api/crm, /api/catalogo) continuam funcionando pelo vercel.json.
const rotas = {
  avisos: require('../lib/rotas/avisos'),
  crm: require('../lib/rotas/crm'),
  catalogo: require('../lib/rotas/catalogo'),
  pecas: require('../lib/rotas/pecas')
};

module.exports = (req, res) => {
  const rota = rotas[String((req.query || {}).rota || '')];
  if (!rota) return res.status(404).json({ erro: 'Rota desconhecida.' });
  return rota(req, res);
};
