// Pedidos de peças aos fornecedores: a lista fica no Supabase do site (tabelas central_pecas e
// central_fornecedores, SQL em supabase/central_conversas.sql). A Central adiciona pedidos, guarda o WhatsApp
// de cada fornecedor e monta a mensagem para perguntar o preço ou pedir o envio, que sai com um toque
// (pela Z-API) depois que o dono confirma, igual às mensagens para cliente.
const crypto = require('crypto');
const rb = require('./rb');
const saas = require('./saas');
const equipe = require('./equipe');
const whatsapp = require('./whatsapp');
const auth = require('./auth');

const STATUS = { a_pedir: 'A pedir', cotando: 'Esperando o preço', pedido: 'Pedido ao fornecedor', chegou: 'Chegou', cancelado: 'Cancelado' };
const novoId = () => crypto.randomBytes(8).toString('hex');
const texto = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const simples = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ativo = () => rb.githubOk() && rb.supabaseOk();

// ---------- leitura ----------
const fornecedores = () => rb.rpcPainel('central_fornecedores_listar', {}).then((l) => (Array.isArray(l) ? l : []));

async function listar({ status, busca, limite } = {}) {
  const st = ['abertos', 'todos'].concat(Object.keys(STATUS)).includes(status) ? status : 'abertos';
  const lista = await rb.rpcPainel('central_pecas_listar', { p_status: st, p_busca: texto(busca, 60), p_limite: Math.min(Math.max(parseInt(limite, 10) || 50, 1), 100) });
  return (Array.isArray(lista) ? lista : []).map(resumo);
}
const resumo = (p) => ({
  id: p.id, numero: p.numero, peca: p.peca, aparelho: p.aparelho || '', quantidade: p.quantidade || 1,
  fornecedor: p.fornecedor ? p.fornecedor.nome : '', fornecedor_whatsapp: p.fornecedor ? p.fornecedor.whatsapp || '' : '',
  os_numero: p.os_numero || '', status: p.status, situacao: STATUS[p.status] || p.status,
  valor: p.valor != null ? Number(p.valor) : null, previsao: p.previsao || '', observacoes: p.observacoes || '', atualizado: p.atualizado
});

// pedidos do sistema de OS, se ele tiver essa lista (melhor esforço: muitos sistemas ainda não guardam)
async function listarComSistema(i) {
  const [central, sistema] = await Promise.all([
    ativo() ? listar(i) : Promise.resolve([]),
    saas.ok() ? saas.pedidosPecas(i).then((r) => (r && Array.isArray(r.pedidos) ? r.pedidos : [])).catch(() => []) : Promise.resolve([])
  ]);
  return { pedidos: central, pedidos_do_sistema_de_os: sistema.length ? sistema : undefined, status_possiveis: STATUS };
}

// acha o fornecedor pelo nome (sem acento e sem diferença de maiúsculas; aceita um pedaço do nome)
async function acharFornecedor(nome) {
  const n = simples(nome);
  if (!n) return null;
  const lista = await fornecedores();
  return lista.find((f) => simples(f.nome) === n) || lista.find((f) => simples(f.nome).includes(n) || n.includes(simples(f.nome))) || null;
}

async function acharPedido(ref) {
  const r = String(ref || '').replace(/^#/, '').trim();
  if (!r) throw new Error('falta o número do pedido de peça');
  const lista = await rb.rpcPainel('central_pecas_listar', { p_status: 'todos', p_busca: '', p_limite: 100 });
  const p = (Array.isArray(lista) ? lista : []).find((x) => String(x.numero) === r || x.id === r);
  if (!p) throw new Error('não achei o pedido de peça ' + r);
  return p;
}

// ---------- gravação (só depois da confirmação do dono, ou pelo toque dele no painel) ----------
async function salvarFornecedor(d) {
  const nome = texto(d.nome, 80);
  if (!nome) throw new Error('falta o nome do fornecedor');
  const numero = d.whatsapp ? equipe.normalizar(d.whatsapp) : '';
  if (d.whatsapp && !numero) throw new Error('WhatsApp do fornecedor inválido: use DDD e número');
  return rb.rpcPainel('central_fornecedor_salvar', { p_dados: { novo_id: novoId(), id: d.id || '', nome, whatsapp: numero, observacoes: texto(d.observacoes, 300) } });
}

async function prepararFornecedor(nome, whatsappNovo) {
  if (!texto(nome, 80)) return '';
  const f = await acharFornecedor(nome);
  if (f && !whatsappNovo) return f.id;
  const salvo = await salvarFornecedor({ id: f ? f.id : '', nome: f ? f.nome : nome, whatsapp: whatsappNovo || '' });
  return salvo.id;
}

async function adicionar(d) {
  const peca = texto(d.peca, 120);
  if (!peca) throw new Error('falta a peça');
  const quantidade = Math.round(Number(d.quantidade) || 1);
  if (quantidade < 1 || quantidade > 99) throw new Error('quantidade de 1 a 99');
  const dados = { novo_id: novoId(), peca, aparelho: texto(d.aparelho, 120), quantidade, os_numero: texto(d.os_numero, 20), observacoes: texto(d.observacoes, 300) };
  dados.fornecedor_id = await prepararFornecedor(d.fornecedor, d.fornecedor_whatsapp);
  return resumo(await rb.rpcPainel('central_peca_salvar', { p_dados: dados }));
}

async function atualizar(d) {
  const p = await acharPedido(d.pedido || d.id);
  const dados = { id: p.id };
  if (d.status) {
    if (!STATUS[d.status]) throw new Error('status: use ' + Object.keys(STATUS).join(', '));
    dados.status = d.status;
  }
  if (d.valor !== undefined && d.valor !== null && d.valor !== '') {
    const v = Number(d.valor);
    if (!Number.isFinite(v) || v < 0) throw new Error('valor inválido');
    dados.valor = Math.round(v * 100) / 100;
  }
  if (d.previsao) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.previsao)) throw new Error('previsão: use AAAA-MM-DD');
    dados.previsao = d.previsao;
  }
  if (d.observacoes !== undefined && d.observacoes !== '') dados.observacoes = texto(d.observacoes, 300);
  if (d.fornecedor) dados.fornecedor_id = await prepararFornecedor(d.fornecedor, d.fornecedor_whatsapp);
  return { antes: resumo(p), depois: resumo(await rb.rpcPainel('central_peca_salvar', { p_dados: dados })) };
}

