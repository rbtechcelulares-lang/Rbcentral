// Histórico da RB Central: as 6 últimas conversas, as mesmas em todos os aparelhos.
// Fica no Supabase do site, em funções protegidas pela chave do painel (supabase/central_conversas.sql).
// GET → { sinc: true, conversas: [...] } · POST { acao: 'salvar', conversa } · POST { acao: 'apagar', id }
// Se a nuvem não estiver pronta, responde { sinc: false, motivo } e a tela guarda só no aparelho.
const auth = require('../lib/auth');
const rb = require('../lib/rb');

const MAX_CONVERSAS = 6;
const MAX_ITENS = 80;
const MAX_BYTES = 900000;
const ID = /^[a-z0-9]{6,24}$/;

function limpar(c) {
  if (!c || typeof c !== 'object' || !ID.test(String(c.id || ''))) return null;
  return {
    id: c.id,
    criada: Number(c.criada) || Date.now(),
    atualizada: Number(c.atualizada) || Date.now(),
    itens: (Array.isArray(c.itens) ? c.itens : []).filter((i) => i && typeof i === 'object').slice(-MAX_ITENS)
  };
}

function motivo(e) {
  const m = String((e && e.message) || e || '');
  if (/could not find the function|PGRST202|respondeu 404/i.test(m)) return 'falta rodar o SQL do histórico no Supabase do site';
  if (/chave/i.test(m)) return 'a RB_PAINEL_CHAVE está incorreta';
  return m || 'a nuvem não respondeu';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  if (!rb.githubOk() || !rb.supabaseOk()) return res.status(200).json({ sinc: false, motivo: 'falta configurar RB_GITHUB_TOKEN e RB_PAINEL_CHAVE na Vercel' });
  try {
    if (req.method === 'GET') {
      const lista = await rb.rpcPainel('central_conversas_listar', {});
      return res.status(200).json({ sinc: true, conversas: (Array.isArray(lista) ? lista : []).map(limpar).filter(Boolean).slice(0, MAX_CONVERSAS) });
    }
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    if (b.acao === 'salvar') {
      const c = limpar(b.conversa);
      if (!c) return res.status(400).json({ erro: 'Conversa inválida.' });
      if (Buffer.byteLength(JSON.stringify(c)) > MAX_BYTES) return res.status(413).json({ erro: 'Conversa grande demais para guardar na nuvem.' });
      await rb.rpcPainel('central_conversa_salvar', { p_id: c.id, p_atualizada: c.atualizada, p_dados: c });
      return res.status(200).json({ sinc: true });
    }
    if (b.acao === 'apagar') {
      if (!ID.test(String(b.id || ''))) return res.status(400).json({ erro: 'Conversa inválida.' });
      await rb.rpcPainel('central_conversa_apagar', { p_id: b.id });
      return res.status(200).json({ sinc: true });
    }
    return res.status(400).json({ erro: 'Ação desconhecida.' });
  } catch (e) {
    return res.status(200).json({ sinc: false, motivo: motivo(e) });
  }
};
