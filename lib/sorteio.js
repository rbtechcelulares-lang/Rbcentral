// Sorteio para clientes: a Central lê as vendas do sistema de OS (GET /vendas) nos dias pedidos e gera
// um cupom para cada cliente que comprou celular nesses dias. O ganhador é sorteado pela Central (número
// aleatório do servidor, nunca pela IA), depois que o dono confirma, e o resultado fica registrado no
// Supabase do site (central_config "sorteios"), para não dar para sortear de novo sem ninguém saber.
const crypto = require('crypto');
const saas = require('./saas');
const rb = require('./rb');
const auth = require('./auth');
const equipe = require('./equipe');

const MAX_DIAS = 62;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const simples = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const txt = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 120);
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);

// ---------- dias pedidos ----------
function somarDia(d, n) {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function diaValido(d) {
  if (!DIA.test(d)) return false;
  const x = new Date(d + 'T12:00:00Z');
  return !isNaN(x) && x.toISOString().slice(0, 10) === d;
}
// { dias: ['AAAA-MM-DD', ...] } (dias soltos) ou { de, ate } (intervalo) → lista ordenada e sem repetir
function diasPedidos(i) {
  i = i || {};
  let dias = [];
  if (Array.isArray(i.dias) && i.dias.length) dias = i.dias.map((d) => String(d).trim());
  else if (i.de || i.ate) {
    const de = String(i.de || i.ate).trim(), ate = String(i.ate || i.de).trim();
    if (!diaValido(de) || !diaValido(ate)) throw new Error('datas inválidas: use AAAA-MM-DD');
    if (ate < de) throw new Error('a data final é antes da inicial');
    for (let d = de; d <= ate && dias.length <= MAX_DIAS; d = somarDia(d, 1)) dias.push(d);
  }
  if (!dias.length) throw new Error('diga os dias das vendas do sorteio (dias, ou de e ate, em AAAA-MM-DD)');
  const ruim = dias.find((d) => !diaValido(d));
  if (ruim) throw new Error('data inválida: ' + ruim + ' (use AAAA-MM-DD)');
  dias = [...new Set(dias)].sort();
  if (dias.length > MAX_DIAS) throw new Error('no máximo ' + MAX_DIAS + ' dias por sorteio');
  return dias;
}
function textoPeriodo(dias) {
  if (dias.length === 1) return dataBR(dias[0]);
  const seguidos = dias.every((d, k) => !k || somarDia(dias[k - 1], 1) === d);
  return seguidos ? dataBR(dias[0]) + ' a ' + dataBR(dias[dias.length - 1]) : dias.map(dataBR).join(', ');
}

// dia da venda no horário de Brasília (aceita ISO com fuso, ISO sem fuso = já é Brasília, e DD/MM/AAAA)
function diaDaVenda(v) {
  const s = String((v && (v.criado_em || v.data)) || '').trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return '';
  if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s)) return s.slice(0, 10);
  const t = new Date(s);
  return isNaN(t) ? '' : new Date(t.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
}
const quando = (v) => { const t = new Date(String(v.criado_em || '')); return isNaN(t) ? 0 : t.getTime(); };

// ---------- o que conta como celular ----------
const CELULAR = /\b(iphone|celular|smartphone|galaxy|xiaomi|redmi|poco|motorola|moto\s?[geg]\d*|realme|samsung|zenfone|pixel)\b/i;
const ACESSORIO = /\b(capa|capinha|case|pel[ií]cula|vidro|carregador|cabo|fonte|fone|airpods?|earpods|suporte|lente|bateria|tela|display|conector|adaptador|power\s?bank|smartwatch|watch|pulseira|caneta|chip|chaveiro|tripe|trip[eé]|frontal|traseira|tampa|reparo|conserto|servi[cç]o|m[aã]o de obra)\b/i;
function ehCelular(item) {
  if (!item || typeof item !== 'object') return false;
  const tipo = simples(item.tipo);
  if (tipo === 'aparelho' || tipo === 'celular') return true;
  if (tipo === 'servico') return false;
  // produto ou avulso: celular pelo nome (iPhone, Xiaomi...), tirando acessórios ("Película iPhone 13")
  const d = txt(item.descricao || item.nome || item.modelo, 200);
  return CELULAR.test(d) && !ACESSORIO.test(d);
}
const descreverItem = (x) => txt(x.descricao || x.nome || [x.marca, x.modelo, x.armazenamento, x.cor].filter(Boolean).join(' '), 80) || 'celular';

// "cliente" que na verdade é a loja, o balcão ou ninguém: a venda fica sem cliente (não dá cupom com nome)
const SEM_NOME = /^(rb ?tech( celulares)?|rbtechcelulares|loja|balcao|consumidor( final)?|cliente( final| avulso| balcao)?|venda avulsa|nao informado|sem nome|-+|\.+)$/;
function clienteDaVenda(v) {
  const c = v && v.cliente && typeof v.cliente === 'object' ? v.cliente : {};
  const nome = txt(c.nome, 80), whatsapp = equipe.normalizar(c.whatsapp);
  if (!whatsapp && (!nome || SEM_NOME.test(simples(nome)))) return null;
  return { nome: nome && !SEM_NOME.test(simples(nome)) ? nome : '', whatsapp };
}

