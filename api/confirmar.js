// Executa uma ação que o dono confirmou na tela. A ação vem assinada pelo servidor
// (não dá para inventar ou mudar uma ação pelo navegador) e vale por 15 minutos.
const auth = require('../lib/auth');
const f = require('../lib/ferramentas');

const usadas = new Set(); // evita executar a mesma ação duas vezes (duplo clique)

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  const acao = auth.abrir((req.body || {}).acao);
  if (!acao || acao.tipo !== 'acao' || !f.NOMES_ALTERACAO.has(acao.nome)) return res.status(400).json({ erro: 'Ação inválida ou expirada (vale 15 minutos). Peça de novo para a IA.' });
  if (usadas.has(acao.uid)) return res.status(409).json({ erro: 'Essa ação já foi executada.' });
  usadas.add(acao.uid);
  try {
    const resultado = await f.executar(acao.nome, acao.entrada);
    console.log('rb-central acao', JSON.stringify({ quando: new Date().toISOString(), acao: acao.nome, entrada: acao.entrada, ok: true }));
    return res.status(200).json({ ok: true, resultado });
  } catch (e) {
    usadas.delete(acao.uid);
    console.log('rb-central acao', JSON.stringify({ quando: new Date().toISOString(), acao: acao.nome, entrada: acao.entrada, ok: false, erro: e.message }));
    return res.status(502).json({ erro: e.message });
  }
};
