// O que está conectado (para a tela mostrar). Não revela nenhuma chave.
const auth = require('../lib/auth');
const rb = require('../lib/rb');
const saas = require('../lib/saas');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login.' });
  return res.status(200).json({
    ia: !!process.env.ANTHROPIC_API_KEY,
    site: rb.githubOk(),
    crm: rb.githubOk() && rb.supabaseOk(),
    sistema_os: saas.ok()
  });
};
