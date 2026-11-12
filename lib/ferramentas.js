// Ferramentas da IA. As de leitura rodam na hora; as que alteram algo viram um pedido de
// confirmação para o dono (botão "Confirmar" na tela) e só rodam em api/confirmar.
const rb = require('./rb');
const saas = require('./saas');
const whatsapp = require('./whatsapp');

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
NOMES_ALTERACAO.add('equipe_mandar_mensagem'); // com a API do WhatsApp ligada, o envio também pede "Confirmar"

// Mensagem para a equipe: a tela mostra um botão que abre o WhatsApp com a mensagem pronta (o dono envia)
const EQUIPE = [
  T('equipe_mandar_mensagem', 'Prepara uma mensagem de WhatsApp para alguém da equipe da loja (ex.: o funcionário Nizael). Aparece na tela o botão "Enviar no WhatsApp", que abre a conversa com a mensagem pronta para o dono enviar.',
    { para: txt('Nome da pessoa da equipe (ex.: "Nizael"). Se o dono disser só "funcionário", use "funcionário". Também aceita um número com DDD'), mensagem: txt('Mensagem pronta, escrita como o dono falaria, com todos os dados que a pessoa precisa para agir. Pode usar *negrito* e quebras de linha do WhatsApp') })
];

function ferramentasDisponiveis() {
  const site = rb.githubOk();
  const crm = site && rb.supabaseOk();
  const os = saas.ok();
  return LEITURA.concat(ALTERACAO).filter((t) =>
    (t.name.startsWith('site_') ? (t.name === 'site_clientes_crm' ? crm : site)
      : t.name === 'relatorio_do_dia' ? site || os
        : os)).concat(EQUIPE);
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
    case 'os_mudar_status': return { titulo: 'Mudar status da OS ' + i.os_id, linhas: ['Novo status: ' + i.status] };
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
    case 'os_mudar_status': return saas.mudarStatus(i);
    case 'os_marcar_pago': return saas.marcarPago(i);
    case 'os_avisar_cliente': return saas.avisarCliente(i);
    case 'meta_alterar': return saas.mudarMeta(i);
    case 'equipe_mandar_mensagem': {
      const r = await whatsapp.enviar(i.numero, i.mensagem);
      return { feito: ['Mensagem enviada para ' + i.nome + ' pelo WhatsApp da loja' + (r.como === 'texto' ? ' (texto livre: só chega se ' + i.nome + ' mandou mensagem para esse número nas últimas 24 h).' : '.')] };
    }
    default: throw new Error('ação desconhecida');
  }
}

module.exports = { ferramentasDisponiveis, lerFerramenta, previa, executar, NOMES_ALTERACAO };
