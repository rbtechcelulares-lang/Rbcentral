// Ferramentas da IA. As de leitura rodam na hora; as que alteram algo viram um pedido de
// confirmação para o dono (botão "Confirmar" na tela) e só rodam em api/confirmar.
const rb = require('./rb');
const saas = require('./saas');
const whatsapp = require('./whatsapp');
const avisos = require('./avisos');
const crmWhatsapp = require('./crm-whatsapp');
const equipe = require('./equipe');
const auth = require('./auth');
const crypto = require('crypto');

const obj = (props, req) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const T = (name, description, props, req) => ({ name, description, input_schema: obj(props, req || Object.keys(props)), strict: true });
const txt = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });

const LEITURA = [
  T('site_listar_aparelhos', 'Lista aparelhos do site RB Tech (id, preço, vitrine, condição). Use antes de alterar preço ou vitrine para achar os ids.',
    { busca: txt('Texto para filtrar, ex.: "iPhone 13", "seminovo", "xiaomi". Vazio = todos'), so_vitrine: { type: 'boolean', description: 'true = só os que estão na vitrine' } }),
  T('site_clientes_crm', 'Lista clientes do CRM do site (quem passou nome e WhatsApp no RBChat, proposta ou reparo).',
    { status: { type: 'string', enum: ['novo', 'contatado', 'negociando', 'comprou', 'perdido', 'todos'] }, desde: txt('Data ISO (AAAA-MM-DD) a partir da qual listar; vazio = todos') }),
  T('relatorio_do_dia', 'Relatório do dia dos dois sistemas: site (cliques, propostas, clientes novos) e sistema de OS (OS, faturamento, metas, peças).',
    { dia: txt('AAAA-MM-DD; vazio = hoje') }),
  T('os_listar', 'Lista ordens de serviço do sistema de OS.',
    { status: txt('Status para filtrar (vazio = todos)'), desde: txt('AAAA-MM-DD ou vazio'), busca: txt('Nome do cliente, aparelho ou número da OS; vazio = todos') }),
  T('os_ver', 'Mostra os detalhes de uma OS.', { os_id: txt('id ou número da OS') }),
  T('os_configuracao', 'Lista os status válidos de OS e as formas de pagamento aceitas pelo sistema. Use antes de mudar status ou marcar pagamento se não souber os valores.', {}),
  T('metas_listar', 'Lista as metas do sistema de OS (valor da meta e quanto já foi feito).', {}),
  T('pecas_listar_pedidos', 'Lista pedidos de peças aos fornecedores.', { status: txt('Status para filtrar (vazio = todos)') })
];

const ALTERACAO = [
  T('site_alterar_preco', 'Altera o preço à vista de aparelhos do site e publica. Pede confirmação ao dono.',
    { itens: { type: 'array', items: obj({ id: txt('id do aparelho'), preco: num('novo preço à vista em reais') }, ['id', 'preco']), description: 'Aparelhos e novos preços' } }),
  T('site_vitrine', 'Tira ou coloca aparelhos na vitrine do site e publica. Pede confirmação ao dono.',
    { ids: { type: 'array', items: { type: 'string' } }, mostrar: { type: 'boolean', description: 'false = tirar da vitrine; true = colocar' } }),
  T('os_criar', 'Cria uma ordem de serviço no sistema de OS. Pede confirmação ao dono.',
    { cliente_nome: txt('Nome do cliente'), cliente_whatsapp: txt('WhatsApp com DDD, só números'), marca: txt('Marca'), modelo: txt('Modelo completo'), defeito: txt('Defeito/serviço'), relato: txt('Detalhes; vazio se não houver'), valor: num('Valor do orçamento em reais; 0 se ainda não tem') }),
  T('os_mudar_status', 'Muda o status de uma OS. Pede confirmação ao dono.', { os_id: txt('id ou número da OS'), status: txt('Novo status, exatamente como o sistema usa') }),
  T('os_marcar_pago', 'Registra o pagamento de uma OS. Pede confirmação ao dono.', { os_id: txt('id ou número da OS'), valor: num('Valor pago em reais'), forma: txt('Forma de pagamento, ex.: pix, dinheiro, cartão') }),
  T('os_avisar_cliente', 'Avisa o cliente de uma OS (WhatsApp). Pede confirmação ao dono.', { os_id: txt('id ou número da OS'), mensagem: txt('Mensagem curta e educada para o cliente') }),
  T('meta_alterar', 'Altera o valor de uma meta do sistema de OS. Pede confirmação ao dono.', { meta_id: txt('id da meta'), valor_meta: num('Novo valor da meta em reais') })
];
const NOMES_ALTERACAO = new Set(ALTERACAO.map((t) => t.name));
NOMES_ALTERACAO.add('whatsapp_enviar'); // com o envio automático ligado, a mensagem também pede "Confirmar"