// equipe e família do dono (CENTRAL_EQUIPE / CENTRAL_PESSOAL) não participam do sorteio
function daEquipe(c) {
  const lista = equipe.equipe();
  if (c.whatsapp && lista.some((p) => p.numero === c.whatsapp)) return true;
  const n = simples(c.nome);
  if (!n) return false;
  return lista.some((p) => {
    const e = simples(p.nome);
    return e === n || ((!e.includes(' ') || !n.includes(' ')) && e.split(' ')[0] === n.split(' ')[0]);
  });
}

// ---------- lê as vendas do sistema de OS ----------
async function vendasDoPeriodo(dias) {
  if (!saas.ok()) throw new Error('o sistema de OS não está ligado na Central (SAAS_API_URL e SAAS_API_TOKEN na Vercel)');
  let r;
  try {
    r = await saas.vendas({ desde: dias[0], ate: dias[dias.length - 1] });
  } catch (e) {
    if (e.status === 404 || e.status === 405 || e.status === 501) {
      throw new Error('o sistema de OS ainda não mostra a lista de vendas para a Central (GET /vendas). Cole no Claude Code do sistema o prompt docs/PROMPT-VENDAS-LISTA.md, da Central');
    }
    throw e;
  }
  const lista = r && Array.isArray(r.vendas) ? r.vendas : null;
  if (!lista) throw new Error('o sistema de OS respondeu sem a lista "vendas"');
  const quer = new Set(dias);
  return lista.filter((v) => v && typeof v === 'object' && !v.cancelada && !/cancel|estorn/i.test(String(v.status || '')) && quer.has(diaDaVenda(v)));
}

// ---------- cupons ----------
const assinar = (texto) => crypto.createHmac('sha256', auth.chaveDerivada('sorteio')).update(texto).digest();
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I, para ninguém confundir lendo
const codigo4 = (texto) => [...assinar(texto).subarray(0, 4)].map((b) => LETRAS[b % LETRAS.length]).join('');

async function compilar(i) {
  const dias = diasPedidos(i);
  const vendas = await vendasDoPeriodo(dias);
  const grupos = new Map(), semCliente = [], equipeFora = [];
  let vendasCelular = 0;
  vendas.slice().sort((a, b) => quando(a) - quando(b) || String(a.numero || '').localeCompare(String(b.numero || ''))).forEach((v) => {
    const cels = (Array.isArray(v.itens) ? v.itens : []).filter(ehCelular);
    if (!cels.length) return;
    vendasCelular++;
    const compra = { venda: txt(v.numero || v.id, 20), dia: dataBR(diaDaVenda(v)), aparelhos: cels.map(descreverItem), total: Number(v.total) || 0 };
    const c = clienteDaVenda(v);
    if (!c) { semCliente.push(compra); return; }
    if (daEquipe(c)) { equipeFora.push(Object.assign({ cliente: c.nome || '+' + c.whatsapp }, compra)); return; }
    const chave = c.whatsapp || 'nome:' + simples(c.nome);
    if (!grupos.has(chave)) grupos.set(chave, { chave, cliente: c.nome || ('+' + c.whatsapp), whatsapp: c.whatsapp, compras: [] });
    const g = grupos.get(chave);
    if (!g.whatsapp && c.whatsapp) g.whatsapp = c.whatsapp;
    if (/^\+\d+$/.test(g.cliente) && c.nome) g.cliente = c.nome;
    g.compras.push(compra);
  });
  const id = dias.join(',');
  const cupons = [...grupos.values()].map((g, k) => {
    const n = String(k + 1).padStart(3, '0');
    return {
      numero: n,
      codigo: 'RB-' + n + '-' + codigo4(id + '|' + g.chave),
      cliente: g.cliente,
      whatsapp: g.whatsapp || '',
      aparelhos: g.compras.flatMap((x) => x.aparelhos),
      vendas: g.compras.map((x) => '#' + x.venda + ' (' + x.dia + ')'),
      chave: g.chave
    };
  });
  return {
    id, dias, periodo: textoPeriodo(dias),
    vendas_no_periodo: vendas.length,
    vendas_com_celular: vendasCelular,
    cupons,
    vendas_de_celular_sem_cliente: semCliente.map((x) => '#' + x.venda + ' (' + x.dia + ') · ' + x.aparelhos.join(', ') + (x.total ? ' · ' + brl(x.total) : '')),
    compras_da_equipe_fora: equipeFora.map((x) => x.cliente + ' · #' + x.venda + ' (' + x.dia + ') · ' + x.aparelhos.join(', '))
  };
}

