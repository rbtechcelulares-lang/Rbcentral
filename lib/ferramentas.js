// Ferramentas da IA. As de leitura rodam na hora; as que alteram algo viram um pedido de
// confirmação para o dono (botão "Confirmar" na tela) e só rodam em api/confirmar.
const rb = require('./rb');
const saas = require('./saas');
const whatsapp = require('./whatsapp');
const avisos = require('./avisos');
const crmWhatsapp = require('./crm-whatsapp');
const pecas = require('./pecas');
const spotify = require('./spotify');
const cameras = require('./cameras');
const sorteio = require('./sorteio');
const equipe = require('./equipe');
const auth = require('./auth');
const crypto = require('crypto');

const obj = (props, req) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
// Sem "strict": com muitas ferramentas a API recusa ("compiled grammar is too large"). Quem confere os
// dados é conferir(), abaixo, antes de qualquer ferramenta rodar.
const T = (name, description, props, req) => ({ name, description, input_schema: obj(props, req || Object.keys(props)) });
const txt = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });

// dias do sorteio: soltos (dias) ou um intervalo (de e ate), sempre em AAAA-MM-DD
const PERIODO_SORTEIO = {
  dias: { type: 'array', items: { type: 'string' }, description: 'Dias soltos, ex.: ["2026-11-13", "2026-11-15"]. Use isto OU de/ate' },
  de: txt('Primeiro dia do intervalo, AAAA-MM-DD'),
  ate: txt('Último dia do intervalo, AAAA-MM-DD (o mesmo de "de" para um dia só)')
};

const LEITURA = [
  T('site_listar_aparelhos', 'Lista aparelhos do site RB Tech (id, preço, cor, condição, bateria e onde cada um está: vitrine, topo, catálogo). Use antes de alterar qualquer aparelho para achar os ids. A tela do dono mostra junto um painel com botões (vitrine, topo, catálogo, editar, tirar do site).',
    { busca: txt('Texto para filtrar, ex.: "iPhone 13", "seminovo", "xiaomi". Vazio = todos'), so_vitrine: { type: 'boolean', description: 'true = só os que estão na vitrine' } }, []),
  T('site_clientes_crm', 'Lista clientes do CRM do site (quem passou nome e WhatsApp no RBChat, proposta ou reparo).',
    { status: { type: 'string', enum: ['novo', 'contatado', 'negociando', 'comprou', 'perdido', 'todos'] }, desde: txt('Data ISO (AAAA-MM-DD) a partir da qual listar; vazio = todos') }),
  T('relatorio_do_dia', 'Relatório do dia dos dois sistemas: site (cliques, propostas, clientes novos) e sistema de OS (OS, faturamento, metas, peças).',
    { dia: txt('AAAA-MM-DD; vazio = hoje') }),
  T('os_listar', 'Lista ordens de serviço do sistema de OS.',
    { status: txt('Status para filtrar (vazio = todos)'), desde: txt('AAAA-MM-DD ou vazio'), busca: txt('Nome do cliente, aparelho ou número da OS; vazio = todos') }),
  T('os_ver', 'Mostra os detalhes de uma OS.', { os_id: txt('id ou número da OS') }),
  T('os_configuracao', 'Lista os status válidos de OS, as formas de pagamento aceitas e os campos de OS que podem ser editados (campos_os). Use antes de mudar status, marcar pagamento ou editar uma OS se não souber os valores.', {}),
  T('metas_listar', 'Lista as metas do sistema de OS (valor da meta e quanto já foi feito).', {}),
  T('estoque_aparelhos', 'Lista os celulares do estoque do sistema (id, modelo, armazenamento, cor, condição, bateria, status, custo, preço de venda). Use antes de vender um aparelho para achar o id e o preço.',
    { status: txt('Status para filtrar, ex.: "Disponível", "Em estoque", "Preparação" (vazio = todos)'), busca: txt('Modelo, cor, IMEI; vazio = todos') }),
  T('produtos_listar', 'Lista os produtos e acessórios da Venda de Produtos (id, nome, preço, estoque). Use antes de vender um produto.', { busca: txt('Nome do produto; vazio = todos') }),
  T('sorteio_cupons', 'Sorteio para clientes: lê as vendas do sistema de OS nos dias pedidos e gera um cupom (número e código) para cada cliente que comprou celular nesses dias. Mostra também as vendas de celular sem cliente cadastrado (ficam sem cupom) e se o período já foi sorteado.',
    PERIODO_SORTEIO, [])
];

