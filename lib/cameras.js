// Câmeras da loja: a Central abre o site das câmeras (o link direto que a Emive passou) num mini player.
// O dono cola o link uma vez no painel 📹; ele fica no Supabase do site (central_config), criptografado com o
// CENTRAL_SEGREDO. O login e a senha das câmeras NÃO passam pela Central: o dono digita na própria tela das câmeras.
// Ao salvar, a Central confere se o site das câmeras deixa abrir dentro de outra página (X-Frame-Options e
// frame-ancestors). Se não deixar, as câmeras abrem numa janelinha separada.
const rb = require('./rb');
const auth = require('./auth');

const NOME = 'cameras';
const chave = () => auth.chaveDerivada('cameras');
const host = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const centralHost = () => host(String(process.env.CENTRAL_URL || 'https://rbcentral.vercel.app')) || 'rbcentral.vercel.app';
const ativo = () => rb.githubOk() && rb.supabaseOk();

// IP da rede interna (a Central não deve sair procurando coisas na rede de ninguém)
function ipInterno(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function validar(url) {
  const t = String(url == null ? '' : url).trim();
  if (!t) throw new Error('cole o link das câmeras');
  if (t.length > 1000) throw new Error('link grande demais');
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : 'https://' + t); } catch (e) { throw new Error('link inválido: cole o endereço completo, como veio da Emive'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('o link precisa começar com https://');
  if (u.username || u.password) throw new Error('não coloque o login e a senha dentro do link: você digita na própria tela das câmeras');
  const h = u.hostname.toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.startsWith('[') || ipInterno(h) || (!h.includes('.'))) {
    throw new Error('esse endereço é da rede interna; use o link do site das câmeras que a Emive passou');
  }
  return u.toString();
}

// o site deixa abrir dentro da Central? true / false / null (não deu para conferir: tenta e mostra o botão de janela)
async function conferirEmbutir(url) {
  if (/^http:/i.test(url)) return { embutir: false, motivo: 'O link é http (sem cadeado): o navegador não deixa abrir dentro da Central.' };
  let r;
  try {
    r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }
    });
  } catch (e) {
    return { embutir: null, motivo: 'Não consegui abrir o site das câmeras para conferir agora.' };
  }
  try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (e) { /* ignora */ }
  const csp = String((r.headers && r.headers.get('content-security-policy')) || '');
  const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp);
  if (fa) {
    const nosso = centralHost();
    const ok = fa[1].trim().split(/\s+/).some((s) => {
      const x = s.replace(/^'|'$/g, '').toLowerCase();
      if (x === '*' || x === 'https:') return true;
      const hx = x.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
      return hx === nosso || (hx.startsWith('*.') && nosso.endsWith(hx.slice(1)));
    });
    return ok ? { embutir: true } : { embutir: false, motivo: 'O site das câmeras não deixa abrir dentro de outra página.' };
  }
  const xfo = String((r.headers && r.headers.get('x-frame-options')) || '').toLowerCase();
  if (/deny|sameorigin|allow-from/.test(xfo)) return { embutir: false, motivo: 'O site das câmeras não deixa abrir dentro de outra página.' };
  return { embutir: true };
}

let memoria = { cfg: undefined, em: 0 };
async function ler() {
  if (memoria.cfg !== undefined && Date.now() - memoria.em < 5 * 60e3) return memoria.cfg;
  let cfg = null;
  const v = await rb.rpcPainel('central_config_ler', { p_nome: NOME });
  if (v) { try { cfg = JSON.parse(auth.decifrar(chave(), v)); } catch (e) { cfg = null; } }
  memoria = { cfg, em: Date.now() };
  return cfg;
}

// o que a tela recebe (só o dono logado)
const publico = (cfg) => (cfg && cfg.url
  ? { configurado: true, url: cfg.url, site: host(cfg.url), embutir: cfg.embutir === undefined ? null : cfg.embutir, motivo: cfg.motivo || '', conferido: cfg.conferido || '' }
  : { configurado: false });

async function estado() { return publico(await ler()); }

async function salvar(url) {
  const limpo = validar(url);
  const c = await conferirEmbutir(limpo);
  const cfg = { url: limpo, embutir: c.embutir, motivo: c.motivo || '', conferido: new Date().toISOString() };
  await rb.rpcPainel('central_config_salvar', { p_nome: NOME, p_valor: auth.cifrar(chave(), JSON.stringify(cfg)) });
  memoria = { cfg, em: Date.now() };
  return publico(cfg);
}

async function conferirDeNovo() {
  const cfg = await ler();
  if (!cfg || !cfg.url) return publico(null);
  return salvar(cfg.url);
}

async function apagar() {
  await rb.rpcPainel('central_config_salvar', { p_nome: NOME, p_valor: '' });
  memoria = { cfg: null, em: Date.now() };
  return publico(null);
}

// para a IA (ela não vê as imagens: só abre o player na tela do dono)
async function paraIA() {
  let e;
  try { e = await estado(); } catch (er) { return { aberto: false, aviso: 'Não consegui ler a configuração das câmeras (' + er.message + ').' }; }
  if (!e.configurado) return { aberto: false, aviso: 'As câmeras ainda não foram configuradas: o dono toca em "📹 Câmeras" no topo e cola o link que a Emive passou.' };
  return { aberto: true, site: e.site, como: e.embutir === false ? 'numa janela separada (o site das câmeras não deixa abrir dentro da Central)' : 'no mini player da Central', aviso: 'Você não vê as imagens; só abriu o player na tela do dono.' };
}

module.exports = { ativo, validar, conferirEmbutir, estado, salvar, conferirDeNovo, apagar, paraIA };