// CRM do WhatsApp: as conversas do WhatsApp da loja e a ficha de cada cliente (feita pela IA)
const CRM_WHATSAPP = [
  T('whatsapp_crm', 'Lista os clientes que conversaram com o WhatsApp da loja, com etapa, interesse, resumo, próxima ação e a última mensagem. Use para "quem está esperando resposta", "quem pediu iPhone 13", "como estão as negociações".',
    { filtro: { type: 'string', enum: ['sem_resposta', 'todos', 'novo', 'em_atendimento', 'orcamento', 'negociando', 'comprou', 'perdido', 'pos_venda'], description: 'sem_resposta = a última mensagem é do cliente' }, busca: txt('Texto para procurar no nome, número, interesse ou nas mensagens; vazio = todos') }),
  T('whatsapp_conversa', 'Mostra as últimas mensagens da conversa de WhatsApp com um cliente e a ficha dele.', { numero: txt('WhatsApp do cliente, com DDD, só números, como veio de whatsapp_crm') })
];

// WhatsApp para a equipe ou para um cliente: a tela mostra um cartão para o dono confirmar (ou o botão que abre o WhatsApp)
const WHATSAPP = [
  T('whatsapp_enviar', 'Prepara uma mensagem de WhatsApp para alguém da equipe (ex.: o funcionário Nizael) ou para um cliente da loja. Uma mensagem por pessoa. Aparece na tela um cartão para o dono confirmar antes de sair.',
    {
      para: txt('Equipe: o nome da pessoa (ex.: "Nizael"; "funcionário" se o dono disser só isso). Cliente: o WhatsApp dele com DDD, só números, exatamente como veio de os_ver, os_listar ou site_clientes_crm. Nunca invente número'),
      nome: txt('Nome de quem recebe, para mostrar no cartão (ex.: "Maria Souza"); para a equipe pode repetir o nome'),
      mensagem: txt('Mensagem pronta, escrita como o dono falaria, com o que a pessoa precisa saber. Pode usar *negrito* e quebras de linha do WhatsApp')
    })
];

function ferramentasDisponiveis() {
  const site = rb.githubOk();
  const crm = site && rb.supabaseOk();
  const os = saas.ok();
  return LEITURA.concat(ALTERACAO).filter((t) =>
    (t.name.startsWith('site_') ? (t.name === 'site_clientes_crm' ? crm : site)
      : t.name === 'relatorio_do_dia' ? site || os
        : os)).concat(WHATSAPP).concat(crmWhatsapp.ativo() ? CRM_WHATSAPP : []);
}

async function lerFerramenta(nome, i) {
  switch (nome) {
    case 'site_listar_aparelhos': return rb.listarAparelhos(i);
    case 'site_clientes_crm': return rb.clientesCrm(i);
    case 'relatorio_do_dia': {
      const dia = i.dia || rb.hojeBR();
      const [site, os] = await Promise.all([
        rb.githubOk() ? rb.relatorioSite(dia).catch((e) => ({ erro: e.message })) : { erro: 'site não configurado' },
        saas.ok() ? saas.relatorio(dia).catch((e) => ({ erro: e.message })) : { erro: 'sistema de OS não configurado' }
      ]);
      return { dia, site, sistema_os: os };
    }
    case 'os_listar': return saas.listarOS(i);
    case 'os_ver': return saas.verOS(i);
    case 'os_configuracao': return saas.configuracao();
    case 'metas_listar': return saas.metas();
    case 'pecas_listar_pedidos': return saas.pedidosPecas(i);
    case 'whatsapp_crm': {
      await crmWhatsapp.analisarPendentes(5).catch(() => 0); // fichas em dia antes de responder
      const lista = await crmWhatsapp.listar({ filtro: i.filtro, busca: i.busca, limite: 25 });
      return (Array.isArray(lista) ? lista : []).map((c) => ({ nome: c.nome, whatsapp: c.numero, etapa: c.etapa, interesse: c.interesse, resumo: c.resumo, proxima_acao: c.proxima_acao, valor: c.valor, ultima_mensagem: c.ultima_msg, ultima_de: c.ultima_de, ultimo_contato: c.ultimo_contato }));
    }
    case 'whatsapp_conversa': return crmWhatsapp.conversa(i.numero, 30);
    default: return { erro: 'ferramenta desconhecida' };
  }
}

