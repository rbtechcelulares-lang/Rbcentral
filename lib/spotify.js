// Spotify da loja: a Central vira o controle remoto do Spotify que está tocando no computador, celular ou
// caixa de som da loja (Spotify Connect, pela Web API). Precisa de conta Premium.
// Variáveis na Vercel: SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET (do app criado em developer.spotify.com).
// Endereço de retorno para cadastrar no app do Spotify: {CENTRAL_URL}/api/spotify
// A autorização (refresh token) fica no Supabase do site, criptografada com o CENTRAL_SEGREDO.
const crypto = require('crypto');
const rb = require('./rb');
const auth = require('./auth');

const ESCOPOS = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';
const API = 'https://api.spotify.com/v1';
const baseUrl = () => String(process.env.CENTRAL_URL || 'https://rbcentral.vercel.app').replace(/\/+$/, '');
const retorno = () => baseUrl() + '/api/spotify';
const configurado = () => !!(String(process.env.SPOTIFY_CLIENT_ID || '').trim() && String(process.env.SPOTIFY_CLIENT_SECRET || '').trim());

// ---------- autorização guardada (criptografada) ----------
const chaveCripto = () => auth.chaveDerivada('spotify:' + String(process.env.SPOTIFY_CLIENT_SECRET || '').trim());
const cifrar = (t) => auth.cifrar(chaveCripto(), t);
const decifrar = (b64) => auth.decifrar(chaveCripto(), b64);
let memoria = { refresh: null, lidoEm: 0, acesso: '', expira: 0 };
async function lerRefresh() {
  if (memoria.refresh !== null && Date.now() - memoria.lidoEm < 5 * 60e3) return memoria.refresh;
  let r = '';
  try { r = decifrar(await rb.rpcPainel('central_config_ler', { p_nome: 'spotify' })); } catch (e) { r = ''; }
  memoria = Object.assign(memoria, { refresh: r, lidoEm: Date.now() });
  return r;
}
async function guardarRefresh(r) {
  await rb.rpcPainel('central_config_salvar', { p_nome: 'spotify', p_valor: r ? cifrar(r) : '' });
  memoria = { refresh: r || '', lidoEm: Date.now(), acesso: '', expira: 0 };
}

// ---------- login (uma vez) ----------
// O "state" é assinado pela Central (vale 15 min): só quem está logado na Central consegue ligar o Spotify.
function urlLogin() {
  if (!configurado()) throw new Error('Falta SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET na Vercel.');
  const state = auth.selar({ tipo: 'spotify', uid: crypto.randomUUID() }, 15);
  const q = new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID.trim(), response_type: 'code', redirect_uri: retorno(), scope: ESCOPOS, state, show_dialog: 'true' });
  return 'https://accounts.spotify.com/authorize?' + q.toString();
}
const stateValido = (s) => { const d = auth.abrir(s); return !!(d && d.tipo === 'spotify'); };

async function token(corpo) {
  const basic = Buffer.from(process.env.SPOTIFY_CLIENT_ID.trim() + ':' + process.env.SPOTIFY_CLIENT_SECRET.trim()).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corpo).toString()
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error === 'invalid_grant' ? 'A autorização do Spotify expirou ou foi tirada. Conecte o Spotify de novo.' : d.error === 'invalid_client' ? 'SPOTIFY_CLIENT_ID ou SPOTIFY_CLIENT_SECRET errado na Vercel.' : 'O Spotify recusou o login (' + (d.error_description || d.error || r.status) + ').');
    e.codigo = d.error;
    throw e;
  }
  return d;
}
async function trocarCodigo(code) {
  const d = await token({ grant_type: 'authorization_code', code, redirect_uri: retorno() });
  await guardarRefresh(d.refresh_token);
  memoria.acesso = d.access_token; memoria.expira = Date.now() + (d.expires_in - 60) * 1000;
}
async function acesso() {
  if (memoria.acesso && Date.now() < memoria.expira) return memoria.acesso;
  const refresh = await lerRefresh();
  if (!refresh) { const e = new Error('O Spotify ainda não está conectado: toque em "Conectar Spotify".'); e.codigo = 'desconectado'; throw e; }
  let d;
  try { d = await token({ grant_type: 'refresh_token', refresh_token: refresh }); } catch (e) {
    if (e.codigo === 'invalid_grant') await guardarRefresh('').catch(() => null);
    throw e;
  }
  if (d.refresh_token && d.refresh_token !== refresh) await guardarRefresh(d.refresh_token).catch(() => null);
  memoria.acesso = d.access_token; memoria.expira = Date.now() + (d.expires_in - 60) * 1000;
  return memoria.acesso;
}
const conectado = async () => configurado() && !!(await lerRefresh());
const desconectar = () => guardarRefresh('');