// ---------- mensagem para o fornecedor ----------
const descrever = (p) => (p.quantidade > 1 ? p.quantidade + 'x ' : '') + p.peca + (p.aparelho ? ' para ' + p.aparelho : '');
function mensagemPadrao(p, tipo, nomeFornecedor) {
  const ola = 'Olá' + (nomeFornecedor ? ', ' + nomeFornecedor : '') + '! Aqui é da RB Tech Celulares.';
  if (tipo === 'cotar') return ola + '\nQual o preço e o prazo de ' + descrever(p) + '?\nObrigado!';
  return ola + '\nPode me enviar ' + descrever(p) + '?\nMe confirma o valor e quando chega, por favor. Obrigado!';
}

// cartão para o dono: com a Z-API ligada, sai com um toque em Confirmar; sem ela, o botão abre o WhatsApp
async function cartaoMensagem(ref, tipo, textoProprio) {
  const p = await acharPedido(ref);
  const f = p.fornecedor;
  if (!f) throw new Error('o pedido #' + p.numero + ' ainda não tem fornecedor: diga de qual fornecedor é');
  if (!f.whatsapp) throw new Error('o fornecedor ' + f.nome + ' não tem WhatsApp cadastrado: diga o número dele');
  const t = tipo === 'cotar' ? 'cotar' : 'pedir';
  const mensagem = texto(textoProprio, 1) ? String(textoProprio).trim().slice(0, 1500) : mensagemPadrao(p, t, f.nome);
  const titulo = (t === 'cotar' ? 'Perguntar o preço a ' : 'Pedir o envio a ') + f.nome + ' · peça #' + p.numero;
  const linhas = ['Para: ' + f.nome + ' · ' + equipe.formatar(f.whatsapp), mensagem];
  const link = equipe.link(f.whatsapp, mensagem);
  if (!whatsapp.ok()) return { tipo: 'whatsapp', titulo, linhas, link, whatsapp: true };
  const entrada = { pedido_id: p.id, numero: f.whatsapp, nome: f.nome, mensagem, status: t === 'cotar' ? 'cotando' : 'pedido' };
  return { token: auth.selar({ tipo: 'acao', uid: crypto.randomUUID(), nome: 'peca_mensagem_enviar', entrada }, 15), titulo, linhas, link, whatsapp: true };
}

// "Confirmar": manda pela Z-API e muda o status do pedido (esperando preço / pedido ao fornecedor)
async function enviarMensagem(e) {
  await whatsapp.enviar(e.numero, e.mensagem);
  let feito = 'Mensagem enviada para ' + e.nome + ' pelo WhatsApp da loja.';
  try {
    const r = await rb.rpcPainel('central_peca_salvar', { p_dados: { id: e.pedido_id, status: e.status } });
    feito += ' Pedido #' + r.numero + ': ' + STATUS[e.status] + '.';
  } catch (er) { /* a mensagem saiu; o status fica como estava */ }
  return { feito: [feito] };
}

module.exports = { STATUS, ativo, listar, listarComSistema, fornecedores, acharPedido, salvarFornecedor, adicionar, atualizar, cartaoMensagem, enviarMensagem, mensagemPadrao, resumo, brl };
