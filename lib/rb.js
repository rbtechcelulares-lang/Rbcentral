// Site RB Tech Celulares: catálogo no GitHub (mesmo caminho do botão "Publicar" do admin)
// e clientes/cliques no Supabase (funções protegidas pela chave do painel).
// Variáveis na Vercel:
//   RB_GITHUB_TOKEN   token do GitHub com permissão de escrita só no repositório do site
//   RB_GITHUB_REPO    ex.: rbtechcelulares-lang/RB-TECH-CELULARES
//   RB_GITHUB_BRANCH  a mesma branch que o site publica (a mesma GITHUB_BRANCH do projeto do site)
//   RB_PAINEL_CHAVE   a chave do painel (Clientes/Cliques) do admin do site
const REPO = () => process.env.RB_GITHUB_REPO || 'rbtechcelulares-lang/RB-TECH-CELULARES';
const BRANCH = () => process.env.RB_GITHUB_BRANCH || '';
const CATALOGO = 'data/catalogo.json';

const githubOk = () => !!process.env.RB_GITHUB_TOKEN;
const supabaseOk = () => !!process.env.RB_PAINEL_CHAVE;

async function gh(metodo, corpo) {
  const ref = metodo === 'GET' && BRANCH() ? '?ref=' + encodeURIComponent(BRANCH()) : '';
  const r = await fetch('https://api.github.com/repos/' + REPO() + '/contents/' + CATALOGO + ref, {
    method: metodo,
    headers: {
      Authorization: 'Bearer ' + process.env.RB_GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rb-central'
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(r.status === 401 || r.status === 403 ? 'O RB_GITHUB_TOKEN não tem acesso ao repositório do site.' : (d.message || 'GitHub respondeu ' + r.status));
    e.status = r.status;
    throw e;
  }
  return d;
}

async function lerCatalogo() {
  if (!githubOk()) throw new Error('Falta configurar RB_GITHUB_TOKEN na Vercel.');
  const a = await gh('GET');
  return { cat: JSON.parse(Buffer.from(a.content, 'base64').toString('utf8')), sha: a.sha };
}

// Aplica uma alteração no catálogo e publica (commit). Se alguém publicou no meio, tenta de novo com a versão nova.
async function alterarCatalogo(alterar, mensagem) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { cat, sha } = await lerCatalogo();
    const resumo = alterar(cat);
    const conteudo = Buffer.from(JSON.stringify(cat, null, 2) + '\n', 'utf8').toString('base64');
    try {
      await gh('PUT', { message: String(mensagem).slice(0, 200), content: conteudo, sha, branch: BRANCH() || undefined });
      return resumo;
    } catch (e) {
      if (e.status !== 409 || tentativa) throw e;
    }
  }
}

const nome = (p) => [p.modelo, p.armazenamento].filter(Boolean).join(' ');
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const naVitrine = (p) => (p.vitrine != null ? !!p.vitrine : !!p.destaque);
const resumoProduto = (p) => ({
  id: p.id, aparelho: nome(p), cor: p.cor || '', condicao: p.condicao || '', categoria: p.categoria || 'iphone',
  preco: brl(p.preco), preco_antigo: p.precoAntigo > p.preco ? brl(p.precoAntigo) : null,
  vitrine: naVitrine(p), topo: !!p.topo, disponivel: p.disponivel !== false, sob_encomenda: !!p.encomenda
});

async function listarAparelhos(i) {
  const { cat } = await lerCatalogo();
  const busca = String(i.busca || '').toLowerCase();
  let lista = (cat.produtos || []).filter((p) => !busca || [nome(p), p.cor, p.condicao, p.categoria, p.id].join(' ').toLowerCase().includes(busca));
  if (i.so_vitrine) lista = lista.filter(naVitrine);
  return { total: lista.length, aparelhos: lista.slice(0, 60).map(resumoProduto) };
}

// ---- ações (só rodam depois da confirmação do dono) ----
function acharProdutos(cat, ids) {
  const por = new Map((cat.produtos || []).map((p) => [p.id, p]));
  const faltam = ids.filter((id) => !por.has(id));
  if (faltam.length) throw new Error('Aparelho não encontrado: ' + faltam.join(', '));
  return ids.map((id) => por.get(id));
}

function previaPrecos(cat, itens) {
  const ps = acharProdutos(cat, itens.map((x) => x.id));
  return ps.map((p, k) => nome(p) + ' ' + (p.cor || '') + ': ' + brl(p.preco) + ' → ' + brl(itens[k].preco));
}
const executarPrecos = (itens) => alterarCatalogo((cat) => {
  const ps = acharProdutos(cat, itens.map((x) => x.id));
  return ps.map((p, k) => {
    const antes = p.preco;
    p.preco = Math.round(Number(itens[k].preco) * 100) / 100;
    return nome(p) + ': ' + brl(antes) + ' → ' + brl(p.preco);
  });
}, 'RB Central: altera preço de ' + itens.length + ' aparelho(s)');