// o que a IA recebe (sem a chave interna do agrupamento)
async function cupons(i) {
  const r = await compilar(i);
  const anterior = await ultimoSorteio(r.id).catch(() => null);
  return {
    periodo: r.periodo, dias: r.dias, vendas_no_periodo: r.vendas_no_periodo, vendas_com_celular: r.vendas_com_celular,
    total_de_cupons: r.cupons.length,
    cupons: r.cupons.map(({ chave, ...c }) => c),
    vendas_de_celular_sem_cliente: r.vendas_de_celular_sem_cliente,
    compras_da_equipe_fora: r.compras_da_equipe_fora.length ? r.compras_da_equipe_fora : undefined,
    sorteio_ja_feito: anterior ? { em: anterior.em, ganhador: anterior.cupom + ' · ' + anterior.cliente } : null,
    regra: 'Um cupom por cliente que comprou celular nos dias pedidos (quem comprou mais de um no período continua com um cupom). Venda de celular sem cliente (ou com a própria loja como cliente) não gera cupom: o dono põe o cliente certo na venda, no sistema, e pede de novo. Equipe e família do dono ficam fora do sorteio.'
  };
}

// ---------- sorteio (registrado) ----------
async function lerRegistro() {
  const v = await rb.rpcPainel('central_config_ler', { p_nome: 'sorteios' });
  try { const l = JSON.parse(v || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
async function salvarRegistro(lista) {
  let l = lista.slice(-20), t = JSON.stringify(l);
  while (t.length > 3900 && l.length > 1) { l = l.slice(1); t = JSON.stringify(l); }
  await rb.rpcPainel('central_config_salvar', { p_nome: 'sorteios', p_valor: t });
}
async function ultimoSorteio(id) {
  const l = await lerRegistro();
  return l.filter((x) => x.id === id).pop() || null;
}

async function previaSortear(i) {
  const r = await compilar(i);
  if (!r.cupons.length) throw new Error('nenhum cliente com cupom nas vendas de ' + r.periodo + (r.vendas_de_celular_sem_cliente.length ? ' (há ' + r.vendas_de_celular_sem_cliente.length + ' venda(s) de celular sem cliente cadastrado)' : ''));
  const anterior = await ultimoSorteio(r.id).catch((e) => { throw new Error('não consegui ler o registro dos sorteios (' + e.message + '). Rode o SQL da Central no Supabase (tabela central_config)'); });
  if (anterior && !i.de_novo) throw new Error('as vendas de ' + r.periodo + ' já foram sorteadas em ' + anterior.em + ': ganhador ' + anterior.cupom + ' · ' + anterior.cliente + '. Para sortear de novo (ex.: o ganhador não respondeu), o dono precisa pedir com todas as letras e você usa de_novo=true');
  return {
    titulo: (anterior ? '🎟️ Sortear DE NOVO' : '🎟️ Sortear o ganhador') + ' · vendas de ' + r.periodo,
    linhas: [
      'Cupons no sorteio: ' + r.cupons.length + ' (clientes que compraram celular)',
      ...(r.vendas_de_celular_sem_cliente.length ? ['Fora do sorteio: ' + r.vendas_de_celular_sem_cliente.length + ' venda(s) de celular sem cliente cadastrado'] : []),
      ...(anterior ? ['Já sorteado antes: ' + anterior.cupom + ' · ' + anterior.cliente + ' (fica no registro)'] : []),
      'A Central sorteia com número aleatório e registra o resultado.'
    ]
  };
}

async function sortear(i) {
  const r = await compilar(i);
  if (!r.cupons.length) throw new Error('nenhum cliente com cupom nas vendas de ' + r.periodo);
  const lista = await lerRegistro();
  const anterior = lista.filter((x) => x.id === r.id).pop();
  if (anterior && !i.de_novo) throw new Error('esse período já foi sorteado em ' + anterior.em + ' (' + anterior.cupom + ' · ' + anterior.cliente + ')');
  const g = r.cupons[crypto.randomInt(r.cupons.length)];
  const em = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  lista.push({ id: r.id, periodo: r.periodo, em, total: r.cupons.length, cupom: g.codigo, cliente: txt(g.cliente, 40), de_novo: !!anterior });
  await salvarRegistro(lista);
  return {
    feito: [
      '🎉 Ganhador: cupom ' + g.codigo + ' · ' + g.cliente + (g.whatsapp ? ' · ' + equipe.formatar(g.whatsapp) : '') + ' · ' + g.aparelhos.join(', '),
      'Sorteado entre ' + r.cupons.length + ' cupons das vendas de ' + r.periodo + (anterior ? ' (sorteio refeito; o anterior, ' + anterior.cupom + ', continua no registro)' : '') + '. Registrado em ' + em + '.'
    ],
    ganhador: { cupom: g.codigo, cliente: g.cliente, whatsapp: g.whatsapp, aparelhos: g.aparelhos, vendas: g.vendas }
  };
}

module.exports = { diasPedidos, diaDaVenda, ehCelular, clienteDaVenda, compilar, cupons, previaSortear, sortear, textoPeriodo };
