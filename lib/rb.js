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
  vitrine: naVitrine(p), topo: !!p.topo, no_catalogo: p.disponivel !== false, sob_encomenda: !!p.encomenda,
  bateria: p.bateria ? p.bateria + '%' : null
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

// ---- Catálogo completo: editar, adicionar e tirar do site, várias mudanças num commit só ----
// Mesmo formato do painel /admin e do script da skill cadastrar-iphone (ID, cores, checklist, garantia).
const CORES = {
  'Preto': '#22201f', 'Branco': '#f2efe9', 'Meia-noite': '#1f2430', 'Estelar': '#ece5da',
  'Azul': '#a7c1d9', 'Azul-sierra': '#9bb5ce', 'Verde': '#b9cdb5', 'Roxo': '#cdbfdc',
  'Rosa': '#f1cfd4', 'Amarelo': '#f3e3a5', '(PRODUCT)RED': '#c2283b', 'Grafite': '#4a4845',
  'Dourado': '#ead9b9', 'Prateado': '#e3e3e0', 'Titânio natural': '#bdb7ab', 'Titânio preto': '#3a3836',
  'Titânio branco': '#ecebe7', 'Titânio azul': '#3f4a5c', 'Titânio deserto': '#c8ae93', 'Ultramarino': '#5c6fd6',
  'Verde-acinzentado': '#a9bfb6', 'Laranja cósmico': '#d9793b', 'Azul-intenso': '#2f3c5a',
  'Bordeaux': '#5b1a2a', 'Silver': '#d9dadc', 'Índigo': '#3a3f6b', 'Citrus': '#d6d26a', 'Sky Blue': '#a9c8e6',
  'Cores variadas': '#22201f'
};
const CONDICOES = ['Seminovo', 'Novo lacrado', 'Vitrine'];
const CHECKLIST_ITENS = ['faceid', 'bateria', 'sistema', 'cameras', 'tela', 'tampa'];
const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const categoriaDe = (m) => (/macbook/i.test(m) ? 'macbook' : /ipad/i.test(m) ? 'ipad' : /xiaomi|redmi|poco/i.test(m) ? 'xiaomi' : 'iphone');
const naoVazio = (v, campo, max) => { const t = String(v == null ? '' : v).trim(); if (!t) throw new Error('falta ' + campo); return t.slice(0, max || 80); };
function armazenamento(v) {
  let t = String(v || '').toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(t)) t += 'GB';
  if (!/^\d+(GB|TB)$/.test(t)) throw new Error('armazenamento inválido (ex.: 128GB, 256GB, 1TB)');
  return t;
}
function reais(v, campo) {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/R\$\s*/i, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(campo + ' inválido');
  return Math.round(n * 100) / 100;
}
const simNao = (v) => (v === true || v === 'sim' ? true : v === false || v === 'nao' || v === 'não' ? false : undefined);
const ROTULO = { preco: 'Preço', precoAntigo: 'Preço antigo (de/por)', cor: 'Cor', armazenamento: 'Armazenamento', condicao: 'Condição', bateria: 'Bateria',
  vitrine: 'Vitrine', topo: 'Topo', disponivel: 'Catálogo', encomenda: 'Sob encomenda', prazo: 'Prazo', observacoes: 'Observações', modelo: 'Modelo', garantia: 'Garantia' };
const mostrarValor = (campo, v) => {
  if (campo === 'preco' || campo === 'precoAntigo') return v > 0 ? brl(v) : '—';
  if (campo === 'bateria') return v ? v + '%' : 'sem número';
  if (typeof v === 'boolean') return campo === 'disponivel' ? (v ? 'aparece' : 'fora') : v ? 'sim' : 'não';
  return v === '' || v == null ? '(vazio)' : String(v).slice(0, 60);
};