const ALTERACAO = [
  T('site_alterar_preco', 'Altera o preço à vista de aparelhos do site e publica. Pede confirmação ao dono.',
    { itens: { type: 'array', items: obj({ id: txt('id do aparelho'), preco: num('novo preço à vista em reais') }, ['id', 'preco']), description: 'Aparelhos e novos preços' } }),
  T('site_vitrine', 'Tira ou coloca aparelhos na vitrine do site e publica. Pede confirmação ao dono.',
    { ids: { type: 'array', items: { type: 'string' } }, mostrar: { type: 'boolean', description: 'false = tirar da vitrine; true = colocar' } }),
  T('site_aparelho_editar', 'Altera um aparelho do site e publica: preço, preço antigo (de/por), cor, armazenamento, condição, bateria, onde aparece (vitrine, topo, catálogo), sob encomenda, prazo e observações. Mande só o que muda. Pede confirmação ao dono.',
    {
      id: txt('id do aparelho (de site_listar_aparelhos)'),
      preco: num('Novo preço à vista em reais'), preco_antigo: num('Preço "de" para mostrar de/por (maior que o preço); 0 tira'),
      cor: txt('Nova cor, de preferência uma das cores do site (Preto, Branco, Azul, Titânio natural...)'), armazenamento: txt('Ex.: 128GB'),
      condicao: { type: 'string', enum: ['Seminovo', 'Novo lacrado', 'Vitrine'] }, bateria: num('Saúde da bateria em %; 0 = sem número'),
      vitrine: { type: 'string', enum: ['sim', 'nao'], description: 'Aparece nos cards de promoção' },
      topo: { type: 'string', enum: ['sim', 'nao'], description: 'Aparece na faixa do início do site' },
      catalogo: { type: 'string', enum: ['sim', 'nao'], description: 'Aparece na lista do catálogo' },
      sob_encomenda: { type: 'string', enum: ['sim', 'nao'] }, prazo: txt('Prazo da encomenda, ex.: 5 a 10 dias úteis'), observacoes: txt('Texto do detalhe do aparelho')
    }, ['id']),
  T('site_aparelho_adicionar', 'Cadastra um aparelho novo no site e publica (sem fotos: o site desenha o aparelho na cor). Pede confirmação ao dono. Pergunte antes o que faltar entre modelo, armazenamento, cor e preço.',
    {
      modelo: txt('Ex.: iPhone 15 Pro, iPhone 16e, MacBook Air M2, Redmi Note 13'), armazenamento: txt('Ex.: 128GB'), cor: txt('Cor, de preferência uma das cores do site'),
      preco: num('Preço à vista em reais'), condicao: { type: 'string', enum: ['Seminovo', 'Novo lacrado', 'Vitrine'] }, bateria: num('Saúde da bateria em % (seminovo); 0 = sem número'),
      preco_antigo: num('Preço "de" (de/por), maior que o preço; 0 = não mostrar'),
      vitrine: { type: 'string', enum: ['sim', 'nao'] }, topo: { type: 'string', enum: ['sim', 'nao'] },
      sob_encomenda: { type: 'string', enum: ['sim', 'nao'] }, prazo: txt('Prazo da encomenda'), observacoes: txt('Observações do aparelho')
    }, ['modelo', 'armazenamento', 'cor', 'preco']),
  T('site_aparelho_remover', 'Tira aparelhos do site (some da vitrine, do topo e do catálogo; dá para voltar depois com site_aparelho_editar catalogo=sim). Use para vendido ou esgotado. Pede confirmação ao dono.',
    { ids: { type: 'array', items: { type: 'string' }, description: 'ids dos aparelhos' } }),
  T('os_criar', 'Cria uma ordem de serviço no sistema de OS. Pede confirmação ao dono.',
    { cliente_nome: txt('Nome do cliente'), cliente_whatsapp: txt('WhatsApp com DDD, só números'), marca: txt('Marca'), modelo: txt('Modelo completo'), defeito: txt('Defeito/serviço'), relato: txt('Detalhes; vazio se não houver'), valor: num('Valor do orçamento em reais; 0 se ainda não tem') }),
  T('os_editar', 'Edita dados de uma OS que já existe (cliente, WhatsApp, aparelho, defeito, relato, laudo, valor, previsão, observações... os campos aceitos estão em campos_os de os_configuracao). Mande só o que muda. Status e pagamento NÃO: use os_mudar_status e os_marcar_pago. Pede confirmação ao dono, que vê o antes e o depois.',
    {
      os_id: txt('id ou número da OS'),
      alteracoes: { type: 'array', description: 'Só os campos que mudam', items: obj({ campo: txt('Nome do campo exatamente como em campos_os (ex.: cliente_nome, modelo, defeito, valor)'), valor: txt('Novo valor como texto. Número: 350.00. Data: AAAA-MM-DD. Para apagar o conteúdo: texto vazio') }, ['campo', 'valor']) }
    }),
  T('os_mudar_status', 'Muda o status de uma OS. Pede confirmação ao dono.', { os_id: txt('id ou número da OS'), status: txt('Novo status, exatamente como o sistema usa') }),
  T('os_marcar_pago', 'Registra o pagamento de uma OS. Pede confirmação ao dono.', { os_id: txt('id ou número da OS'), valor: num('Valor pago em reais'), forma: txt('Forma de pagamento, ex.: pix, dinheiro, cartão') }),
  T('os_avisar_cliente', 'Avisa o cliente de uma OS (WhatsApp) com uma mensagem escrita por você. Para OS já concluída ou pronta, use os_aviso_pronto (o texto vem do sistema). Pede confirmação ao dono.', { os_id: txt('id ou número da OS'), mensagem: txt('Mensagem curta e educada para o cliente') }),
  T('meta_alterar', 'Altera o valor de uma meta do sistema de OS. Pede confirmação ao dono.', { meta_id: txt('id da meta'), valor_meta: num('Novo valor da meta em reais') }),
  T('venda_registrar', 'Registra uma venda no sistema (aparelhos do estoque e/ou produtos), com as formas de pagamento e, se tiver, o aparelho que o cliente deu na troca (ele entra no estoque e conta como pagamento). Pede confirmação ao dono.',
    {
      cliente_nome: txt('Nome do cliente'),
      cliente_whatsapp: txt('WhatsApp com DDD, só números; vazio se não tiver'),
      itens: { type: 'array', description: 'O que foi vendido, com os ids de estoque_aparelhos ou produtos_listar', items: obj({ tipo: { type: 'string', enum: ['aparelho', 'produto'] }, id: txt('id do aparelho ou do produto'), descricao: txt('Nome curto, ex.: "iPhone 13 128GB Azul"'), quantidade: num('Quantidade (1 para aparelho)'), valor: num('Preço unitário em reais') }, ['tipo', 'id', 'descricao', 'quantidade', 'valor']) },
      desconto: num('Desconto total em reais; 0 se não tiver'),
      pagamentos: { type: 'array', description: 'Formas de pagamento (sem contar a troca)', items: obj({ forma: txt('Forma, como o sistema usa: pix, dinheiro, cartão de crédito, cartão de débito...'), valor: num('Valor em reais'), parcelas: num('Parcelas (1 se à vista)') }, ['forma', 'valor', 'parcelas']) },
      tem_troca: { type: 'boolean', description: 'true se o cliente deu um aparelho como parte do pagamento' },
      troca: Object.assign({ description: 'Só quando tem_troca = true' }, obj({ marca: txt('Marca'), modelo: txt('Modelo'), armazenamento: txt('Ex.: 128GB'), cor: txt('Cor'), imei: txt('IMEI; vazio se o dono não informou'), condicao: { type: 'string', enum: ['seminovo', 'novo'] }, bateria: num('Saúde da bateria em %; 0 se não informada'), valor_avaliado: num('Quanto a loja pagou pelo aparelho da troca, em reais'), observacoes: txt('Detalhes do aparelho; vazio se não tiver') }, ['marca', 'modelo', 'armazenamento', 'cor', 'imei', 'condicao', 'bateria', 'valor_avaliado', 'observacoes'])),
      garantia: txt('Garantia, ex.: "90 dias"; vazio se não tiver'),
      observacoes: txt('Observações; vazio se não tiver')
    }, ['cliente_nome', 'cliente_whatsapp', 'itens', 'desconto', 'pagamentos', 'tem_troca', 'garantia', 'observacoes']),
  T('aparelho_cadastrar', 'Cadastra um celular no estoque do sistema (ex.: aparelho comprado de cliente ou fornecedor). Pede confirmação ao dono. Para aparelho que entrou na troca de uma venda, use venda_registrar com tem_troca.',
    {
      marca: txt('Marca'), modelo: txt('Modelo'), armazenamento: txt('Ex.: 128GB'), cor: txt('Cor'), imei: txt('IMEI; vazio se o dono não informou'),
      condicao: { type: 'string', enum: ['seminovo', 'novo'] }, bateria: num('Saúde da bateria em %; 0 se não informada'),
      custo: num('Quanto a loja pagou, em reais'), preco_venda: num('Preço de venda em reais; 0 se ainda não definido'),
      origem: { type: 'string', enum: ['compra', 'troca', 'outro'] }, fornecedor_ou_cliente: txt('De quem veio; vazio se não informado'), observacoes: txt('Detalhes; vazio se não tiver')
    })
];
ALTERACAO.push(T('sorteio_sortear', 'Sorteia o ganhador entre os cupons do sorteio (clientes que compraram celular nos dias pedidos). Quem sorteia é a Central, com número aleatório, depois que o dono toca em Confirmar; o resultado fica registrado. Um período já sorteado só é sorteado de novo com de_novo=true, quando o dono pedir com todas as letras.',
  Object.assign({}, PERIODO_SORTEIO, { de_novo: { type: 'boolean', description: 'true = sortear de novo um período que já foi sorteado (só se o dono pedir)' } }), []));