function previaVitrine(cat, ids, mostrar) {
  return acharProdutos(cat, ids).map((p) => nome(p) + ' ' + (p.cor || '') + ': ' + (naVitrine(p) ? 'na vitrine' : 'fora da vitrine') + ' → ' + (mostrar ? 'na vitrine' : 'fora da vitrine'));
}
const executarVitrine = (ids, mostrar) => alterarCatalogo((cat) => acharProdutos(cat, ids).map((p) => {
  p.vitrine = !!mostrar;
  if ('destaque' in p) p.destaque = !!mostrar;
  return nome(p) + ': ' + (mostrar ? 'colocado na vitrine' : 'tirado da vitrine');
}), 'RB Central: ' + (mostrar ? 'coloca na' : 'tira da') + ' vitrine ' + ids.length + ' aparelho(s)');

// ---- Supabase (clientes e cliques) ----
async function rpc(cat, fn, corpo) {
  if (!supabaseOk()) throw new Error('Falta configurar RB_PAINEL_CHAVE na Vercel.');
  const rs = cat.rastreamento || {};
  const url = (String(rs.supabaseUrl || '').match(/https:\/\/[a-z0-9-]+\.supabase\.co/i) || [])[0];
  const chave = String(rs.supabaseChave || '').trim();
  if (!url || !chave) throw new Error('O Supabase não está configurado no admin do site (aba Cliques).');
  const h = { apikey: chave, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(chave)) h.Authorization = 'Bearer ' + chave;
  const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(Object.assign({ chave: process.env.RB_PAINEL_CHAVE }, corpo)) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(/chave/i.test((d && d.message) || '') ? 'RB_PAINEL_CHAVE incorreta.' : 'Supabase respondeu ' + r.status + ((d && d.message) ? ': ' + d.message : ''));
  return d;
}

const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const inicioDoDia = (dia) => new Date((dia || hojeBR()) + 'T00:00:00-03:00').toISOString();

async function clientesCrm(i) {
  const { cat } = await lerCatalogo();
  let lista = (await rpc(cat, 'painel_clientes', {})) || [];
  const status = i.status || 'novo';
  if (status !== 'todos') lista = lista.filter((c) => c.status === status);
  if (i.desde) { const d = Date.parse(i.desde); if (!isNaN(d)) lista = lista.filter((c) => Date.parse(c.atualizado_em) >= d); }
  return {
    total: lista.length,
    clientes: lista.slice(0, 40).map((c) => ({ nome: c.nome, whatsapp: c.whatsapp, interesse: c.interesse, entrada: c.entrada, status: c.status, notas: c.notas, atualizado_em: c.atualizado_em, link_whatsapp: 'https://wa.me/' + c.whatsapp }))
  };
}

async function relatorioSite(dia) {
  const { cat } = await lerCatalogo();
  const desde = inicioDoDia(dia);
  const [resumo, clientes] = await Promise.all([
    rpc(cat, 'painel_resumo', { desde }).catch((e) => ({ erro: e.message })),
    rpc(cat, 'painel_clientes', {}).catch((e) => ({ erro: e.message }))
  ]);
  const ate = Date.parse(desde) + 86400e3;
  const doDia = Array.isArray(clientes) ? clientes.filter((c) => Date.parse(c.criado_em) >= Date.parse(desde) && Date.parse(c.criado_em) < ate) : [];
  const ativos = (cat.produtos || []).filter((p) => p.disponivel !== false);
  return {
    dia: dia || hojeBR(),
    cliques: resumo && resumo.totais ? resumo.totais : resumo,
    aparelhos_mais_vistos: resumo && Array.isArray(resumo.produtos) ? resumo.produtos.slice(0, 5).map((x) => ({ aparelho: x.produto_nome, visualizacoes: x.cliques, propostas_whatsapp: x.whatsapp })) : [],
    clientes_novos: Array.isArray(clientes) ? doDia.length : clientes,
    clientes: doDia.slice(0, 15).map((c) => ({ nome: c.nome, interesse: c.interesse, origem: c.origem })),
    aparelhos_no_site: ativos.length,
    na_vitrine: ativos.filter(naVitrine).length
  };
}

module.exports = { githubOk, supabaseOk, lerCatalogo, listarAparelhos, previaPrecos, executarPrecos, previaVitrine, executarVitrine, clientesCrm, relatorioSite, hojeBR };
