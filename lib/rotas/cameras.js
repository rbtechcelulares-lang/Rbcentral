// Câmeras da loja na tela da Central (só o dono logado). O toque do dono no painel vale como confirmação.
// GET                         → { configurado, url, site, embutir, motivo }
// POST { acao: 'salvar', url } → mesmo formato (confere se o site deixa abrir dentro da Central)
//      { acao: 'conferir' }     → confere de novo · { acao: 'apagar' }
const auth = require('../auth');
const cameras = require('../cameras');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  if (!cameras.ativo()) return res.status(200).json({ configurado: false, indisponivel: true, motivo: 'Para guardar o link das câmeras, falta ligar o Supabase do site na Central (RB_GITHUB_TOKEN e RB_PAINEL_CHAVE na Vercel).' });
  try {
    if (req.method === 'GET') return res.status(200).json(await cameras.estado());
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    if (b.acao === 'salvar') return res.status(200).json(await cameras.salvar(b.url));
    if (b.acao === 'conferir') return res.status(200).json(await cameras.conferirDeNovo());
    if (b.acao === 'apagar') return res.status(200).json(await cameras.apagar());
    return res.status(400).json({ erro: 'Ação desconhecida.' });
  } catch (e) {
    if (/central_config|não existe|does not exist|404/i.test(e.message)) return res.status(400).json({ erro: 'Falta rodar no Supabase o SQL da Central (supabase/central_conversas.sql): ele cria a tabela central_config, onde o link fica guardado.' });
    return res.status(400).json({ erro: e.message });
  }
};