const NOMES_ALTERACAO = new Set(ALTERACAO.map((t) => t.name));

// OS já concluída: pede ao sistema de OS o aviso de pronto dele (POST /os/:id/aviso-pronto, não envia nada)
// e mostra para o dono confirmar; o "Confirmar" chama POST /os/:id/avisar com esse texto
const AVISO_PRONTO = T('os_aviso_pronto', 'Prepara o aviso de "aparelho pronto" de uma OS que JÁ está concluída, com o texto do próprio sistema de OS. Use quando o dono pedir para avisar o cliente de uma OS concluída/pronta. Aparece um cartão para o dono confirmar antes de enviar.',
  { os_id: txt('id ou número da OS') });

async function cartaoAvisoSistema(osId, mensagem, os) {
  if (!os) os = await saas.verOS({ os_id: osId }).then((r) => r && r.os).catch(() => null);
  const o = os || {};
  const cliente = (o.cliente && o.cliente.nome) || 'cliente';
  const fone = o.cliente && o.cliente.whatsapp ? equipe.formatar(equipe.normalizar(o.cliente.whatsapp) || o.cliente.whatsapp) : '';
  const entrada = { os_id: String(o.numero || osId || o.id).slice(0, 60), mensagem }; // o sistema aceita id ou número
  return {
    token: auth.selar({ tipo: 'acao', uid: crypto.randomUUID(), nome: 'os_avisar_cliente', entrada }, 15),
    titulo: 'Avisar ' + cliente + ' · OS #' + (o.numero || osId),
    linhas: ['Para: ' + cliente + (fone ? ' · ' + fone : '')].concat([mensagem, '(texto do sistema de OS; sai pelo próprio sistema)'])
  };
}

async function prepararAvisoPronto(osId) {
  const r = await saas.avisoPronto(osId);
  const c = saas.comandoAviso(r);
  if (!c) throw new Error('o sistema de OS não devolveu o aviso de pronto dessa OS' + (r && r.erro ? ': ' + r.erro : ''));
  return cartaoAvisoSistema(osId, c.mensagem, r.os);
}
NOMES_ALTERACAO.add('whatsapp_enviar'); // com o envio automático ligado, a mensagem também pede "Confirmar"

// Pedidos de peças aos fornecedores: a lista fica na Central (lib/pecas.js); mensagens ao fornecedor com um toque
const PECAS = [
  T('pecas_listar_pedidos', 'Lista os pedidos de peças aos fornecedores (número, peça, aparelho, fornecedor, OS, status, valor, previsão). A tela do dono mostra junto a lista com botões para perguntar o preço, pedir o envio e marcar que chegou.',
    { status: { type: 'string', enum: ['abertos', 'todos', 'a_pedir', 'cotando', 'pedido', 'chegou', 'cancelado'], description: 'abertos = a pedir, esperando preço e pedidos (padrão)' }, busca: txt('Peça, aparelho, OS ou fornecedor; vazio = todos') }, []),
  T('fornecedores_listar', 'Lista os fornecedores cadastrados (nome e WhatsApp).', {}),
  T('peca_pedido_adicionar', 'Adiciona um pedido na lista de pedidos de peças aos fornecedores. Pede confirmação ao dono. Se o dono disser o fornecedor e ele ainda não estiver cadastrado, peça o WhatsApp dele (fornecedor_whatsapp).',
    { peca: txt('A peça, com cor e detalhes. Ex.: "Tampa traseira azul"'), aparelho: txt('Aparelho, ex.: "iPhone 12 Pro"; vazio se não disse'), quantidade: num('Quantidade (1 se não disse)'),
      fornecedor: txt('Nome do fornecedor; vazio se não disse'), fornecedor_whatsapp: txt('WhatsApp do fornecedor com DDD, só se ele ainda não estiver cadastrado; vazio se não'),
      os_numero: txt('Número da OS que precisa da peça; vazio se não houver'), observacoes: txt('Observações; vazio se não houver') }, ['peca']),
  T('peca_pedido_atualizar', 'Atualiza um pedido de peça: status (a_pedir, cotando, pedido, chegou, cancelado), valor que o fornecedor passou, previsão de chegada, fornecedor ou observações. Pede confirmação ao dono.',
    { pedido: txt('Número do pedido de peça (de pecas_listar_pedidos)'), status: { type: 'string', enum: ['a_pedir', 'cotando', 'pedido', 'chegou', 'cancelado'] },
      valor: num('Preço que o fornecedor passou, em reais'), previsao: txt('Previsão de chegada AAAA-MM-DD'), fornecedor: txt('Trocar o fornecedor (nome)'),
      fornecedor_whatsapp: txt('WhatsApp do fornecedor, se for novo'), observacoes: txt('Observações') }, ['pedido']),
  T('fornecedor_cadastrar', 'Cadastra um fornecedor (ou atualiza o WhatsApp dele). Pede confirmação ao dono.',
    { nome: txt('Nome do fornecedor'), whatsapp: txt('WhatsApp com DDD, só números'), observacoes: txt('Observações; vazio se não houver') }, ['nome', 'whatsapp']),
  T('peca_fornecedor_mensagem', 'Prepara a mensagem de WhatsApp para o fornecedor de um pedido de peça: perguntar o preço (cotar) ou pedir para enviar (pedir). Aparece um cartão para o dono confirmar com um toque; ao enviar, o status do pedido muda sozinho.',
    { pedido: txt('Número do pedido de peça'), tipo: { type: 'string', enum: ['cotar', 'pedir'] }, mensagem: txt('Texto próprio da mensagem; vazio = a Central usa o texto padrão') }, ['pedido', 'tipo'])
];
// peca_mensagem_enviar = o cartão de mensagem ao fornecedor (assinado pela Central, sai depois do Confirmar)
['peca_pedido_adicionar', 'peca_pedido_atualizar', 'fornecedor_cadastrar', 'peca_mensagem_enviar'].forEach((n) => NOMES_ALTERACAO.add(n));

