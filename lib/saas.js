// Sistema de OS (SaaS) pela API combinada em docs/CONTRATO-API-SAAS.md.
// Variáveis na Vercel:
//   SAAS_API_URL    endereço base da API do sistema (ex.: https://rbtechcelulares.reparosimples.com/api/central)
//   SAAS_API_TOKEN  chave secreta combinada com o sistema (vai em Authorization: Bearer)
const ok = () => /^https:\/\//.test(process.env.SAAS_API_URL || '') && !!process.env.SAAS_API_TOKEN;

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
    if (!r.ok) throw new Error((d && d.erro) || 'Sistema de OS respondeu ' + r.status);
    return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O sistema de OS demorou para responder.');
    throw e;
  } finally { clearTimeout(t); }
}

const id = (v) => encodeURIComponent(String(v || '').slice(0, 60));

module.exports = {
  ok,
  // leitura
  configuracao: () => api('GET', '/status'),
  listarOS: (i) => api('GET', '/os', null, { status: i.status, desde: i.desde, busca: i.busca, limite: 30 }),
  verOS: (i) => api('GET', '/os/' + id(i.os_id)),
  metas: () => api('GET', '/metas'),
  pedidosPecas: (i) => api('GET', '/pedidos-pecas', null, { status: i.status }),
  relatorio: (dia) => api('GET', '/relatorio', null, { dia }),
  // alterações (só depois da confirmação)
  criarOS: (i) => api('POST', '/os', {
    cliente: { nome: i.cliente_nome, whatsapp: i.cliente_whatsapp },
    aparelho: { marca: i.marca, modelo: i.modelo },
    defeito: i.defeito, relato: i.relato || '', valor: i.valor > 0 ? i.valor : null
  }),
  mudarStatus: (i) => api('PATCH', '/os/' + id(i.os_id), { status: i.status }),
  marcarPago: (i) => api('POST', '/os/' + id(i.os_id) + '/pagamento', { valor: i.valor, forma: i.forma }),
  avisarCliente: (i) => api('POST', '/os/' + id(i.os_id) + '/avisar', { mensagem: i.mensagem }),
  mudarMeta: (i) => api('PUT', '/metas/' + id(i.meta_id), { valor_meta: i.valor_meta })
};