// Texto que o dono vê antes de confirmar
async function previa(nome, i) {
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  switch (nome) {
    case 'site_alterar_preco': { const { cat } = await rb.lerCatalogo(); return { titulo: 'Alterar preço e publicar no site', linhas: rb.previaPrecos(cat, i.itens) }; }
    case 'site_vitrine': { const { cat } = await rb.lerCatalogo(); return { titulo: (i.mostrar ? 'Colocar na' : 'Tirar da') + ' vitrine e publicar', linhas: rb.previaVitrine(cat, i.ids, i.mostrar) }; }
    case 'os_criar': return { titulo: 'Criar OS no sistema', linhas: ['Cliente: ' + i.cliente_nome + ' · ' + i.cliente_whatsapp, 'Aparelho: ' + [i.marca, i.modelo].join(' '), 'Defeito: ' + i.defeito + (i.relato ? ' — ' + i.relato : ''), 'Valor: ' + (i.valor > 0 ? brl(i.valor) : 'a definir')] };
    case 'os_mudar_status': return { titulo: 'Mudar status da OS ' + i.os_id, linhas: ['Novo status: ' + i.status].concat(avisos.ligado() ? ['Depois a Central monta o aviso para o cliente, e você confirma antes de enviar.'] : []) };
    case 'os_marcar_pago': return { titulo: 'Marcar OS ' + i.os_id + ' como paga', linhas: ['Valor: ' + brl(i.valor), 'Forma: ' + i.forma] };
    case 'os_avisar_cliente': return { titulo: 'Avisar cliente da OS ' + i.os_id, linhas: ['Mensagem: "' + i.mensagem + '"'] };
    case 'meta_alterar': return { titulo: 'Alterar meta ' + i.meta_id, linhas: ['Novo valor: ' + brl(i.valor_meta)] };
    default: throw new Error('ação desconhecida');
  }
}

async function executar(nome, i) {
  switch (nome) {
    case 'site_alterar_preco': return { feito: await rb.executarPrecos(i.itens) };
    case 'site_vitrine': return { feito: await rb.executarVitrine(i.ids, i.mostrar) };
    case 'os_criar': return saas.criarOS(i);
    case 'os_mudar_status': {
      const r = await saas.mudarStatus(i);
      if (!avisos.ligado()) return r;
      // mudou o status: monta o aviso para o cliente, que só sai quando o dono tocar em "Enviar"
      const feito = ['Status da OS ' + i.os_id + ' mudado para ' + i.status + '.'];
      try {
        const p = await avisos.prepararAviso(i.os_id);
        if (p.pendente) return Object.assign({}, r, { feito: feito.concat(['Aviso para o cliente pronto: confira abaixo e toque em Enviar.']), aviso: p.aviso });
        return Object.assign({}, r, { feito: feito.concat(['Sem aviso ao cliente: ' + p.motivo + '.']) });
      } catch (e) {
        // sem a tabela de avisos (SQL ainda não rodado): cartão de confirmação direto
        try {
          const m = await avisos.montarAviso(i.os_id);
          if (!m.dados) return Object.assign({}, r, { feito: feito.concat(['Sem aviso ao cliente: ' + m.motivo + '.']) });
          const d = m.dados;
          const titulo = 'Avisar ' + (d.cliente || 'cliente') + ' · OS #' + d.os_numero + ' · ' + m.status;
          const linhas = ['Para: ' + (d.cliente || 'cliente') + ' · ' + equipe.formatar(d.numero) + (d.aparelho ? ' · ' + d.aparelho : ''), d.mensagem];
          const link = equipe.link(d.numero, d.mensagem);
          const cartao = whatsapp.ok()
            ? { token: auth.selar({ tipo: 'acao', uid: crypto.randomUUID(), nome: 'whatsapp_enviar', entrada: { nome: d.cliente || 'cliente', numero: d.numero, mensagem: d.mensagem } }, 15), titulo, linhas, link, whatsapp: true }
            : { tipo: 'whatsapp', titulo, linhas, link, whatsapp: true };
          return Object.assign({}, r, { feito: feito.concat(['Aviso para o cliente pronto: confira abaixo.']), acoes: [cartao] });
        } catch (e2) {
          return Object.assign({}, r, { feito: feito.concat(['Sem aviso ao cliente: ' + e2.message]) });
        }
      }
    }
    case 'os_marcar_pago': return saas.marcarPago(i);
    case 'os_avisar_cliente': {
      const r = await saas.avisarCliente(i);
      // o sistema de OS devolveu só o link: com o envio automático ligado, a Central manda pelo WhatsApp da loja
      const m = r && !r.enviado && whatsapp.ok() ? String(r.link_whatsapp || '').match(/^https:\/\/wa\.me\/(\d{10,15})\?text=(.*)$/) : null;
      if (!m) return r;
      try {
        await whatsapp.enviar(m[1], decodeURIComponent(m[2].replace(/\+/g, '%20')));
        return Object.assign({}, r, { enviado: true, feito: ['Cliente da OS ' + i.os_id + ' avisado pelo WhatsApp da loja.'] });
      } catch (e) {
        return Object.assign({}, r, { feito: ['Não consegui mandar sozinho (' + e.message + ') Abrindo o WhatsApp para você enviar.'] });
      }
    }
    case 'meta_alterar': return saas.mudarMeta(i);
    case 'whatsapp_enviar': {
      const r = await whatsapp.enviar(i.numero, i.mensagem);
      return { feito: ['Mensagem enviada para ' + i.nome + ' pelo WhatsApp da loja' + (r.como === 'texto' ? ' (texto livre: só chega se ' + i.nome + ' mandou mensagem para esse número nas últimas 24 h).' : '.')] };
    }
    default: throw new Error('ação desconhecida');
  }
}

module.exports = { ferramentasDisponiveis, lerFerramenta, previa, executar, NOMES_ALTERACAO };