// Música da loja (Spotify): executa na hora, sem Confirmar (mexer no som não altera nada importante)
const MUSICA = [
  T('musica_status', 'Mostra o que está tocando no Spotify da loja, em qual aparelho e o volume.', {}),
  T('musica_controlar', 'Controla o Spotify da loja na hora: tocar, pausar, próxima, anterior, volume, aumentar ou diminuir o volume, ordem aleatória.',
    { acao: { type: 'string', enum: ['play', 'pausar', 'proxima', 'anterior', 'volume', 'aumentar', 'diminuir', 'aleatorio_ligar', 'aleatorio_desligar'] },
      volume: num('Para acao=volume: de 0 a 100. Para aumentar/diminuir: quanto (padrão 15)') }, ['acao']),
  T('musica_tocar', 'Toca no Spotify da loja uma playlist da conta, uma música, um artista ou um álbum, procurando pelo nome. Com na_fila=true só põe a música na fila.',
    { o_que: txt('O que tocar, ex.: "playlist da loja", "Henrique e Juliano", "Evidências"'), tipo: { type: 'string', enum: ['qualquer', 'playlist', 'musica', 'artista', 'album'] },
      na_fila: { type: 'boolean', description: 'true = só adicionar a música na fila' } }, ['o_que'])
];

// Câmeras da loja: abre na tela do dono o mini player com o site das câmeras (a IA não vê as imagens)
const CAMERAS = [
  T('cameras_abrir', 'Abre na tela do dono o mini player das câmeras da loja (o site das câmeras da Emive). Use quando ele pedir para ver as câmeras, a loja ao vivo ou o movimento da loja. Você não vê as imagens.',
    { tamanho: { type: 'string', enum: ['normal', 'grande'], description: 'grande = câmeras em tela grande' } }, [])
];

// CRM do WhatsApp: as conversas do WhatsApp da loja e a ficha de cada cliente (feita pela IA)
const CRM_WHATSAPP = [
  T('whatsapp_crm', 'Lista os clientes do WhatsApp da loja que querem COMPRAR iPhone (a IA já separou: quem vende para a loja, clientes de reparo e outros assuntos não aparecem), com etapa, interesse, resumo, próxima ação e a última mensagem. Use para "quem está esperando resposta", "quem pediu iPhone 13", "como estão as negociações".',
    { filtro: { type: 'string', enum: ['sem_resposta', 'todos', 'loja_sem_responder', 'cliente_sumiu', 'nao_buscou', 'novo', 'em_atendimento', 'orcamento', 'negociando', 'fechado', 'comprou', 'perdido', 'pos_venda'], description: 'sem_resposta = a última mensagem é do cliente; loja_sem_responder = cliente esperando há mais de 30 min; cliente_sumiu = a loja respondeu e o cliente está há mais de 24 h sem responder; nao_buscou = fechou e passou 2 dias do dia combinado sem venda registrada' }, busca: txt('Texto para procurar no nome, número, interesse ou nas mensagens; vazio = todos') }),
  T('whatsapp_conversa', 'Mostra as últimas mensagens da conversa de WhatsApp com um cliente e a ficha dele.', { numero: txt('WhatsApp do cliente, com DDD, só números, como veio de whatsapp_crm') }),
  T('relatorio_perdas', 'Relatório de por que os clientes de iPhone do WhatsApp não fecharam: motivos (preço, pagamento, troca, estoque, concorrente, demora da loja...) com quantidade, valor perdido e exemplos, aparelhos mais perdidos, de onde vieram no site, taxa de conversão e tempo até a primeira resposta (quem comprou x quem perdeu).',
    { dias: num('Período em dias (padrão 30, máximo 90)') }, [])
];

// WhatsApp para a equipe ou para um cliente: a tela mostra um cartão para o dono confirmar (ou o botão que abre o WhatsApp)
const WHATSAPP = [
  T('whatsapp_enviar', 'Prepara uma mensagem de WhatsApp para alguém da equipe (ex.: o funcionário Nizael), para um contato pessoal do dono (família, ex.: a esposa; mensagem pessoal é permitida) ou para um cliente da loja. Uma mensagem por pessoa. Aparece na tela um cartão para o dono confirmar antes de sair.',
    {
      para: txt('Equipe ou família: o nome da pessoa (ex.: "Nizael", "Pamella"; "funcionário" ou "esposa" se o dono disser só isso). Cliente: o WhatsApp dele com DDD, só números, exatamente como veio de os_ver, os_listar ou site_clientes_crm. Nunca invente número'),
      nome: txt('Nome de quem recebe, para mostrar no cartão (ex.: "Maria Souza"); para equipe ou família pode repetir o nome'),
      mensagem: txt('Mensagem pronta, escrita como o dono falaria, com o que a pessoa precisa saber (para a família, no tom pessoal dele). Pode usar *negrito* e quebras de linha do WhatsApp')
    })
];

