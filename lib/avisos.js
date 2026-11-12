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
  titulo: 'Avisar ' + (a.cliente || equipe.formatar(a.numero)) + ' · ' + (a.rotulo || 'OS #' + a.os_numero + ' · ' + a.status),
  linhas: ['Para: ' + (a.cliente || 'cliente') + ' · ' + equipe.formatar(a.numero) + (a.aparelho ? ' · ' + a.aparelho : ''), a.mensagem]
});

// mudança de status: guarda o aviso como pendente para o dono confirmar
async function prepararAviso(osId, jaEnviado, mensagem) {
  if (!ligado()) return { pendente: false, motivo: 'avisos de status desligados (CENTRAL_AVISO_STATUS=0)' };
  const m = await montarAviso(osId);
  if (!m.dados) return { pendente: false, motivo: m.motivo };
  if (mensagem) m.dados.mensagem = mensagem;
  const id = await rb.rpcPainel('central_aviso_criar', { p_id: novoId(), p_os_id: m.os_id, p_status: m.status, p_dados: m.dados });
  if (!id) return { pendente: false, motivo: 'esse aviso já foi enviado há pouco' };
  if (jaEnviado) return registrarEnviado(id);
  return { pendente: true, aviso: comoCartao(Object.assign({ id, os_id: m.os_id, status: m.status }, m.dados)) };
}

// o sistema de OS já mandou essa mensagem pelo botão dele: some da lista da Central e não é oferecida de novo
async function registrarEnviado(id) {
  await rb.rpcPainel('central_aviso_marcar', { p_id: id, p_de: 'pendente', p_para: 'enviado' });
  return { pendente: false, registrado: true, motivo: 'enviado pelo sistema de OS' };
}

// a Central mandou: avisa o sistema de OS, para ele não oferecer a mesma mensagem de novo (melhor esforço, até 4 s)
async function avisarSistema(a) {
  if (!saas.ok() || !a || !a.os_id) return;
  const [tipo, ...resto] = String(a.os_id).includes(':') ? String(a.os_id).split(':') : ['status', a.os_id];
  const corpo = { tipo, id: resto.join(':'), status: String(a.status || '').replace(/^follow_up:/, '') };
  await Promise.race([saas.marcarEnviado(corpo).catch(() => null), new Promise((ok) => setTimeout(ok, 4000))]);
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
  await avisarSistema(a);
  return { enviado: true };
}

async function descartar(id) {
  const a = await rb.rpcPainel('central_aviso_marcar', { p_id: id, p_de: 'pendente', p_para: 'descartado' });
  if (!a) throw new Error('Esse aviso já foi enviado ou descartado.');
  return { descartado: true };
}


// ---------- Eventos do sistema de OS: venda, OS aberta, orçamento, status e follow-up ----------
// O sistema chama api/evento a cada acontecimento. A Central monta a mensagem e deixa pendente para o
// dono confirmar (botão "Enviar"). Como nada sai sem o "Enviar", dá para confiar nos dados do evento,
// que já vem autenticado pela chave combinada (SAAS_API_TOKEN) e precisa ser da loja SAAS_LOJA.
const TIPOS = { venda: 'Venda', os_criada: 'OS aberta', orcamento: 'Orçamento', status: 'Status', follow_up: 'Follow-up' };
const txt = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 120);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

const NOME_MOTIVO = { orcamento_sem_resposta: 'orçamento sem resposta', aguardando_retirada: 'aguardando retirada', pos_venda: 'pós-venda', pos_reparo: 'pós-reparo' };
const MOTIVOS = {
  orcamento_sem_resposta: ABERTURA + 'Conseguiu ver o orçamento do seu {aparelho}{ref}?{valor} Se quiser seguir com o conserto, é só responder *SIM*. 😊',
  aguardando_retirada: ABERTURA + 'Seu {aparelho}{ref} está pronto e te esperando aqui na loja. Qual o melhor dia para você buscar?',
  pos_venda: ABERTURA + 'Passando para saber: está tudo certo com seu {produto}? Qualquer coisa, estamos à disposição.',
  pos_reparo: ABERTURA + 'Passando para saber: seu {aparelho} está funcionando direitinho depois do conserto? Qualquer coisa, estamos à disposição.'
};