// ---------- Web API ----------
async function api(metodo, caminho, corpo) {
  const t = await acesso();
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: Object.assign({ Authorization: 'Bearer ' + t }, corpo ? { 'Content-Type': 'application/json' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (r.status === 204 || r.status === 202) return null;
  const d = await r.json().catch(() => null);
  if (r.ok) return d;
  const msg = (d && d.error && (d.error.message || d.error)) || '';
  const motivo = (d && d.error && d.error.reason) || '';
  if (r.status === 401) { memoria.acesso = ''; throw new Error('O Spotify pediu login de novo. Toque em "Conectar Spotify".'); }
  if (r.status === 403 && /premium/i.test(msg + motivo)) throw new Error('Para controlar o Spotify por aqui, a conta precisa ser Premium.');
  if (r.status === 403 && /restrict/i.test(msg + motivo)) throw new Error('O Spotify não deixou fazer isso agora (comando não permitido nesse aparelho ou nesse momento).');
  if (r.status === 404 && /device|active/i.test(msg + motivo)) throw new Error('Nenhum aparelho com o Spotify aberto. Abra o Spotify no computador, no celular ou na caixa de som da loja e tente de novo.');
  if (r.status === 429) throw new Error('O Spotify pediu para esperar um pouco. Tente em alguns segundos.');
  throw new Error('O Spotify respondeu ' + r.status + (msg ? ': ' + msg : ''));
}

const nomeArtistas = (x) => ((x && x.artists) || []).map((a) => a.name).join(', ');
const capa = (imgs) => { const l = imgs || []; return (l.find((i) => i.width && i.width <= 320) || l[l.length - 1] || l[0] || {}).url || ''; };

async function estado() {
  if (!configurado()) return { configurado: false, conectado: false };
  if (!(await lerRefresh())) return { configurado: true, conectado: false };
  const [p, dev] = await Promise.all([api('GET', '/me/player?additional_types=episode'), api('GET', '/me/player/devices').catch(() => null)]);
  const it = p && p.item;
  return {
    configurado: true, conectado: true,
    tocando: !!(p && p.is_playing),
    musica: it ? { nome: it.name, artistas: nomeArtistas(it) || (it.show && it.show.name) || '', album: (it.album && it.album.name) || '', capa: capa((it.album && it.album.images) || it.images), uri: it.uri, duracao: it.duration_ms || 0 } : null,
    progresso: (p && p.progress_ms) || 0,
    aleatorio: !!(p && p.shuffle_state),
    aparelho: p && p.device ? { id: p.device.id, nome: p.device.name, tipo: p.device.type, volume: p.device.volume_percent } : null,
    aparelhos: ((dev && dev.devices) || []).map((d) => ({ id: d.id, nome: d.name, tipo: d.type, ativo: d.is_active, volume: d.volume_percent }))
  };
}

// play/pause/próxima/anterior/volume/aleatório; aparelho = transferir o som para outro aparelho
async function comando(acao, v) {
  const dev = v && v.aparelho ? '?device_id=' + encodeURIComponent(v.aparelho) : '';
  switch (acao) {
    case 'play': await api('PUT', '/me/player/play' + dev); return 'Tocando.';
    case 'pausar': await api('PUT', '/me/player/pause'); return 'Pausado.';
    case 'proxima': await api('POST', '/me/player/next'); return 'Próxima música.';
    case 'anterior': await api('POST', '/me/player/previous'); return 'Música anterior.';
    case 'volume': {
      let n = Math.round(Number(v && v.volume));
      if (v && v.mudar) { const e = await estado(); n = Math.round(((e.aparelho && e.aparelho.volume) || 50) + Number(v.mudar)); }
      if (!Number.isFinite(n)) throw new Error('volume de 0 a 100');
      n = Math.max(0, Math.min(100, n));
      await api('PUT', '/me/player/volume?volume_percent=' + n);
      return 'Volume em ' + n + '%.';
    }
    case 'aleatorio': await api('PUT', '/me/player/shuffle?state=' + (v && v.ligar ? 'true' : 'false')); return v && v.ligar ? 'Ordem aleatória ligada.' : 'Ordem aleatória desligada.';
    case 'aparelho': {
      if (!v || !v.aparelho) throw new Error('escolha o aparelho');
      await api('PUT', '/me/player', { device_ids: [v.aparelho], play: true });
      return 'Som passado para o outro aparelho.';
    }
    default: throw new Error('comando desconhecido');
  }
}

// tocar uma música, playlist, artista ou álbum pelo uri (de buscar/playlists); fila = só adiciona na fila
async function tocar(uri, fila, aparelho) {
  if (!/^spotify:(track|playlist|artist|album|episode|show):[A-Za-z0-9]+$/.test(String(uri || ''))) throw new Error('item do Spotify inválido');
  const dev = aparelho ? 'device_id=' + encodeURIComponent(aparelho) : '';
  if (fila) {
    if (!/^spotify:(track|episode):/.test(uri)) throw new Error('só dá para pôr música na fila');
    await api('POST', '/me/player/queue?uri=' + encodeURIComponent(uri) + (dev ? '&' + dev : ''));
    return 'Adicionado na fila.';
  }
  const corpo = /^spotify:(track|episode):/.test(uri) ? { uris: [uri] } : { context_uri: uri };
  await api('PUT', '/me/player/play' + (dev ? '?' + dev : ''), corpo);
  return 'Tocando.';
}

async function buscar(q, tipos) {
  const t = String(q || '').trim().slice(0, 100);
  if (!t) return { musicas: [], playlists: [], artistas: [], albuns: [] };
  const tp = (tipos && tipos.length ? tipos : ['track', 'playlist', 'artist']).join(',');
  const d = await api('GET', '/search?type=' + tp + '&limit=6&market=from_token&q=' + encodeURIComponent(t));
  const lim = (x) => ((x && x.items) || []).filter(Boolean);
  return {
    musicas: lim(d.tracks).map((x) => ({ uri: x.uri, nome: x.name, artistas: nomeArtistas(x), capa: capa(x.album && x.album.images) })),
    playlists: lim(d.playlists).map((x) => ({ uri: x.uri, nome: x.name, dono: (x.owner && x.owner.display_name) || '', capa: capa(x.images) })),
    artistas: lim(d.artists).map((x) => ({ uri: x.uri, nome: x.name, capa: capa(x.images) })),
    albuns: lim(d.albums).map((x) => ({ uri: x.uri, nome: x.name, artistas: nomeArtistas(x), capa: capa(x.images) }))
  };
}

async function playlists() {
  const d = await api('GET', '/me/playlists?limit=30');
  return ((d && d.items) || []).filter(Boolean).map((x) => ({ uri: x.uri, nome: x.name, dono: (x.owner && x.owner.display_name) || '', capa: capa(x.images), musicas: (x.tracks && x.tracks.total) || (x.items && x.items.total) || 0 }));
}

// para a IA: "toca a playlist da loja", "toca Henrique e Juliano": procura nas playlists da conta e depois no Spotify todo
async function tocarPorNome(texto, tipo, fila) {
  const t = String(texto || '').trim();
  if (!t) throw new Error('diga o que tocar');
  const simples = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!tipo || tipo === 'playlist') {
    const minhas = await playlists().catch(() => []);
    const p = minhas.find((x) => simples(x.nome) === simples(t)) || minhas.find((x) => simples(x.nome).includes(simples(t)));
    if (p) return { tocando: p.nome + ' (sua playlist)', resultado: await tocar(p.uri, false) };
  }
  const mapa = { musica: 'track', playlist: 'playlist', artista: 'artist', album: 'album' };
  const r = await buscar(t, tipo && mapa[tipo] ? [mapa[tipo]] : ['track', 'artist', 'playlist']);
  const escolha = (tipo === 'playlist' && r.playlists[0]) || (tipo === 'artista' && r.artistas[0]) || (tipo === 'album' && r.albuns[0]) || (tipo === 'musica' && r.musicas[0])
    || (fila ? r.musicas[0] : r.artistas.find((a) => simples(a.nome) === simples(t)) || r.musicas[0] || r.playlists[0] || r.artistas[0]);
  if (!escolha) throw new Error('não achei "' + t + '" no Spotify');
  const nome = escolha.nome + (escolha.artistas ? ' · ' + escolha.artistas : '');
  return { tocando: nome, resultado: await tocar(escolha.uri, !!fila && /^spotify:track:/.test(escolha.uri)) };
}

module.exports = { configurado, conectado, desconectar, urlLogin, stateValido, trocarCodigo, retorno, estado, comando, tocar, buscar, playlists, tocarPorNome, cifrar, decifrar };