// Confere (e arruma o que dá) a entrada que a IA mandou, pelo input_schema da ferramenta.
// Devolve uma cópia limpa; se faltar algo ou vier errado, dá erro e a IA corrige e chama de novo.
const SCHEMAS = new Map(LEITURA.concat(ALTERACAO, CRM_WHATSAPP, WHATSAPP, [AVISO_PRONTO], PECAS, MUSICA, CAMERAS).map((t) => [t.name, t.input_schema]));
function valor(s, v, onde) {
  if (s.type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error((onde || 'entrada') + ' precisa ser um objeto');
    const out = {};
    for (const [k, sub] of Object.entries(s.properties || {})) {
      const nome = onde ? onde + '.' + k : k;
      if (v[k] !== undefined && v[k] !== null) out[k] = valor(sub, v[k], nome);
      else if ((s.required || []).includes(k)) {
        if (sub.type === 'string' && sub.enum && sub.enum.includes('todos')) out[k] = 'todos';
        else if (sub.type === 'string' && !sub.enum && /vazio/i.test(sub.description || '')) out[k] = '';
        else throw new Error('faltou ' + nome);
      }
    }
    return out;
  }
  if (s.type === 'array') {
    if (!Array.isArray(v)) throw new Error(onde + ' precisa ser uma lista');
    if (v.length > 50) throw new Error(onde + ': no máximo 50 itens');
    return v.map((x, n) => valor(s.items, x, onde + '[' + n + ']'));
  }
  if (s.type === 'number') {
    const n = typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(onde + ' precisa ser um número');
    return n;
  }
  if (s.type === 'boolean') {
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    throw new Error(onde + ' precisa ser true ou false');
  }
  const t = typeof v === 'number' ? String(v) : v;
  if (typeof t !== 'string') throw new Error(onde + ' precisa ser texto');
  if (s.enum && !s.enum.includes(t)) throw new Error(onde + ' precisa ser um destes: ' + s.enum.join(', '));
  return t.slice(0, 4000);
}
function conferir(nome, entrada) {
  const s = SCHEMAS.get(nome);
  if (!s) throw new Error('ferramenta desconhecida: ' + nome);
  const i = valor(s, entrada || {}, '');
  if (nome === 'venda_registrar') {
    if (!i.itens.length) throw new Error('a venda precisa de pelo menos um item');
    if (i.tem_troca && !i.troca) throw new Error('tem_troca = true, mas faltou o aparelho da troca (troca)');
    if (!i.tem_troca) delete i.troca;
  }
  return i;
}

function ferramentasDisponiveis() {
  const site = rb.githubOk();
  const crm = site && rb.supabaseOk();
  const os = saas.ok();
  return LEITURA.concat(ALTERACAO).filter((t) =>
    (t.name.startsWith('site_') ? (t.name === 'site_clientes_crm' ? crm : site)
      : t.name === 'relatorio_do_dia' ? site || os
        : os)).concat(os ? [AVISO_PRONTO] : []).concat(pecas.ativo() ? PECAS : []).concat(spotify.configurado() ? MUSICA : []).concat(cameras.ativo() ? CAMERAS : []).concat(WHATSAPP).concat(crmWhatsapp.ativo() ? CRM_WHATSAPP : []);
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
    case 'os_ver': {
      // link de acompanhamento: diz se o sistema nem mandou o campo (API dele desatualizada) ou mandou vazio
      const r = await saas.verOS(i);
      const os = r && r.os;
      if (os && typeof os === 'object' && !os.link_acompanhamento) {
        r.situacao_do_link = 'link_acompanhamento' in os
          ? 'o sistema de OS mandou o link vazio para esta OS (a OS não tem link gerado no sistema)'
          : 'o sistema de OS não mandou o campo link_acompanhamento (a API dele ainda não devolve o link)';
      }
      return r;
    }
    case 'os_configuracao': return saas.configuracao();
    case 'metas_listar': return saas.metas();
    case 'pecas_listar_pedidos': return pecas.listarComSistema(i);
    case 'fornecedores_listar': return { fornecedores: await pecas.fornecedores() };
    case 'musica_status': {
      const e = await spotify.estado();
      if (!e.conectado) return { conectado: false, aviso: 'O Spotify ainda não foi conectado: o dono toca em "♫ Música" no topo e depois em "Conectar Spotify".' };
      return { tocando: e.tocando, musica: e.musica && (e.musica.nome + ' · ' + e.musica.artistas), aparelho: e.aparelho && e.aparelho.nome, volume: e.aparelho && e.aparelho.volume, aleatorio: e.aleatorio, aparelhos: e.aparelhos.map((a) => a.nome) };
    }
    case 'musica_controlar': {
      const a = i.acao, v = Number(i.volume) || 15;
      const feito = a === 'aumentar' ? await spotify.comando('volume', { mudar: v }) : a === 'diminuir' ? await spotify.comando('volume', { mudar: -v })
        : a === 'aleatorio_ligar' ? await spotify.comando('aleatorio', { ligar: true }) : a === 'aleatorio_desligar' ? await spotify.comando('aleatorio', { ligar: false })
          : await spotify.comando(a, { volume: i.volume });
      return { feito };
    }
    case 'cameras_abrir': return cameras.paraIA();
    case 'sorteio_cupons': return sorteio.cupons(i);
    case 'musica_tocar': return spotify.tocarPorNome(i.o_que, i.tipo === 'qualquer' ? '' : i.tipo, !!i.na_fila);
    case 'estoque_aparelhos': return saas.aparelhosEstoque(i);
    case 'produtos_listar': return saas.produtos(i);
    case 'whatsapp_crm': {
      await crmWhatsapp.analisarPendentes(5).catch(() => 0); // fichas em dia antes de responder
      const lista = await crmWhatsapp.listar({ filtro: i.filtro, busca: i.busca, limite: 25 });
      return (Array.isArray(lista) ? lista : []).map((c) => ({ nome: c.nome, whatsapp: c.numero, situacao: c.situacao, etapa: c.etapa, interesse: c.interesse, resumo: c.resumo, proxima_acao: c.proxima_acao, valor: c.valor, combinou_buscar_em: c.retirada_em, veio_do_site: c.veio_do_site, ultima_mensagem: c.ultima_msg, ultima_de: c.ultima_de, ultimo_contato: c.ultimo_contato }));
    }
    case 'whatsapp_conversa': return crmWhatsapp.conversa(i.numero, 30);
    case 'relatorio_perdas': return crmWhatsapp.relatorioPerdas(i.dias);
    default: return { erro: 'ferramenta desconhecida' };
  }
}

