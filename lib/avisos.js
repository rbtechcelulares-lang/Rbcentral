// Avisos de mudança de status de OS para o cliente, pelo WhatsApp da loja, sempre com a confirmação do dono.
// Toda vez que uma OS muda de status (pela Central ou no sistema de OS, que chama api/os-status), a Central
// monta o aviso e guarda como pendente no Supabase do site. O dono vê o aviso na Central e toca em
// "Enviar" (ou "Descartar"). Cada OS + status tem um aviso pendente só, e o mesmo aviso não volta em 12 horas.
// Variáveis (opcionais) na Vercel:
//   CENTRAL_AVISO_STATUS   "0" desliga os avisos de status
//   CENTRAL_MSG_OS_PRONTA  texto do aviso de concluído/pronto, com {nome} {aparelho} {numero} {valor}; \n = nova linha
const crypto = require('crypto');
const saas = require('./saas');
const whatsapp = require('./whatsapp');
const equipe = require('./equipe');
const rb = require('./rb');

const simples = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const ligado = () => String(process.env.CENTRAL_AVISO_STATUS || '1').trim() !== '0' && String(process.env.CENTRAL_AVISO_PRONTA || '1').trim() !== '0';

const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const primeiroNome = (n) => {
  const p = String(n || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
};

const ABERTURA = 'Olá, {nome}! Aqui é da *RB Tech Celulares*.\n';
const FECHO = '\nQualquer dúvida, é só responder esta mensagem.';
const PRONTA = ABERTURA + 'Seu {aparelho} (OS #{numero}) já está *pronto para retirada*. ✅{valor}' + FECHO;
// texto de cada tipo de status (o primeiro que combinar com o nome do status)
const FRASES = [
  [/conclu|pront|finaliz/, null], // usa PRONTA (ou CENTRAL_MSG_OS_PRONTA)
  [/entreg|retirad/, ABERTURA + 'Seu {aparelho} (OS #{numero}) foi *entregue*. Obrigado por confiar na RB Tech! Qualquer coisa, estamos à disposição.'],
  [/cancel/, ABERTURA + 'A OS #{numero} ({aparelho}) foi *cancelada*. Se precisar de algo, é só chamar.'],
  [/orcament|aprova/, ABERTURA + 'O orçamento do seu {aparelho} (OS #{numero}) está pronto.{valor} Podemos seguir com o conserto? É só responder esta mensagem.'],
  [/pec|aguard/, ABERTURA + 'Seu {aparelho} (OS #{numero}) está *aguardando peça*. Avisamos assim que ela chegar.' + FECHO],
  [/analis|diagnost|avalia/, ABERTURA + 'Seu {aparelho} (OS #{numero}) está *em análise*. Assim que terminarmos, te passamos o orçamento.' + FECHO],
  [/servic|repar|consert|manuten|andamento|execu/, ABERTURA + 'Seu {aparelho} (OS #{numero}) já está *em reparo*. Avisamos quando ficar pronto.' + FECHO]
];
const GERAL = ABERTURA + 'Atualização da sua OS #{numero} ({aparelho}): agora está *{status}*.' + FECHO;

function montar(os) {
  const st = simples(os.status);
  const achado = FRASES.find(([re]) => re.test(st));
  let t = achado ? (achado[1] || String(process.env.CENTRAL_MSG_OS_PRONTA || PRONTA).replace(/\\n/g, '\n')) : GERAL;
  const nome = primeiroNome(os.cliente && os.cliente.nome);
  const aparelho = [os.aparelho && os.aparelho.marca, os.aparelho && os.aparelho.modelo].filter(Boolean).join(' ').trim() || 'aparelho';
  const valor = !os.pago && Number(os.valor) > 0 ? '\nValor: ' + brl(os.valor) + '.' : '';
  if (!nome) t = t.replace(/,?\s*\{nome\}/g, '');
  return t.replace(/\{nome\}/g, nome).replace(/\{aparelho\}/g, aparelho).replace(/\{numero\}/g, String(os.numero || os.id || ''))
    .replace(/\{valor\}/g, valor).replace(/\{status\}/g, String(os.status || '').trim()).trim();
}

// lê a OS no sistema (só da minha loja: não confia em nada que veio no pedido) e monta o aviso
async function montarAviso(osId) {
  const d = await saas.verOS({ os_id: osId });
  const os = (d && d.os) || d || {};
  const numero = equipe.normalizar(os.cliente && os.cliente.whatsapp);
  if (!numero) return { motivo: 'a OS não tem o WhatsApp do cliente' };
  const aparelho = [os.aparelho && os.aparelho.marca, os.aparelho && os.aparelho.modelo].filter(Boolean).join(' ').trim();
  return {
    os_id: String(os.id || osId).slice(0, 60),
    status: String(os.status || '').trim().slice(0, 60) || '?',
    dados: { os_numero: String(os.numero || os.id || osId), cliente: String((os.cliente && os.cliente.nome) || '').slice(0, 80), numero, aparelho, mensagem: montar(os) }
  };
}

const novoId = () => crypto.randomBytes(10).toString('hex');
const comoCartao = (a) => ({
  id: a.id,
  titulo: 'Avisar ' + (a.cliente || equipe.formatar(a.numero)) + ' · OS #' + a.os_numero + ' · ' + a.status,
  linhas: ['Para: ' + (a.cliente || 'cliente') + ' · ' + equipe.formatar(a.numero) + (a.aparelho ? ' · ' + a.aparelho : ''), a.mensagem]
});

// mudança de status: guarda o aviso como pendente para o dono confirmar
async function prepararAviso(osId) {
  if (!ligado()) return { pendente: false, motivo: 'avisos de status desligados (CENTRAL_AVISO_STATUS=0)' };
  const m = await montarAviso(osId);
  if (!m.dados) return { pendente: false, motivo: m.motivo };
  const id = await rb.rpcPainel('central_aviso_criar', { p_id: novoId(), p_os_id: m.os_id, p_status: m.status, p_dados: m.dados });
  if (!id) return { pendente: false, motivo: 'esse aviso já foi enviado há pouco' };
  return { pendente: true, aviso: comoCartao(Object.assign({ id, os_id: m.os_id, status: m.status }, m.dados)) };
}

async function listar() {
  const lista = await rb.rpcPainel('central_avisos_listar', {});
  return (Array.isArray(lista) ? lista : []).map((a) => Object.assign(comoCartao(a), { criado: a.criado }));
}

// "Enviar": marca como enviado antes de mandar (não manda duas vezes) e desfaz se o WhatsApp falhar
async function enviar(id) {
  const a = await rb.rpcPainel('central_aviso_marcar', { p_id: id, p_de: 'pendente', p_para: 'enviado' });
  if (!a) throw new Error('Esse aviso já foi enviado ou descartado.');
  if (!whatsapp.ok()) return { enviado: false, link: equipe.link(a.numero, a.mensagem) }; // sem envio automático: o dono manda pelo WhatsApp
  try {
    await whatsapp.enviar(a.numero, a.mensagem);
  } catch (e) {
    await rb.rpcPainel('central_aviso_marcar', { p_id: id, p_de: 'enviado', p_para: 'pendente' }).catch(() => null);
    throw e;
  }
  console.log('rb-central aviso-status', JSON.stringify({ quando: new Date().toISOString(), os: a.os_numero, status: a.status }));
  return { enviado: true };
}

async function descartar(id) {
  const a = await rb.rpcPainel('central_aviso_marcar', { p_id: id, p_de: 'pendente', p_para: 'descartado' });
  if (!a) throw new Error('Esse aviso já foi enviado ou descartado.');
  return { descartado: true };
}

module.exports = { ligado, montar, montarAviso, prepararAviso, listar, enviar, descartar };
