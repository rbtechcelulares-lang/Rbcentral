// Login do dono: confere a senha (CENTRAL_SENHA) e devolve uma sessão de 12 horas.
const auth = require('../lib/auth');

const tentativas = new Map(); // freio simples contra chute de senha (por servidor ativo)

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  if (!auth.configurado()) {
    const p = auth.problemas();
    const visiveis = Object.keys(process.env).filter((k) => /^(CENTRAL|SAAS|RB)_/.test(k)).sort();
    return res.status(501).json({ erro: 'Configuração na Vercel (projeto RB Central): ' + p.join('; ') + '. Variáveis que este deploy enxerga: ' + (visiveis.length ? visiveis.join(', ') : 'nenhuma') + '. Depois de corrigir, faça Redeploy.' });
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'ip';
  const t = tentativas.get(ip) || { n: 0, ate: 0 };
  if (t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Espere alguns minutos.' });
  const senha = String((req.body || {}).senha || '');
  let confere = false;
  try { confere = await auth.senhaConfere(senha); } catch (e) {
    return res.status(502).json({ erro: 'Não consegui conferir a senha no catálogo do site: ' + e.message });
  }
  if (!confere) {
    t.n++; if (t.n >= 5) { t.ate = Date.now() + 10 * 60e3; t.n = 0; }
    tentativas.set(ip, t);
    await new Promise((ok) => setTimeout(ok, 800));
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  tentativas.delete(ip);
  return res.status(200).json({ token: auth.criarSessao() });
};