// Texto que o dono vê antes de confirmar
async function previa(nome, i) {
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  switch (nome) {
    case 'site_alterar_preco': { const { cat } = await rb.lerCatalogo(); return { titulo: 'Alterar preço e publicar no site', linhas: rb.previaPrecos(cat, i.itens) }; }
    case 'site_vitrine': { const { cat } = await rb.lerCatalogo(); return { titulo: (i.mostrar ? 'Colocar na' : 'Tirar da') + ' vitrine e publicar', linhas: rb.previaVitrine(cat, i.ids, i.mostrar) }; }
    case 'site_aparelho_editar': case 'site_aparelho_adicionar': case 'site_aparelho_remover':
      return { titulo: { site_aparelho_editar: 'Alterar aparelho e publicar no site', site_aparelho_adicionar: 'Cadastrar aparelho e publicar no site', site_aparelho_remover: 'Tirar do site e publicar' }[nome], linhas: await rb.previaAlteracoes(alteracoesSite(nome, i)) };
    case 'os_criar': return { titulo: 'Criar OS no sistema', linhas: ['Cliente: ' + i.cliente_nome + ' · ' + i.cliente_whatsapp, 'Aparelho: ' + [i.marca, i.modelo].join(' '), 'Defeito: ' + i.defeito + (i.relato ? ' — ' + i.relato : ''), 'Valor: ' + (i.valor > 0 ? brl(i.valor) : 'a definir')] };
    case 'os_editar': { const p = await prepararEdicao(i); return { titulo: 'Editar OS ' + (p.numero ? '#' + p.numero : i.os_id), linhas: p.linhas }; }
    case 'peca_pedido_adicionar': {
      const f = i.fornecedor ? (await pecas.fornecedores()).find((x) => x.nome.toLowerCase() === String(i.fornecedor).toLowerCase().trim()) : null;
      return { titulo: 'Adicionar pedido de peça', linhas: ['Peça: ' + (i.quantidade > 1 ? i.quantidade + 'x ' : '') + i.peca + (i.aparelho ? ' · ' + i.aparelho : '')]
        .concat(i.fornecedor ? ['Fornecedor: ' + i.fornecedor + (f ? (f.whatsapp ? ' · ' + equipe.formatar(f.whatsapp) : ' (sem WhatsApp cadastrado)') : i.fornecedor_whatsapp ? ' (novo · ' + i.fornecedor_whatsapp + ')' : ' (novo, sem WhatsApp)')] : ['Fornecedor: ainda não definido'])
        .concat(i.os_numero ? ['OS: #' + i.os_numero] : []).concat(i.observacoes ? ['Obs.: ' + i.observacoes] : []) };
    }
    case 'peca_pedido_atualizar': {
      const p = pecas.resumo(await pecas.acharPedido(i.pedido));
      return { titulo: 'Atualizar pedido de peça #' + p.numero, linhas: [p.peca + (p.aparelho ? ' · ' + p.aparelho : '') + (p.fornecedor ? ' · ' + p.fornecedor : '')]
        .concat(i.status ? ['Status: ' + p.situacao + ' → ' + pecas.STATUS[i.status]] : []).concat(i.valor > 0 ? ['Valor: ' + pecas.brl(i.valor)] : [])
        .concat(i.previsao ? ['Previsão: ' + i.previsao.split('-').reverse().join('/')] : []).concat(i.fornecedor ? ['Fornecedor: ' + i.fornecedor] : []).concat(i.observacoes ? ['Obs.: ' + i.observacoes] : []) };
    }
    case 'fornecedor_cadastrar': return { titulo: 'Cadastrar fornecedor', linhas: ['Nome: ' + i.nome, 'WhatsApp: ' + equipe.formatar(equipe.normalizar(i.whatsapp) || i.whatsapp)].concat(i.observacoes ? ['Obs.: ' + i.observacoes] : []) };
    case 'os_mudar_status': return { titulo: 'Mudar status da OS ' + i.os_id, linhas: ['Novo status: ' + i.status].concat(avisos.ligado() ? ['Depois a Central monta o aviso para o cliente, e você confirma antes de enviar.'] : []) };
    case 'os_marcar_pago': return { titulo: 'Marcar OS ' + i.os_id + ' como paga', linhas: ['Valor: ' + brl(i.valor), 'Forma: ' + i.forma] };
    case 'os_avisar_cliente': return { titulo: 'Avisar cliente da OS ' + i.os_id, linhas: ['Mensagem: "' + i.mensagem + '"'] };
    case 'meta_alterar': return { titulo: 'Alterar meta ' + i.meta_id, linhas: ['Novo valor: ' + brl(i.valor_meta)] };
    case 'venda_registrar': return previaVenda(i, brl);
    case 'sorteio_sortear': return sorteio.previaSortear(i);
    case 'aparelho_cadastrar': return {
      titulo: 'Cadastrar aparelho no estoque',
      linhas: [
        [i.marca, i.modelo, i.armazenamento, i.cor].filter(Boolean).join(' ') + ' · ' + i.condicao + (i.bateria > 0 ? ' · bateria ' + i.bateria + '%' : ''),
        'IMEI: ' + (i.imei || 'não informado'),
        'Custo: ' + brl(i.custo) + ' · Venda: ' + (i.preco_venda > 0 ? brl(i.preco_venda) : 'a definir'),
        'Origem: ' + i.origem + (i.fornecedor_ou_cliente ? ' (' + i.fornecedor_ou_cliente + ')' : '')
      ].concat(i.observacoes ? ['Obs.: ' + i.observacoes] : [])
    };
    default: throw new Error('ação desconhecida');
  }
}

