// Sistema de OS (SaaS) pela API combinada em docs/CONTRATO-API-SAAS.md.
// Variáveis na Vercel:
//   SAAS_API_URL    endereço base da API do sistema (ex.: https://rbtechcelulares.reparosimples.com/api/central)
//   SAAS_API_TOKEN  chave secreta combinada com o sistema (vai em Authorization: Bearer)
//   SAAS_LOJA       identificador da SUA loja no sistema (padrão: rbtechcelulares)
// O sistema é usado por vários lojistas: a chave só abre a sua loja (garantido no sistema) e,
// como segunda trava, toda resposta precisa dizer "loja": "<SAAS_LOJA>"; qualquer outra é recusada.
const ok = () => /^https:\/\//.test(process.env.SAAS_API_URL || '') && !!process.env.SAAS_API_TOKEN;
const minhaLoja = () => String(process.env.SAAS_LOJA || 'rbtechcelulares').trim().toLowerCase();

// Procura qualquer campo "loja" na resposta (inclusive dentro de listas) e confere se é a minha
function conferirLoja(d) {
  if (!d || typeof d !== 'object' || String(d.loja || '').trim().toLowerCase() !== minhaLoja()) {
    throw new Error('Resposta do sistema de OS sem a loja ' + minhaLoja() + ': por segurança, nada foi mostrado nem alterado.');
  }
  const outra = (v) => {
    if (Array.isArray(v)) return v.some(outra);
    if (v && typeof v === 'object') {
      if ('loja' in v && String(v.loja || '').trim().toLowerCase() !== minhaLoja()) return true;
      return Object.values(v).some(outra);
    }
    return false;
  };
  if (outra(d)) throw new Error('O sistema de OS devolveu dados de outra loja: por segurança, nada foi mostrado nem alterado.');
  return d;
}

async function api(metodo, caminho, corpo, query) {
  if (!ok()) throw new Error('Falta configurar SAAS_API_URL e SAAS_API_TOKEN na Vercel.');
  const u = new URL(process.env.SAAS_API_URL.replace(/\/+$/, '') + caminho);
  Object.entries(query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(u, {
      method: metodo,
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + process.env.SAAS_API_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw new Error('O sistema de OS recusou o SAAS_API_TOKEN.');
    if (r.status === 404) throw new Error((d && d.erro) || 'Não encontrado na sua loja.');
    if (!r.ok) throw new Error((d && d.erro) || 'Sistema de OS respondeu ' + r.status);
    return conferirLoja(d);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O sistema de OS demorou para responder.');
    throw e;
  } finally { clearTimeout(t); }
}

const id = (v) => encodeURIComponent(String(v || '').slice(0, 60));

// O sistema de OS pode devolver o aviso pronto dele: { "comando": { "acao": "avisar_cliente", "mensagem": "..." } }
// (ao concluir uma OS pelo PATCH, ou em POST /os/:id/aviso-pronto). Devolve { mensagem } ou null.
function comandoAviso(r) {
  const c = r && r.comando;
  if (!c || c.acao !== 'avisar_cliente' || typeof c.mensagem !== 'string') return null;
  const mensagem = c.mensagem.replace(/\r/g, '').trim().slice(0, 1500);
  return mensagem ? { mensagem } : null;
}

module.exports = {
  ok,
  minhaLoja,
  comandoAviso,
  // leitura
  configuracao: () => api('GET', '/status'),
  listarOS: (i) => api('GET', '/os', null, { status: i.status, desde: i.desde, busca: i.busca, limite: 30 }),
  verOS: (i) => api('GET', '/os/' + id(i.os_id)),
  metas: () => api('GET', '/metas'),
  pedidosPecas: (i) => api('GET', '/pedidos-pecas', null, { status: i.status }),
  relatorio: (dia) => api('GET', '/relatorio', null, { dia }),
  aparelhosEstoque: (i) => api('GET', '/aparelhos', null, { status: i.status, busca: i.busca, limite: 30 }),
  produtos: (i) => api('GET', '/produtos', null, { busca: i.busca, limite: 30 }),
  // vendas de aparelhos (iPhone e Android, novos e seminovos), com resumo; sem custo/lucro
  vendasAparelhos: (i) => api('GET', '/vendas-aparelhos', null, { desde: i.desde, ate: i.ate, categoria: i.categoria === 'todas' ? '' : i.categoria, busca: i.busca, limite: 1000 }),
  // alterações (só depois da confirmação)
  criarOS: (i) => api('POST', '/os', {
    cliente: { nome: i.cliente_nome, whatsapp: i.cliente_whatsapp },
    aparelho: { marca: i.marca, modelo: i.modelo },
    defeito: i.defeito, relato: i.relato || '', valor: i.valor > 0 ? i.valor : null
  }),
  mudarStatus: (i) => api('PATCH', '/os/' + id(i.os_id), { status: i.status }),
  // edita campos da OS (os nomes vêm de "campos_os" do GET /status); status e pagamento têm rotas próprias
  editarOS: (osId, alterar) => api('POST', '/os/' + id(osId) + '/editar', { alterar }),
  marcarPago: (i) => api('POST', '/os/' + id(i.os_id) + '/pagamento', { valor: i.valor, forma: i.forma }),
  avisarCliente: (i) => api('POST', '/os/' + id(i.os_id) + '/avisar', { mensagem: i.mensagem }),
  // OS já concluída: o sistema devolve o aviso de pronto dele em "comando" (não envia nada)
  avisoPronto: (osId) => api('POST', '/os/' + id(osId) + '/aviso-pronto', {}),
  mudarMeta: (i) => api('PUT', '/metas/' + id(i.meta_id), { valor_meta: i.valor_meta }),
  cadastrarAparelho: (i) => api('POST', '/aparelhos', {
    marca: i.marca, modelo: i.modelo, armazenamento: i.armazenamento, cor: i.cor, imei: i.imei || '',
    condicao: i.condicao, bateria: i.bateria > 0 ? i.bateria : null, custo: i.custo, preco_venda: i.preco_venda > 0 ? i.preco_venda : null,
    origem: i.origem, fornecedor_ou_cliente: i.fornecedor_ou_cliente || '', observacoes: i.observacoes || ''
  }),
  registrarVenda: (i) => api('POST', '/vendas', {
    cliente: { nome: i.cliente_nome, whatsapp: i.cliente_whatsapp || '' },
    itens: (i.itens || []).map((x) => ({ tipo: x.tipo, id: x.id, quantidade: x.quantidade > 0 ? x.quantidade : 1, valor: x.valor })),
    desconto: i.desconto > 0 ? i.desconto : 0,
    pagamentos: (i.pagamentos || []).map((p) => ({ forma: p.forma, valor: p.valor, parcelas: p.parcelas > 0 ? p.parcelas : 1 })),
    troca: i.tem_troca ? {
      marca: i.troca.marca, modelo: i.troca.modelo, armazenamento: i.troca.armazenamento, cor: i.troca.cor, imei: i.troca.imei || '',
      condicao: i.troca.condicao, bateria: i.troca.bateria > 0 ? i.troca.bateria : null, valor_avaliado: i.troca.valor_avaliado, observacoes: i.troca.observacoes || ''
    } : null,
    garantia: i.garantia || '',
    observacoes: i.observacoes || ''
  }),
  // a Central mandou uma mensagem que veio de um evento do sistema: ele marca como enviada
  marcarEnviado: (corpo) => api('POST', '/eventos/enviado', corpo)
};