// muda os campos de um aparelho (só os enviados) e devolve as linhas "Campo: antes → depois"
function aplicarCampos(p, c) {
  const linhas = [];
  const muda = (campo, novo) => {
    if (novo === undefined) return;
    const antes = campo === 'vitrine' ? naVitrine(p) : campo === 'disponivel' ? p.disponivel !== false : p[campo];
    if (JSON.stringify(antes) === JSON.stringify(novo)) return;
    p[campo] = novo;
    if (campo === 'vitrine' && 'destaque' in p) p.destaque = novo;
    if (campo === 'cor') p.corHex = CORES[novo] || (c.corHex && /^#[0-9a-f]{6}$/i.test(c.corHex) ? c.corHex : p.corHex || '#1f2430');
    linhas.push(ROTULO[campo] + ': ' + mostrarValor(campo, antes) + ' → ' + mostrarValor(campo, novo));
  };
  if (c.modelo !== undefined) muda('modelo', naoVazio(c.modelo, 'modelo'));
  if (c.armazenamento !== undefined) muda('armazenamento', armazenamento(c.armazenamento));
  if (c.cor !== undefined) muda('cor', naoVazio(c.cor, 'cor', 40));
  if (c.condicao !== undefined) {
    if (!CONDICOES.includes(c.condicao)) throw new Error('condição: use ' + CONDICOES.join(', '));
    muda('condicao', c.condicao);
  }
  if (c.preco !== undefined) muda('preco', reais(c.preco, 'preço'));
  if (c.precoAntigo !== undefined) muda('precoAntigo', reais(c.precoAntigo || 0, 'preço antigo'));
  if (c.bateria !== undefined) {
    const b = c.bateria === null || c.bateria === '' || Number(c.bateria) === 0 ? null : Math.round(Number(c.bateria));
    if (b !== null && !(b >= 1 && b <= 100)) throw new Error('bateria: de 1 a 100%');
    muda('bateria', b);
  }
  ['vitrine', 'topo', 'disponivel', 'encomenda'].forEach((k) => { if (c[k] !== undefined) muda(k, !!simNao(c[k])); });
  if (c.prazo !== undefined) muda('prazo', String(c.prazo || '').trim().slice(0, 60));
  if (c.observacoes !== undefined) muda('observacoes', String(c.observacoes || '').trim().slice(0, 400));
  if (c.garantia !== undefined) muda('garantia', naoVazio(c.garantia, 'garantia', 40));
  if (!(p.preco > 0)) throw new Error(nome(p) + ': o preço precisa ser maior que zero');
  if (p.precoAntigo && p.precoAntigo <= p.preco) throw new Error(nome(p) + ': o preço antigo (de/por) precisa ser maior que o preço');
  return linhas;
}

function novoProduto(cat, d) {
  const modelo = naoVazio(d.modelo, 'modelo');
  const cat_id = categoriaDe(modelo), iph = cat_id === 'iphone';
  const condicao = d.condicao && CONDICOES.includes(d.condicao) ? d.condicao : iph ? 'Seminovo' : 'Novo lacrado';
  const p = {
    id: '', categoria: cat_id, modelo, armazenamento: armazenamento(d.armazenamento),
    cor: naoVazio(d.cor, 'cor', 40), corHex: '#1f2430', condicao, specs: '',
    bateria: condicao === 'Novo lacrado' ? 100 : iph ? null : 100, preco: 0, precoAntigo: 0,
    garantia: condicao === 'Novo lacrado' || !iph ? '1 ano' : (String((cat.loja && cat.loja.garantiaPadrao) || '').trim() || '90 dias'),
    topo: false, vitrine: false, disponivel: true, encomenda: false, prazo: '',
    fotos: [], observacoes: '',
    checklist: Object.fromEntries(CHECKLIST_ITENS.map((it) => [it, { status: 'ok', nota: '' }]))
  };
  p.corHex = CORES[p.cor] || (d.corHex && /^#[0-9a-f]{6}$/i.test(d.corHex) ? d.corHex : '#1f2430');
  aplicarCampos(p, { preco: d.preco, precoAntigo: d.precoAntigo, bateria: d.bateria, vitrine: d.vitrine, topo: d.topo, disponivel: d.disponivel, encomenda: d.encomenda, prazo: d.prazo, observacoes: d.observacoes });
  p.id = 'p-' + slug(p.modelo + ' ' + p.armazenamento + '-' + p.cor) + '-' + Date.now().toString(16).slice(-4);
  while ((cat.produtos || []).some((x) => x.id === p.id)) p.id += 'x';
  return p;
}

// alteracoes: [{ op: 'editar', id, campos }, { op: 'novo', dados }, { op: 'remover', id }]
function aplicarAlteracoes(cat, alteracoes) {
  if (!Array.isArray(alteracoes) || !alteracoes.length) throw new Error('nenhuma alteração');
  if (alteracoes.length > 60) throw new Error('no máximo 60 alterações de uma vez');
  cat.produtos = cat.produtos || [];
  const linhas = [];
  alteracoes.forEach((a) => {
    if (a.op === 'novo') {
      const p = novoProduto(cat, a.dados || {});
      cat.produtos.unshift(p);
      const onde = [p.topo && 'topo', naVitrine(p) && 'vitrine', p.disponivel !== false && 'catálogo'].filter(Boolean).join(', ') || 'fora do site';
      linhas.push('➕ Novo: ' + nome(p) + ' ' + p.cor + ' · ' + p.condicao + (p.bateria ? ' · bateria ' + p.bateria + '%' : '') + ' · ' + brl(p.preco) + ' · ' + onde);
      return;
    }
    const [p] = acharProdutos(cat, [String(a.id || '')]);
    if (a.op === 'remover') {
      const l = aplicarCampos(p, { disponivel: false, vitrine: false, topo: false });
      linhas.push('🗑 ' + nome(p) + ' ' + (p.cor || '') + ': tirado do site' + (l.length ? '' : ' (já estava fora)') +
        (cat.promocao && cat.promocao.produtoId === p.id ? ' — ⚠️ era o aparelho da promoção em destaque; escolha outro no Admin' : ''));
      return;
    }
    if (a.op !== 'editar') throw new Error('alteração desconhecida: ' + a.op);
    const l = aplicarCampos(p, a.campos || {});
    if (l.length) linhas.push('✏️ ' + nome(p) + ' ' + (p.cor || '') + ': ' + l.join(' · '));
  });
  if (!linhas.length) throw new Error('nada muda: os valores pedidos já são os do site');
  return linhas;
}

// prévia (não grava nada) e publicação (um commit só, como o botão Publicar do admin)
async function previaAlteracoes(alteracoes) {
  const { cat } = await lerCatalogo();
  return aplicarAlteracoes(JSON.parse(JSON.stringify(cat)), alteracoes);
}
const executarAlteracoes = (alteracoes) => alterarCatalogo((cat) => aplicarAlteracoes(cat, alteracoes),
  'RB Central: ' + alteracoes.length + ' alteração(ões) no catálogo');

// lista completa para o painel de aparelhos da Central
async function catalogoCompleto() {
  const { cat } = await lerCatalogo();
  return {
    aparelhos: (cat.produtos || []).map((p) => ({
      id: p.id, modelo: p.modelo || '', armazenamento: p.armazenamento || '', cor: p.cor || '', corHex: p.corHex || '#1f2430',
      condicao: p.condicao || '', categoria: p.categoria || categoriaDe(p.modelo || ''), bateria: p.bateria || null,
      preco: p.preco || 0, precoAntigo: p.precoAntigo || 0, vitrine: naVitrine(p), topo: !!p.topo, disponivel: p.disponivel !== false,
      encomenda: !!p.encomenda, prazo: p.prazo || '', observacoes: p.observacoes || '', fotos: (p.fotos || []).length
    })),
    cores: Object.keys(CORES), condicoes: CONDICOES, promocao_id: (cat.promocao && cat.promocao.produtoId) || null
  };
}

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
  if (!r.ok) {
    if (r.status === 404 || (d && d.code === 'PGRST202')) throw new Error('Supabase respondeu 404: a função ' + fn + ' não existe (falta rodar o SQL).');
    throw new Error(/chave do painel/i.test((d && d.message) || '') ? 'RB_PAINEL_CHAVE incorreta.' : 'Supabase respondeu ' + r.status + ((d && d.message) ? ': ' + d.message : ''));
  }
  return d;
}

// Chama uma função do Supabase do site (endereço e chave pública vêm do catálogo publicado, guardado por 5 minutos)
let catSupabase = null;
async function rpcPainel(fn, corpo) {
  if (!catSupabase || Date.now() - catSupabase.em > 5 * 60e3) catSupabase = { em: Date.now(), cat: (await lerCatalogo()).cat };
  return rpc(catSupabase.cat, fn, corpo);
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

module.exports = { githubOk, supabaseOk, rpcPainel, lerCatalogo, listarAparelhos, previaPrecos, executarPrecos, previaVitrine, executarVitrine, aplicarAlteracoes, previaAlteracoes, executarAlteracoes, catalogoCompleto, CONDICOES, clientesCrm, relatorioSite, hojeBR };