async function executar(nome, i) {
  switch (nome) {
    case 'site_alterar_preco': return { feito: await rb.executarPrecos(i.itens) };
    case 'site_vitrine': return { feito: await rb.executarVitrine(i.ids, i.mostrar) };
    case 'site_aparelho_editar': case 'site_aparelho_adicionar': case 'site_aparelho_remover':
      return { feito: (await rb.executarAlteracoes(alteracoesSite(nome, i))).concat(['Publicado: o site atualiza em cerca de 1 minuto.']) };
    case 'os_criar': return saas.criarOS(i);
    case 'os_mudar_status': {
      const r = await saas.mudarStatus(i);
      const cmd = saas.comandoAviso(r); // o sistema devolveu o aviso dele (ex.: ao concluir): ele vale no lugar do da Central
      const feito = ['Status da OS ' + i.os_id + ' mudado para ' + i.status + '.'];
      if (cmd && !avisos.ligado()) {
        return Object.assign({}, r, { feito: feito.concat(['Aviso do sistema para o cliente pronto: confira abaixo e toque em Confirmar.']), acoes: [await cartaoAvisoSistema(i.os_id, cmd.mensagem, r.os)] });
      }
      if (!avisos.ligado()) return r;
      // mudou o status: monta o aviso para o cliente, que só sai quando o dono tocar em "Enviar"
      try {
        const p = await avisos.prepararAviso(i.os_id, false, cmd ? cmd.mensagem : '', cmd ? 'sistema' : '');
        if (p.pendente) return Object.assign({}, r, { feito: feito.concat(['Aviso para o cliente pronto: confira abaixo e toque em Enviar.']), aviso: p.aviso });
        return Object.assign({}, r, { feito: feito.concat(['Sem aviso ao cliente: ' + p.motivo + '.']) });
      } catch (e) {
        // sem a tabela de avisos (SQL ainda não rodado): cartão de confirmação direto
        if (cmd) return Object.assign({}, r, { feito: feito.concat(['Aviso do sistema para o cliente pronto: confira abaixo e toque em Confirmar.']), acoes: [await cartaoAvisoSistema(i.os_id, cmd.mensagem, r.os)] });
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
    case 'os_editar': {
      const p = await prepararEdicao(i); // confere de novo com a OS e os campos de agora
      const r = await saas.editarOS(i.os_id, p.alterar);
      return Object.assign({}, r, { feito: ['OS ' + (p.numero ? '#' + p.numero : i.os_id) + ' editada.'].concat(p.linhas) });
    }
    case 'peca_pedido_adicionar': {
      const p = await pecas.adicionar(i);
      return { feito: ['Pedido de peça #' + p.numero + ' adicionado: ' + (p.quantidade > 1 ? p.quantidade + 'x ' : '') + p.peca + (p.aparelho ? ' · ' + p.aparelho : '') + (p.fornecedor ? ' · ' + p.fornecedor : '') + '.'], acoes: [{ tipo: 'pecas' }] };
    }
    case 'peca_pedido_atualizar': {
      const r = await pecas.atualizar(i);
      return { feito: ['Pedido de peça #' + r.depois.numero + ': ' + r.depois.situacao + (r.depois.valor ? ' · ' + pecas.brl(r.depois.valor) : '') + '.'] };
    }
    case 'fornecedor_cadastrar': {
      const f = await pecas.salvarFornecedor(i);
      return { feito: ['Fornecedor ' + f.nome + ' cadastrado' + (f.whatsapp ? ' · ' + equipe.formatar(f.whatsapp) : '') + '.'] };
    }
    case 'peca_mensagem_enviar': return pecas.enviarMensagem(i);
    case 'os_marcar_pago': return saas.marcarPago(i);
    case 'os_avisar_cliente': {
      const r = await saas.avisarCliente(i);
      // o sistema de OS devolveu só o link: com o envio automático ligado, a Central manda pelo WhatsApp da loja
      if (r && r.enviado) return Object.assign({}, r, { feito: ['Cliente da OS ' + i.os_id + ' avisado pelo sistema de OS.'] });
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
    case 'sorteio_sortear': return sorteio.sortear(i);
    case 'venda_registrar': {
      const r = await saas.registrarVenda(i);
      if (i.cliente_whatsapp) await crmWhatsapp.marcarVenda(i.cliente_whatsapp).catch(() => false); // funil do CRM: comprou
      const v = r.venda || {};
      const t = r.aparelho_troca;
      return Object.assign({}, r, { feito: ['Venda ' + (v.numero ? '#' + v.numero + ' ' : '') + 'registrada' + (v.total ? ': ' + brlTxt(v.total) : '') + '.']
        .concat(t ? ['Aparelho da troca no estoque: ' + [t.marca, t.modelo, t.armazenamento, t.cor].filter(Boolean).join(' ') + (t.status ? ' (' + t.status + ')' : '') + '.'] : []) });
    }
    case 'aparelho_cadastrar': {
      const r = await saas.cadastrarAparelho(i);
      const a = r.aparelho || {};
      return Object.assign({}, r, { feito: ['Aparelho cadastrado no estoque: ' + [a.marca || i.marca, a.modelo || i.modelo, a.armazenamento || i.armazenamento, a.cor || i.cor].filter(Boolean).join(' ') + (a.status ? ' (' + a.status + ')' : '') + '.'] });
    }
    case 'whatsapp_enviar': {
      const r = await whatsapp.enviar(i.numero, i.mensagem);
      return { feito: ['Mensagem enviada para ' + i.nome + ' pelo WhatsApp da loja' + (r.como === 'texto' ? ' (texto livre: só chega se ' + i.nome + ' mandou mensagem para esse número nas últimas 24 h).' : '.')] };
    }
    default: throw new Error('ação desconhecida');
  }
}

// Edição de OS: confere cada campo com a lista "campos_os" que o sistema publica em GET /status,
// converte o valor pelo tipo (texto, numero, data, opcao) e monta as linhas "Campo: antes → depois".
const EDICAO_PROIBIDA = /^(status|pago|pagamentos?|forma_pagamento|loja|id|numero|criado_em|atualizado_em)$|senha|padrao_desbloqueio/;
function valorAtualOS(os, campo) {
  if (!os) return undefined;
  const mapa = { cliente_nome: ['cliente', 'nome'], cliente_whatsapp: ['cliente', 'whatsapp'], marca: ['aparelho', 'marca'], modelo: ['aparelho', 'modelo'], imei: ['aparelho', 'imei'], cor: ['aparelho', 'cor'] };
  if (os[campo] !== undefined) return os[campo];
  const m = mapa[campo];
  return m && os[m[0]] ? os[m[0]][m[1]] : undefined;
}
async function prepararEdicao(i) {
  const [cfg, atual] = await Promise.all([
    saas.configuracao(),
    saas.verOS({ os_id: i.os_id }).then((r) => r && r.os).catch(() => null)
  ]);
  const lista = Array.isArray(cfg && cfg.campos_os) ? cfg.campos_os.filter((c) => c && typeof c.campo === 'string' && !EDICAO_PROIBIDA.test(c.campo)) : [];
  if (!lista.length) throw new Error('o sistema de OS ainda não aceita edição de OS pela Central. Diga ao dono para colar o prompt docs/PROMPT-EDITAR-OS.md no Claude Code do sistema de OS');
  if (!atual) throw new Error('não achei a OS ' + i.os_id + ' no sistema');
  const campos = new Map(lista.map((c) => [c.campo, c]));
  const alterar = {}, linhas = [];
  const mostrar = (v, c) => (v === undefined || v === null || v === '' ? '(vazio)' : c.tipo === 'numero' ? brlTxt(v) : String(v).replace(/\s+/g, ' ').slice(0, 120));
  for (const a of (i.alteracoes || []).slice(0, 15)) {
    const campo = String(a.campo || '').trim().toLowerCase();
    if (campo === 'status') throw new Error('para mudar o status use os_mudar_status');
    if (/^(pago|pagamentos?|forma_pagamento)$/.test(campo)) throw new Error('para registrar pagamento use os_marcar_pago');
    const c = campos.get(campo);
    if (!c) throw new Error('o campo "' + campo + '" não pode ser editado. Campos aceitos: ' + [...campos.keys()].join(', '));
    let v = String(a.valor === undefined || a.valor === null ? '' : a.valor).trim().slice(0, 2000);
    if (c.tipo === 'numero') {
      if (v === '') v = null;
      else {
        const n = Number(v.replace(/R\$\s*/i, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) throw new Error(campo + ' precisa ser um número (ex.: 350.00)');
        v = Math.round(n * 100) / 100;
      }
    } else if (c.tipo === 'data') {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(campo + ': use a data como AAAA-MM-DD');
    } else if (c.tipo === 'opcao' && Array.isArray(c.opcoes) && v && !c.opcoes.includes(v)) {
      throw new Error(campo + ' precisa ser uma destas opções: ' + c.opcoes.join(', '));
    } else if (campo === 'cliente_whatsapp' && v) {
      v = v.replace(/\D/g, '');
      if (!/^\d{10,13}$/.test(v)) throw new Error('cliente_whatsapp precisa ter DDD e número (10 a 13 dígitos)');
    }
    const antes = valorAtualOS(atual, campo);
    if (String(antes === undefined || antes === null ? '' : antes) === String(v === null ? '' : v)) continue; // não muda nada
    alterar[campo] = v;
    linhas.push((c.nome || campo) + ': ' + mostrar(antes, c) + ' → ' + mostrar(v, c));
  }
  if (!linhas.length) throw new Error('nada para mudar: os valores pedidos já são os da OS');
  return { alterar, linhas, numero: atual.numero };
}

// ferramenta da IA → alterações do catálogo (mesmo formato do painel de aparelhos da Central)
function alteracoesSite(nome, i) {
  const campos = (x) => {
    const c = { preco: x.preco > 0 ? x.preco : undefined, precoAntigo: x.preco_antigo !== undefined ? x.preco_antigo : undefined,
      cor: x.cor || undefined, armazenamento: x.armazenamento || undefined, condicao: x.condicao || undefined,
      bateria: x.bateria !== undefined ? x.bateria : undefined, vitrine: x.vitrine, topo: x.topo, disponivel: x.catalogo,
      encomenda: x.sob_encomenda, prazo: x.prazo, observacoes: x.observacoes };
    Object.keys(c).forEach((k) => c[k] === undefined && delete c[k]);
    return c;
  };
  if (nome === 'site_aparelho_remover') return (i.ids || []).map((id) => ({ op: 'remover', id }));
  if (nome === 'site_aparelho_adicionar') return [{ op: 'novo', dados: Object.assign({ modelo: i.modelo }, campos(i), { armazenamento: i.armazenamento, cor: i.cor, preco: i.preco }) }];
  return [{ op: 'editar', id: i.id, campos: campos(i) }];
}

// Prévia da venda: itens, desconto, total, troca e pagamentos, e um alerta se as contas não fecharem
const brlTxt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function previaVenda(i, brl) {
  const itens = i.itens || [];
  const bruto = itens.reduce((s, x) => s + (Number(x.valor) || 0) * (x.quantidade > 0 ? x.quantidade : 1), 0);
  const total = Math.max(0, bruto - (i.desconto > 0 ? i.desconto : 0));
  const pagos = (i.pagamentos || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const troca = i.tem_troca ? Number(i.troca && i.troca.valor_avaliado) || 0 : 0;
  const linhas = ['Cliente: ' + i.cliente_nome + (i.cliente_whatsapp ? ' · ' + i.cliente_whatsapp : '')]
    .concat(itens.map((x) => '• ' + (x.quantidade > 1 ? x.quantidade + 'x ' : '') + x.descricao + ' — ' + brl(x.valor)))
    .concat(i.desconto > 0 ? ['Desconto: ' + brl(i.desconto)] : [])
    .concat(['Total: ' + brl(total)]);
  if (i.tem_troca && i.troca) {
    const t = i.troca;
    linhas.push('Troca (entra no estoque): ' + [t.marca, t.modelo, t.armazenamento, t.cor].filter(Boolean).join(' ') + (t.bateria > 0 ? ' · bateria ' + t.bateria + '%' : '') + ' · IMEI ' + (t.imei || 'não informado') + ' — ' + brl(troca));
  }
  linhas.push('Pagamento: ' + (i.pagamentos || []).map((p) => p.forma + ' ' + brl(p.valor) + (p.parcelas > 1 ? ' em ' + p.parcelas + 'x' : '')).concat(troca ? ['troca ' + brl(troca)] : []).join(' + '));
  if (Math.abs(pagos + troca - total) > 0.009) linhas.push('⚠️ As contas não fecham: pagamentos + troca = ' + brl(pagos + troca) + ', total = ' + brl(total) + '. Confira antes de confirmar.');
  if (i.garantia) linhas.push('Garantia: ' + i.garantia);
  return { titulo: 'Registrar venda' + (i.tem_troca ? ' com troca' : ''), linhas };
}

const cartaoFornecedor = (pedido, tipo, mensagem) => pecas.cartaoMensagem(pedido, tipo, mensagem);

module.exports = { ferramentasDisponiveis, conferir, prepararAvisoPronto, cartaoFornecedor, lerFerramenta, previa, executar, NOMES_ALTERACAO };