function montarEvento(tipo, cliente, d) {
  const nome = primeiroNome(cliente.nome);
  const aparelho = txt(d.aparelho, 80) || 'aparelho';
  const ref = d.numero ? ' (' + (tipo === 'venda' ? 'pedido' : 'OS') + ' #' + txt(d.numero, 20) + ')' : '';
  const valorTxt = num(d.valor) ? '\nValor: ' + brl(d.valor) + '.' : '';
  let t;
  if (tipo === 'venda') {
    const itens = (Array.isArray(d.itens) ? d.itens : []).slice(0, 12).map((i) => '• ' + (num(i.quantidade) > 1 ? num(i.quantidade) + 'x ' : '') + txt(i.descricao, 80) + (num(i.valor) ? ' — ' + brl(i.valor) : '')).join('\n');
    t = ABERTURA + 'Obrigado pela sua compra! 🙌' + (itens ? '\n' + itens : '') +
      (num(d.total) ? '\nTotal: ' + brl(d.total) + (txt(d.forma_pagamento, 30) ? ' (' + txt(d.forma_pagamento, 30) + ')' : '') + '.' : '') +
      (txt(d.garantia, 80) ? '\nGarantia: ' + txt(d.garantia, 80) + '.' : '') + FECHO;
  } else if (tipo === 'os_criada') {
    t = ABERTURA + 'Recebemos seu {aparelho}{ref}' + (txt(d.defeito, 120) ? ' para *' + txt(d.defeito, 120) + '*' : '') + '.' +
      (txt(d.previsao, 40) ? '\nPrevisão: ' + txt(d.previsao, 40) + '.' : '') + '\nVamos te avisando a cada etapa.' + FECHO;
  } else if (tipo === 'orcamento') {
    t = ABERTURA + 'O orçamento do seu {aparelho}{ref} ficou em *' + (num(d.valor) ? brl(d.valor) : 'valor a confirmar') + '*' +
      (txt(d.servico, 120) ? ' (' + txt(d.servico, 120) + ')' : '') + '.' + (txt(d.validade, 40) ? '\nVálido até ' + txt(d.validade, 40) + '.' : '') +
      '\nPodemos seguir com o conserto? É só responder *SIM*.';
  } else if (tipo === 'follow_up') {
    t = MOTIVOS[txt(d.motivo, 40)] || (ABERTURA + 'Passando para saber se está tudo certo com você. Qualquer coisa, é só responder esta mensagem.');
  } else {
    t = GERAL;
  }
  if (!nome) t = t.replace(/,?\s*\{nome\}/g, '');
  return t.replace(/\{nome\}/g, nome).replace(/\{aparelho\}/g, aparelho).replace(/\{produto\}/g, txt(d.produto, 80) || aparelho)
    .replace(/\{ref\}/g, ref).replace(/\{valor\}/g, valorTxt).replace(/\{numero\}/g, txt(d.numero, 20)).replace(/\{status\}/g, txt(d.status, 40)).trim();
}

async function prepararEvento(ev) {
  ev = ev && typeof ev === 'object' ? ev : {};
  if (!ligado()) return { pendente: false, motivo: 'avisos desligados (CENTRAL_AVISO_STATUS=0)' };
  const tipo = txt(ev.tipo, 20);
  if (!TIPOS[tipo]) return { pendente: false, motivo: 'tipo desconhecido: use ' + Object.keys(TIPOS).join(', ') };
  if (txt(ev.loja, 60).toLowerCase() !== saas.minhaLoja()) return { pendente: false, motivo: 'evento de outra loja: ignorado' };
  const id = txt(ev.id, 40);
  if (!id) return { pendente: false, motivo: 'falta o id do registro' };
  const jaEnviado = ev.ja_enviado === true;
  const textoProprio = typeof ev.mensagem === 'string' ? ev.mensagem.replace(/\r/g, '').trim().slice(0, 1500) : '';
  if (tipo === 'status') return prepararAviso(id, jaEnviado, textoProprio); // status: a Central lê a OS de novo no sistema
  const cliente = ev.cliente && typeof ev.cliente === 'object' ? ev.cliente : {};
  const numero = equipe.normalizar(cliente.whatsapp);
  if (!numero) return { pendente: false, motivo: 'o evento não tem o WhatsApp do cliente' };
  const d = ev.dados && typeof ev.dados === 'object' ? ev.dados : {};
  const proprio = typeof ev.mensagem === 'string' ? ev.mensagem.replace(/\r/g, '').trim().slice(0, 1500) : '';
  const rotulo = TIPOS[tipo] + (d.numero ? ' #' + txt(d.numero, 20) : '') + (tipo === 'follow_up' && d.motivo ? ' · ' + (NOME_MOTIVO[txt(d.motivo, 40)] || txt(d.motivo, 40).replace(/_/g, ' ')) : '');
  const dados = {
    os_numero: txt(d.numero, 20), cliente: txt(cliente.nome, 80), numero,
    aparelho: txt(d.aparelho || d.produto, 80), mensagem: proprio || montarEvento(tipo, cliente, d), rotulo
  };
  const idAviso = await rb.rpcPainel('central_aviso_criar', {
    p_id: novoId(), p_os_id: (tipo + ':' + id).slice(0, 60),
    p_status: (tipo === 'follow_up' ? 'follow_up:' + (txt(d.motivo, 40) || 'geral') : tipo).slice(0, 60), p_dados: dados
  });
  if (!idAviso) return { pendente: false, motivo: 'essa mensagem já foi enviada há pouco' };
  if (jaEnviado) return registrarEnviado(idAviso);
  return { pendente: true, aviso: comoCartao(Object.assign({ id: idAviso, status: tipo }, dados)) };
}

module.exports = { ligado, montar, montarAviso, prepararAviso, prepararEvento, montarEvento, listar, enviar, descartar };
