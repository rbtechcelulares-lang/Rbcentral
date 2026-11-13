// Spotify da loja (lib/spotify.js).
// GET  ?code=&state=  → retorno do login do Spotify (o "state" assinado pela Central é a senha desse passo)
// GET                 → { configurado, conectado, tocando, musica, aparelho, aparelhos, ... }  (dono logado)
// POST { acao: 'login' } → { url }   · { acao: 'sair' }
//      { acao: 'comando', comando: 'play'|'pausar'|'proxima'|'anterior'|'volume'|'aleatorio'|'aparelho', volume, mudar, ligar, aparelho }
//      { acao: 'tocar', uri, fila, aparelho } · { acao: 'buscar', q } · { acao: 'playlists' }
const auth = require('../lib/auth');
const spotify = require('../lib/spotify');

const voltar = (res, resultado) => {
  res.statusCode = 302;
  res.setHeader('Location', '/?spotify=' + encodeURIComponent(resultado));
  res.end();
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  // volta do login no Spotify (o navegador chega aqui sem o login da Central: vale o state assinado)
  if (req.method === 'GET' && (q.code || q.error || q.state)) {
    if (q.error) return voltar(res, q.error === 'access_denied' ? 'cancelado' : 'erro');
    if (!spotify.stateValido(String(q.state || ''))) return voltar(res, 'expirou');
    try { await spotify.trocarCodigo(String(q.code || '')); return voltar(res, 'ok'); } catch (e) {
      console.log('rb-central spotify login', e.message);
      return voltar(res, 'erro');
    }
  }
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login de novo.' });
  try {
    if (req.method === 'GET') return res.status(200).json(await spotify.estado());
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use GET ou POST.' });
    const b = req.body || {};
    if (b.acao === 'login') return res.status(200).json({ url: spotify.urlLogin(), retorno: spotify.retorno() });
    if (b.acao === 'sair') { await spotify.desconectar(); return res.status(200).json({ ok: true }); }
    if (b.acao === 'comando') return res.status(200).json({ feito: await spotify.comando(String(b.comando || ''), b) });
    if (b.acao === 'tocar') return res.status(200).json({ feito: await spotify.tocar(b.uri, !!b.fila, b.aparelho) });
    if (b.acao === 'buscar') return res.status(200).json(await spotify.buscar(b.q));
    if (b.acao === 'playlists') return res.status(200).json({ playlists: await spotify.playlists() });
    return res.status(400).json({ erro: 'Ação desconhecida.' });
  } catch (e) {
    return res.status(e.codigo === 'desconectado' ? 200 : 502).json(e.codigo === 'desconectado' ? { configurado: true, conectado: false } : { erro: e.message });
  }
};
