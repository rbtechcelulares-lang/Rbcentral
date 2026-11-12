(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  // respostas da IA organizadas em blocos: resumo, títulos de grupo, itens (campos separados por " · "), tabela e pergunta final
  function itemHtml(txt) {
    const [principal, ...extra] = txt.split(/\s+—\s+/);
    const partes = principal.split(/\s+·\s+/);
    let h = partes.length > 1
      ? '<span class="it-id">' + fmt(partes[0]) + '</span>' + partes.slice(1).map((p) => '<span class="it-sep">·</span>' + (p.length <= 22 ? '<span class="it-c">' + fmt(p) + '</span>' : fmt(p))).join('')
      : fmt(principal);
    if (extra.length) h += '<span class="it-obs">' + fmt(extra.join(' — ')) + '</span>';
    return h;
  }
  function md(t) {
    const linhas = String(t || '').replace(/\r/g, '').split('\n');
    const blocos = []; // { t: 'p' | 'h' | 'lista' | 'tab', h, texto }
    let lista = null;
    const fecharLista = () => {
      if (!lista) return;
      const tag = lista.num ? 'ol' : 'ul';
      blocos.push({ t: 'lista', h: '<' + tag + ' class="md-lista">' + lista.itens.join('') + '</' + tag + '>' });
      lista = null;
    };
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i].trim();
      if (/^\|.*\|$/.test(l)) { // tabela markdown
        fecharLista();
        const rows = [];
        while (i < linhas.length && /^\|.*\|$/.test(linhas[i].trim())) { rows.push(linhas[i].trim()); i++; }
        i--;
        const celulas = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
        const corpo = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
        if (!corpo.length) continue;
        const [cab, ...resto] = corpo;
        blocos.push({ t: 'tab', h: '<div class="tabela"><table><thead><tr>' + celulas(cab).map((c) => '<th>' + fmt(c) + '</th>').join('') + '</tr></thead><tbody>' +
          resto.map((r) => '<tr>' + celulas(r).map((c) => '<td>' + fmt(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' });
        continue;
      }
      const item = l.match(/^(?:([-•*])|(\d+)[.)])\s+(.*)$/);
      if (item) {
        const num = !!item[2];
        if (lista && lista.num !== num) fecharLista();
        lista = lista || { num, itens: [] };
        lista.itens.push('<li>' + itemHtml(item[3]) + '</li>');
        continue;
      }
      if (!l) continue; // linha em branco não fecha a lista: itens separados por espaço continuam no mesmo grupo
      fecharLista();
      // título: "## Prontas", "**Prontas (2)**" ou "*Prontas (2):*" sozinho na linha
      const tit = l.match(/^#{1,4}\s+(.*)$/) || l.match(/^\*\*([^*]+)\*\*:?$/) || l.match(/^\*([^*]+)\*:?$/);
      if (tit) { blocos.push({ t: 'h', h: '<p class="md-h">' + fmt(tit[1].replace(/:\s*$/, '')) + '</p>' }); continue; }
      blocos.push({ t: 'p', texto: l, h: fmt(l) });
    }
    fecharLista();
    if (blocos.length > 1 && blocos[0].t === 'p') blocos[0].cls = 'md-resumo';
    const ult = blocos[blocos.length - 1];
    if (blocos.length > 1 && ult.t === 'p' && /\?\s*$/.test(ult.texto)) ult.cls = 'md-pergunta';
    return blocos.map((b) => (b.t === 'p' ? '<p' + (b.cls ? ' class="' + b.cls + '"' : '') + '>' + b.h + '</p>' : b.h)).join('');
  }

  const CHAVE_TOKEN = 'rbcentral_token';
  const CHAVE_CONVERSA = 'rbcentral_conversa'; // formato antigo: uma conversa só
  const CHAVE_CONVERSAS = 'rbcentral_conversas';
  const CHAVE_ATUAL = 'rbcentral_conversa_atual';
  const MAX_CONVERSAS = 6;
  const MAX_ITENS = 80;
  let token = '';
  try { token = localStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { /* sem storage */ }

  // conversas: [{ id, criada, atualizada, itens }], da mais recente para a mais antiga (as 6 últimas, neste aparelho)
  // itens: { role: 'user'|'assistant', content } ou { tipo: 'acao', token, titulo, linhas, estado, em } ou { tipo: 'nota', content }
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const temMensagem = (c) => c.itens.some((i) => i.role === 'user');
  let conversas = [];
  try { conversas = JSON.parse(localStorage.getItem(CHAVE_CONVERSAS) || '[]'); } catch (e) { conversas = []; }
  conversas = (Array.isArray(conversas) ? conversas : []).filter((c) => c && c.id && Array.isArray(c.itens));
  try { // a conversa do formato antigo vira a primeira do histórico
    const antiga = JSON.parse(localStorage.getItem(CHAVE_CONVERSA) || '[]');
    if (Array.isArray(antiga) && antiga.some((i) => i && i.role === 'user') && !conversas.length) conversas.push({ id: novoId(), criada: Date.now(), atualizada: Date.now(), itens: antiga });
    localStorage.removeItem(CHAVE_CONVERSA);
  } catch (e) { /* ignora */ }

  let zapAutomatico = false; // envio de WhatsApp com um toque (Z-API ou Meta) ligado no servidor
  let atual = null; // conversa aberta (null = conversa nova, ainda sem mensagens)
  let itens = [];
  function abrirConversa(c) {
    atual = c || null;
    itens = atual ? atual.itens : [];
    try { localStorage.setItem(CHAVE_ATUAL, atual ? atual.id : ''); } catch (e) { /* ignora */ }
  }
  {
    let id = null;
    try { id = localStorage.getItem(CHAVE_ATUAL); } catch (e) { /* ignora */ }
    abrirConversa(id === '' ? null : (conversas.find((c) => c.id === id) || conversas[0]));
  }
  // a conversa nova entra no histórico na primeira mensagem
  function conversaAtual() {
    if (!atual) { atual = { id: novoId(), criada: Date.now(), atualizada: Date.now(), itens }; conversas.unshift(atual); abrirConversa(atual); }
    return atual;
  }
  function guardar(conv) {
    conv = conv || (itens.length ? conversaAtual() : null);
    if (conv) {
      conv.atualizada = Date.now();
      conv.pendente = true; // ainda não foi para a nuvem
      if (conv.itens.length > MAX_ITENS) conv.itens.splice(0, conv.itens.length - MAX_ITENS);
    }
    gravarLocal();
    if (conv) agendarEnvio(conv);
  }
  // guarda só as 6 mais recentes que têm mensagem do dono; a mais antiga sai quando entra a 7ª
  function gravarLocal() {
    conversas.sort((a, b) => b.atualizada - a.atualizada);
    let salvar = conversas.filter(temMensagem).slice(0, MAX_CONVERSAS);
    conversas = conversas.filter((c) => salvar.includes(c) || c === atual);
    while (true) {
      try { localStorage.setItem(CHAVE_CONVERSAS, JSON.stringify(salvar)); break; } catch (e) {
        if (salvar.length <= 1 || !/quota/i.test(e.name + ' ' + e.message)) break; // memória do navegador cheia: tira a mais antiga
        salvar = salvar.slice(0, -1);
      }
    }
    try { localStorage.setItem(CHAVE_ATUAL, atual ? atual.id : ''); } catch (e) { /* ignora */ }
  }

  // ---------- Nuvem: o mesmo histórico no iPhone e no computador (Supabase do site, via api/conversas) ----------
  const CHAVE_SINC = 'rbcentral_sinc'; // '1' depois da primeira sincronização
  const CHAVE_APAGADAS = 'rbcentral_apagadas'; // apagadas aqui que a nuvem ainda não confirmou
  let nuvem = { ok: null, motivo: '' };
  let apagadas = [];
  try { apagadas = JSON.parse(localStorage.getItem(CHAVE_APAGADAS) || '[]'); } catch (e) { apagadas = []; }
  if (!Array.isArray(apagadas)) apagadas = [];
  const gravarApagadas = () => { try { localStorage.setItem(CHAVE_APAGADAS, JSON.stringify(apagadas.slice(-30))); } catch (e) { /* ignora */ } };
  const envios = new Map(); // id da conversa → envio agendado
  function agendarEnvio(c) {
    if (!temMensagem(c) || nuvem.ok === false) return;
    clearTimeout(envios.get(c.id));
    envios.set(c.id, setTimeout(() => subir(c), 1200));
  }
  async function subir(c) {
    envios.delete(c.id);
    if (!token || !conversas.includes(c)) return;
    const versao = c.atualizada;
    try {
      const d = await chamar('conversas', { acao: 'salvar', conversa: { id: c.id, criada: c.criada, atualizada: c.atualizada, itens: c.itens } });
      if (!d.sinc) { nuvem = { ok: false, motivo: d.motivo }; return mostrarNuvem(); }
      nuvem = { ok: true, motivo: '' };
      if (c.atualizada === versao) { c.pendente = false; gravarLocal(); }
    } catch (e) { /* sem internet: fica pendente e vai na próxima sincronização */ }
  }
  async function apagarNaNuvem(id) {
    try {
      const d = await chamar('conversas', { acao: 'apagar', id });
      if (d.sinc) { apagadas = apagadas.filter((x) => x !== id); gravarApagadas(); }
    } catch (e) { /* tenta de novo na próxima sincronização */ }
  }
  let sincronizando = false, ultimaSinc = 0;
  async function sincronizar(forcar) {
    if (!token || sincronizando || ocupado) return;
    if (!forcar && Date.now() - ultimaSinc < 15000) return;
    sincronizando = true;
    try {
      for (const id of apagadas.slice()) await apagarNaNuvem(id);
      const d = await chamar('conversas');
      if (!d.sinc) { nuvem = { ok: false, motivo: d.motivo }; return; }
      nuvem = { ok: true, motivo: '' };
      ultimaSinc = Date.now();
      let primeira = false;
      try { primeira = !localStorage.getItem(CHAVE_SINC); } catch (e) { /* ignora */ }
      if (primeira) conversas.forEach((c) => { c.pendente = true; }); // o que já estava neste aparelho sobe na primeira vez
      if (!ocupado) mesclar(d.conversas || []);
      try { localStorage.setItem(CHAVE_SINC, '1'); } catch (e) { /* ignora */ }
    } catch (e) { /* sem internet: segue com o que está no aparelho */ } finally {
      sincronizando = false;
      mostrarNuvem();
    }
  }
  // junta a nuvem com o aparelho: vale a versão mais nova; o que foi apagado em outro aparelho some daqui
  function mesclar(remotas) {
    const locais = new Map(conversas.map((c) => [c.id, c]));
    const final = [];
    remotas.forEach((r) => {
      if (!r || !r.id || !Array.isArray(r.itens) || apagadas.includes(r.id) || final.some((c) => c.id === r.id)) return;
      const l = locais.get(r.id);
      locais.delete(r.id);
      if (l && (l.atualizada === r.atualizada || (l.pendente && l.atualizada > r.atualizada))) final.push(l);
      else final.push(Object.assign(r, { pendente: false }));
    });
    locais.forEach((l) => { if (l.pendente && temMensagem(l)) final.push(l); }); // feita aqui e ainda não enviada
    const antes = atual;
    conversas = final;
    if (antes && !conversas.includes(antes)) {
      abrirConversa(conversas.find((c) => c.id === antes.id) || null); // mudou ou foi apagada em outro aparelho
      desenhar();
    }
    gravarLocal();
    conversas.filter((c) => c.pendente).forEach(agendarEnvio);
    if (!$('#hist').hidden) desenharHistorico();
  }
  function mostrarNuvem() {
    const n = $('#hist-nota');
    if (!n) return;
    n.classList.toggle('aviso', nuvem.ok === false);
    if (nuvem.ok) n.textContent = '☁️ As 6 últimas conversas ficam na nuvem: as mesmas no iPhone e no computador.';
    else if (nuvem.ok === false) n.textContent = 'Guardando só neste aparelho: ' + (nuvem.motivo || 'a nuvem não respondeu') + '.';
    else n.textContent = 'Guardo as 6 últimas conversas. Conferindo a nuvem…';
    $('#hist-sql').hidden = !(nuvem.ok === false && /SQL/.test(nuvem.motivo || ''));
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sincronizar(); carregarAvisos(); } });

  // ---------- Avisos de status de OS: o cliente só recebe quando o dono toca em "Enviar" ----------
  let avisosPendentes = [];
  const estadoAviso = {}; // id → { estado, resultado, link } (o que já foi feito nesta tela)
  function cartaoAviso(a, chave) {
    const st = Object.assign({}, a, estadoAviso[a.id] || {});
    const seguro = /^https:\/\/wa\.me\/\d+\?text=/.test(st.link || '') ? st.link : '';
    const icone = st.estado === 'enviado' ? '✅ ' : st.estado === 'descartado' ? '✖ ' : st.estado === 'falhou' ? '⚠️ ' : st.estado === 'enviando' ? '⏳ ' : '📣 ';
    const [para, ...msg] = st.linhas || [];
    return '<div class="acao aviso ' + (st.estado || '') + '" data-aviso="' + esc(a.id) + '" data-chave="' + chave + '"><h4>' + icone + esc(st.titulo) + '</h4>' +
      (para ? '<div class="aviso-para">' + esc(para) + '</div>' : '') +
      '<div class="zap-msg">' + fmt(msg.join('\n')) + '</div>' +
      (st.resultado ? '<div class="muted">' + fmt(st.resultado) + '</div>' : '') +
      (!st.estado || st.estado === 'falhou' ? '<div class="botoes"><button class="btn ok" data-av="' + esc(a.id) + '" data-acao="enviar">Enviar</button><button class="btn nao" data-av="' + esc(a.id) + '" data-acao="descartar">Descartar</button></div>' : '') +
      (seguro ? '<div class="botoes"><a class="btn ok btn-zap" href="' + esc(seguro) + '" target="_blank" rel="noopener">Abrir no WhatsApp</a></div>' : '') + '</div>';
  }
  async function carregarAvisos() {
    if (!token) return;
    try {
      const d = await chamar('avisos');
      avisosPendentes = Array.isArray(d.avisos) ? d.avisos : [];
    } catch (e) { return; }
    // um aviso pendente na lista some do cartão da conversa só depois que for resolvido
    mostrarBarraAvisos();
    if (!$('#avisos').hidden) desenharAvisos();
  }
  function mostrarBarraAvisos() {
    const n = avisosPendentes.filter((a) => !estadoAviso[a.id] || estadoAviso[a.id].estado === 'falhou').length;
    $('#avisos-barra').hidden = !n;
    $('#avisos-n').textContent = n + (n === 1 ? ' mensagem para confirmar' : ' mensagens para confirmar');
  }
  function desenharAvisos() {
    const lista = avisosPendentes.map((a) => cartaoAviso(a, 'p'));
    $('#avisos-lista').innerHTML = lista.length ? lista.map((h) => '<li>' + h + '</li>').join('') : '<li class="hist-vazio">Nenhuma mensagem esperando. 👍</li>';
  }
  async function acaoAviso(id, acao) {
    if (!id || (estadoAviso[id] && estadoAviso[id].estado === 'enviando')) return;
    const marcar = (estado, resultado, link) => {
      estadoAviso[id] = { estado, resultado, link };
      conversas.forEach((c) => c.itens.forEach((x) => {
        if (x.tipo === 'aviso' && x.id === id) { Object.assign(x, estadoAviso[id]); c.pendente = true; agendarEnvio(c); }
      }));
      gravarLocal(); desenhar(); desenharAvisos(); mostrarBarraAvisos();
    };
    marcar('enviando', acao === 'enviar' ? 'Enviando…' : 'Descartando…');
    try {
      const d = await chamar('avisos', { acao, id });
      if (acao === 'descartar') marcar('descartado', 'Descartado: o cliente não recebeu.');
      else if (d.link) { marcar('enviado', 'O envio automático está desligado: abra o WhatsApp para mandar.', d.link); window.open(d.link, '_blank', 'noopener'); }
      else marcar('enviado', 'Enviado para o cliente pelo WhatsApp da loja.');
      avisosPendentes = avisosPendentes.filter((a) => a.id !== id);
    } catch (e) {
      marcar('falhou', e.message);
    }
    mostrarBarraAvisos(); desenharAvisos();
  }
  $('#avisos-barra').addEventListener('click', () => { desenharAvisos(); $('#avisos').hidden = false; carregarAvisos(); });
  $('#avisos').addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar-avisos]')) { $('#avisos').hidden = true; return; }
    const b = e.target.closest('[data-av]');
    if (b) acaoAviso(b.dataset.av, b.dataset.acao);
  });
  setInterval(() => { if (document.visibilityState === 'visible' && !$('#app').hidden) carregarAvisos(); }, 60000);

  // cérebro: cada neurônio é uma aba de um sistema; tocar nele pede aquilo para a IA
  // Cérebro 3D em tela cheia (assets/cerebro.js). Sem conversa ele fica em destaque e dá para girar e tocar
  // nos sistemas; com conversa ele escurece no fundo. O botão 🧠 mostra o cérebro por cima da conversa.
  let cerebro = null, focoManual = false;
  const areaCerebro = () => {
    if ($('#app').hidden) return { top: 0, bottom: $('.login-box').getBoundingClientRect().top }; // login: o cérebro fica em cima da caixa de senha
    const topo = $('.topo').getBoundingClientRect();
    let bottom = $('#enviar').getBoundingClientRect().top;
    // cérebro em destaque com a mensagem de boas-vindas: ele fica no espaço acima dela
    const app = $('#app'), prim = $('#conversa').firstElementChild;
    if (app.classList.contains('cb-foco') && !app.classList.contains('cb-manual') && prim) bottom = Math.min(bottom, prim.getBoundingClientRect().top);
    return { top: topo.bottom, bottom };
  };
  if (window.RBCerebro && $('#cerebro-fundo').getContext) {
    cerebro = RBCerebro.criar($('#cerebro-fundo'), { onClick: (a) => { focoManual = false; enviar(a.pedido); }, area: areaCerebro });
  }
  const ajustarCerebro = () => {
    if (focoManual && !itens.length) focoManual = false;
    const foco = focoManual || !itens.length;
    $('#app').classList.toggle('cb-foco', foco);
    $('#app').classList.toggle('cb-manual', focoManual);
    $('#cb-foco').setAttribute('aria-pressed', String(focoManual));
    $('#cb-foco').title = focoManual ? 'Voltar para a conversa' : 'Ver o cérebro';
    if (cerebro) cerebro.modo($('#app').hidden ? 'login' : foco ? 'foco' : 'fundo');
  };
  $('#cb-foco').addEventListener('click', () => { focoManual = !focoManual && itens.length > 0; ajustarCerebro(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && focoManual) { focoManual = false; ajustarCerebro(); } });

  async function chamar(caminho, corpo) {
    const r = await fetch('api/' + caminho, {
      method: corpo ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && caminho !== 'login') { sair(); throw new Error('Sessão expirada. Entre de novo.'); }
    if (!r.ok) throw new Error(d.erro || 'Erro ' + r.status);
    return d;
  }

  function sair() {
    token = '';
    try { localStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* ignora */ }
    $('#app').hidden = true; $('#login').hidden = false;
    if (cerebro) cerebro.modo('login');
  }

  // link vindo do Admin do site (botão "Follow-up pela Central"): ?pedir=... já escreve o pedido na caixa,
  // e só vai quando o dono tocar em enviar
  let pedidoInicial = '';
  try {
    const u = new URL(location.href);
    pedidoInicial = String(u.searchParams.get('pedir') || '').slice(0, 1000);
    if (pedidoInicial) { u.searchParams.delete('pedir'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  } catch (e) { /* ignora */ }

  async function entrar() {
    $('#login').hidden = true; $('#app').hidden = false;
    desenhar();
    if (pedidoInicial) { $('#msg').value = pedidoInicial; pedidoInicial = ''; crescer(); $('#msg').focus(); }
    try {
      const s = await chamar('status');
      vozNuvem = !!s.voz;
      if (cerebro) cerebro.status(s);
      zapAutomatico = !!s.whatsapp;
      $('#conexoes').innerHTML = [['IA', s.ia], ['Site', s.site], ['CRM', s.crm], ['OS', s.sistema_os], ['Zap', s.whatsapp]]
        .map(([n, on]) => '<span class="con' + (on ? ' on' : '') + '">' + (on ? '● ' : '○ ') + n + '</span>').join('');
    } catch (e) { /* mostrado ao usar */ }
    sincronizar(true);
    carregarAvisos();
  }

  function desenhar(rolar) {
    const c = $('#conversa');
    ajustarCerebro();
    c.innerHTML = (itens.length ? '' : '<div class="m ia">Olá! Sou o <b>RB Central</b>. Posso mudar preços, tirar aparelhos da vitrine, listar clientes do CRM, criar e atualizar OS, registrar pagamentos, avisar clientes, mexer nas metas, ver pedidos de peças e fazer o relatório do dia. Tudo que altera algo eu peço para você confirmar antes. 😉</div>') +
      itens.map((it, k) => {
        if (it.tipo === 'acao' && !it.estado && it.em && Date.now() - it.em > 15 * 60 * 1000) { it.estado = 'expirada'; it.resultado = 'Expirou (vale 15 minutos). Se ainda quiser, peça de novo.'; }
        if (it.tipo === 'acao') {
          return '<div class="acao ' + (it.estado || '') + '" data-k="' + k + '"><h4>' + (it.estado === 'feita' ? '✅ ' : it.estado === 'cancelada' ? '✖ ' : it.estado === 'falhou' ? '⚠️ ' : it.estado === 'expirada' ? '⌛ ' : '⏳ ') + esc(it.titulo) + '</h4>' +
            '<ul>' + (it.linhas || []).map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
            (it.resultado ? '<div class="muted">' + fmt(it.resultado) + '</div>' : '') +
            (!it.estado ? '<div class="botoes"><button class="btn ok" data-ok="' + k + '">Confirmar</button><button class="btn nao" data-nao="' + k + '">Cancelar</button></div>' : '') +
            // se o envio automático do WhatsApp falhar, dá para mandar na mão
            (it.estado === 'falhou' && /^https:\/\/wa\.me\/\d+\?text=/.test(it.link || '') ? '<div class="botoes"><a class="btn ok btn-zap" href="' + esc(it.link) + '" target="_blank" rel="noopener">Enviar pelo WhatsApp na mão</a></div>' : '') + '</div>';
        }
        if (it.tipo === 'aviso') return cartaoAviso(it, 'k' + k);
        if (it.tipo === 'zap') {
          const seguro = /^https:\/\/wa\.me\/\d+\?text=/.test(it.link || '') ? it.link : '';
          return '<div class="acao zap' + (it.estado ? ' ' + it.estado : '') + '" data-k="' + k + '"><h4>' + (it.estado === 'aberta' ? '✅ ' : '📲 ') + esc(it.titulo) + '</h4>' +
            '<div class="zap-msg">' + fmt((it.linhas || []).join('\n')) + '</div>' +
            (seguro ? '<div class="botoes"><a class="btn ok btn-zap" href="' + esc(seguro) + '" target="_blank" rel="noopener" data-zap="' + k + '">' + (it.estado === 'aberta' ? 'Abrir de novo no WhatsApp' : 'Enviar no WhatsApp') + '</a></div>' : '') +
            (it.estado === 'aberta' ? '<div class="muted">Aberto no WhatsApp. Confira e toque em enviar lá.</div>' : '') +
            (!zapAutomatico ? '<div class="muted zap-dica">Para mandar com um toque, sem abrir o WhatsApp: ligue a Z-API (variável ZAPI_OMNI_KEY na Vercel e um novo deploy). O selo Zap no topo fica verde.</div>' : '') + '</div>';
        }
        if (it.tipo === 'nota') return '<div class="m nota">' + fmt(it.content) + '</div>';
        if (it.role === 'user') return '<div class="m eu">' + fmt(it.content) + '</div>';
        return '<div class="m ia" data-k="' + k + '">' + md(it.content) + '</div>';
      }).join('');
    c.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => confirmar(Number(b.dataset.ok))));
    c.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', () => acaoAviso(b.dataset.av, b.dataset.acao)));
    c.querySelectorAll('[data-zap]').forEach((b) => b.addEventListener('click', () => {
      const it = itens[Number(b.dataset.zap)];
      if (it && it.estado !== 'aberta') { it.estado = 'aberta'; setTimeout(() => { guardar(); desenhar(); }, 300); }
    }));
    c.querySelectorAll('[data-nao]').forEach((b) => b.addEventListener('click', () => { itens[Number(b.dataset.nao)].estado = 'cancelada'; nota('Cancelado: ' + itens[Number(b.dataset.nao)].titulo); }));
    // resposta nova: mostra o começo dela (respostas longas não ficam cortadas em cima)
    const alvo = typeof rolar === 'number' ? c.querySelector('.m.ia[data-k="' + rolar + '"]') : null;
    if (alvo) c.scrollTop = Math.max(0, alvo.offsetTop - c.offsetTop - 8);
    else c.scrollTop = c.scrollHeight;
  }

  function nota(t, conv) {
    conv = conv || conversaAtual();
    conv.itens.push({ tipo: 'nota', content: t });
    guardar(conv);
    if (conv === atual) desenhar();
  }

  // o que vai para a IA: as mensagens e as notas (ações confirmadas/canceladas) como contexto
  const historico = (lista) => lista.filter((it) => it.role || it.tipo === 'nota')
    .map((it) => (it.role ? { role: it.role, content: it.content } : { role: 'user', content: '[registro do sistema] ' + it.content }));

  // a caixa de mensagem cresce conforme o texto (até um limite) e volta ao normal depois de enviar
  function crescer() {
    const m = $('#msg');
    m.style.height = 'auto';
    m.style.height = Math.min(m.scrollHeight + 3, 160) + 'px';
  }

  let ocupado = false;
  async function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || ocupado) return;
    ocupado = true; $('#msg').value = ''; crescer();
    focoManual = false; // mandou mensagem: volta para a conversa para ver a resposta
    let novaResposta = null;
    itens.push({ role: 'user', content: texto });
    const conv = conversaAtual();
    const lista = conv.itens;
    guardar(conv); desenhar();
    $('#conversa').insertAdjacentHTML('beforeend', '<div class="digitando">RB Central está trabalhando…</div>');
    if (cerebro) cerebro.pensando(true);
    $('#conversa').scrollTop = $('#conversa').scrollHeight;
    try {
      const d = await chamar('chat', { mensagens: historico(lista) });
      if (cerebro) cerebro.acender(d.usadas);
      novaResposta = { role: 'assistant', content: d.resposta };
      lista.push(novaResposta);
      (d.acoes || []).forEach((a) => lista.push(a.tipo === 'whatsapp'
        ? { tipo: 'zap', titulo: a.titulo, linhas: a.linhas, link: a.link }
        : { tipo: 'acao', token: a.token, titulo: a.titulo, linhas: a.linhas, em: Date.now(), link: a.link }));
    } catch (e) {
      lista.push({ tipo: 'nota', content: '⚠️ ' + e.message });
    }
    ocupado = false; guardar(conv);
    if (conv === atual) desenhar(novaResposta ? lista.indexOf(novaResposta) : undefined);
    if (cerebro) cerebro.pensando(false);
  }

  async function confirmar(k) {
    const it = itens[k];
    const conv = atual;
    if (!it || it.estado || !conv) return;
    it.estado = 'enviando'; desenhar();
    try {
      const d = await chamar('confirmar', { acao: it.token });
      it.estado = 'feita';
      const r = d.resultado || {};
      it.resultado = Array.isArray(r.feito) ? r.feito.join('\n') : r.link_whatsapp ? (r.enviado ? 'Mensagem enviada.' : 'Abra para enviar: ' + r.link_whatsapp) : 'Feito.';
      nota('Confirmado e executado: ' + it.titulo, conv);
      if (r.aviso && r.aviso.id) conv.itens.push({ tipo: 'aviso', id: r.aviso.id, titulo: r.aviso.titulo, linhas: r.aviso.linhas });
      (r.acoes || []).forEach((a) => conv.itens.push(a.tipo === 'whatsapp'
        ? { tipo: 'zap', titulo: a.titulo, linhas: a.linhas, link: a.link }
        : { tipo: 'acao', token: a.token, titulo: a.titulo, linhas: a.linhas, em: Date.now(), link: a.link }));
      if (r.aviso || r.acoes) { guardar(conv); if (conv === atual) desenhar(); carregarAvisos(); }
      if (r.link_whatsapp && !r.enviado) window.open(r.link_whatsapp, '_blank', 'noopener');
    } catch (e) {
      it.estado = 'falhou'; it.resultado = e.message;
      nota('Falhou: ' + it.titulo + ' (' + e.message + ')', conv);
    }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-erro').hidden = true;
    try {
      const d = await chamar('login', { senha: $('#senha').value });
      token = d.token;
      try { localStorage.setItem(CHAVE_TOKEN, token); } catch (er) { /* ignora */ }
      $('#senha').value = '';
      entrar();
    } catch (er) { $('#login-erro').textContent = er.message; $('#login-erro').hidden = false; }
  });
  $('#enviar').addEventListener('submit', (e) => {
    e.preventDefault();
    if (gravacao) return pararGravacao('enviar'); // tocou em enviar enquanto falava: transcreve e envia
    pararVoz(false); enviar($('#msg').value);
  });

  // ---------- Microfone ----------
  // 1º: grava o áudio e transcreve no servidor com o Whisper large-v3 (Groq): funciona em qualquer navegador, inclusive no iPhone.
  // 2º (sem GROQ_API_KEY): reconhecimento de voz do navegador. 3º: ditado do teclado.
  // Enquanto ouve, o cérebro acende em neon e pulsa junto com a voz. Para sozinho quando você para de falar.
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  const podeGravar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let vozNuvem = false; // o servidor transcreve (vem do /api/status)
  let rec = null, ouvindo = false, enviarAoFim = true, textoBase = '', finalVoz = '';
  let gravacao = null, transcrevendo = false;
  const mic = $('#mic');
  function pararVoz(enviarDepois) {
    enviarAoFim = !!enviarDepois;
    if (rec && ouvindo) { try { rec.stop(); } catch (e) { /* ignora */ } }
    if (gravacao) pararGravacao(enviarDepois ? 'enviar' : 'descartar');
  }
  function estadoMic(e, dica) {
    mic.classList.toggle('on', e === 'ouvindo');
    mic.classList.toggle('carregando', e === 'transcrevendo');
    mic.setAttribute('aria-pressed', String(e === 'ouvindo'));
    mic.setAttribute('aria-label', e === 'ouvindo' ? 'Parar de ouvir' : e === 'transcrevendo' ? 'Transcrevendo' : 'Falar com o RB Central');
    $('#msg').placeholder = dica || (e === 'ouvindo' ? 'Pode falar… estou ouvindo' : e === 'transcrevendo' ? 'Transcrevendo…' : 'O que você precisa?');
    if (cerebro) {
      cerebro.ouvindo(e === 'ouvindo');
      if (e === 'transcrevendo' || mic.dataset.pensou) { cerebro.pensando(e === 'transcrevendo' || ocupado); mic.dataset.pensou = e === 'transcrevendo' ? '1' : ''; }
    }
  }
  const paraBase64 = (blob) => new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => erro(new Error('não consegui ler o áudio'));
    r.readAsDataURL(blob);
  });

  async function gravar() {
    if (ocupado || gravacao || transcrevendo) return;
    // o iPhone só libera o áudio se ele for criado no toque
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctxA = null;
    try { ctxA = AC ? new AC() : null; if (ctxA && ctxA.state === 'suspended') ctxA.resume(); } catch (e) { ctxA = null; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      if (ctxA) ctxA.close().catch(() => {});
      const n = (e && e.name) || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') nota('🎤 O microfone está bloqueado para este site. No iPhone: toque em "aA" na barra de endereço › Ajustes do Site › Microfone › Permitir (no Chrome do iPhone: Ajustes do iPhone › Chrome › Microfone). No computador: cadeado ao lado do endereço › Microfone › Permitir.');
      else if (n === 'NotFoundError') nota('🎤 Não achei nenhum microfone neste aparelho.');
      else nota('🎤 Não consegui ligar o microfone (' + (n || 'erro') + ').');
      return;
    }
    const tipo = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
    let mr;
    try { mr = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, tipo ? { mimeType: tipo } : {})); } catch (e) {
      try { mr = new MediaRecorder(stream); } catch (e2) {
        stream.getTracks().forEach((t) => t.stop()); if (ctxA) ctxA.close().catch(() => {});
        return nota('🎤 Este navegador não consegue gravar áudio.');
      }
    }
    const g = { mr, stream, ctxA, pedacos: [], modo: 'enviar', falou: false, voz: 0, inicio: Date.now(), ultimaVoz: 0, piso: 1, medidor: false, base: $('#msg').value.trim() };
    gravacao = g;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) g.pedacos.push(e.data); };
    mr.onstop = () => terminarGravacao(g);
    // volume da voz: o cérebro pulsa junto e a gravação para sozinha depois de 1,5 s de silêncio
    let an = null, amostra = null;
    if (ctxA) {
      try { an = ctxA.createAnalyser(); an.fftSize = 1024; ctxA.createMediaStreamSource(stream).connect(an); amostra = new Uint8Array(an.fftSize); g.medidor = true; } catch (e) { an = null; }
    }
    g.timer = setInterval(() => {
      const agora = Date.now(), t = agora - g.inicio;
      if (an) {
        an.getByteTimeDomainData(amostra);
        let soma = 0;
        for (let i = 0; i < amostra.length; i++) { const v = (amostra[i] - 128) / 128; soma += v * v; }
        const rms = Math.sqrt(soma / amostra.length);
        // ruído de fundo: começa pelo menor volume do início e se ajusta devagar
        if (t < 350) g.piso = Math.min(g.piso, rms);
        else g.piso = rms < g.piso ? g.piso * 0.7 + rms * 0.3 : g.piso * 0.997 + rms * 0.003;
        const limiar = Math.max(0.012, Math.min(0.08, g.piso * 3));
        if (t >= 350 && rms > limiar) {
          g.voz++; g.ultimaVoz = agora;
          if (g.voz >= 2) g.falou = true;
          if (cerebro && agora - (g.pulso || 0) > 220) { g.pulso = agora; cerebro.falando(); }
        }
        mic.style.setProperty('--nivel', Math.min(1, rms / 0.12).toFixed(2));
        if (g.falou && agora - g.ultimaVoz > 1500) return pararGravacao('enviar');
        if (!g.falou && t > 8000) return pararGravacao('nada');
      } else if (t > 15000) return pararGravacao('enviar'); // sem medidor de volume: no máximo 15 s (ou toque para parar)
      if (t > 60000) pararGravacao('enviar');
    }, 100);
    try { mr.start(); } catch (e) {
      clearInterval(g.timer); gravacao = null;
      stream.getTracks().forEach((t) => t.stop()); if (ctxA) ctxA.close().catch(() => {});
      return nota('🎤 Não consegui começar a gravar.');
    }
    estadoMic('ouvindo');
  }
  function pararGravacao(modo) {
    const g = gravacao;
    if (!g) return;
    g.modo = modo;
    clearInterval(g.timer);
    try { if (g.mr.state !== 'inactive') g.mr.stop(); else terminarGravacao(g); } catch (e) { terminarGravacao(g); }
  }
  // qual motor transcreveu: Claude (até o limite do dia) ou Whisper grátis; avisa uma vez quando o limite acaba
  function motorVoz(d) {
    const c = d.claude || {};
    mic.title = d.motor === 'claude' ? 'Voz: Whisper + revisão do Claude (' + c.usados + ' de ' + c.limite + ' hoje)' : 'Voz: Whisper grátis' + (c.esgotado ? ' (limite do Claude de hoje atingido)' : '');
    if (!c.esgotado) return;
    const hoje = new Date().toLocaleDateString('pt-BR');
    let avisado = '';
    try { avisado = localStorage.getItem('rbcentral_voz_limite') || ''; } catch (e) { /* ignora */ }
    if (avisado === hoje) return;
    try { localStorage.setItem('rbcentral_voz_limite', hoje); } catch (e) { /* ignora */ }
    nota('🎤 As ' + c.limite + ' transcrições de hoje revisadas pelo Claude acabaram. Até amanhã o microfone segue com o Whisper grátis.');
  }
  async function terminarGravacao(g) {
    if (g.fim) return;
    g.fim = true;
    clearInterval(g.timer);
    if (gravacao === g) gravacao = null;
    g.stream.getTracks().forEach((t) => t.stop()); // apaga o aviso de microfone ligado do aparelho
    if (g.ctxA) g.ctxA.close().catch(() => {});
    mic.style.removeProperty('--nivel');
    if (g.modo === 'descartar') return estadoMic('livre');
    if (g.modo === 'nada' || (g.medidor && !g.falou && g.modo !== 'caixa')) { estadoMic('livre'); return nota('🎤 Não ouvi nada. Toque no microfone e fale perto dele.'); }
    const blob = new Blob(g.pedacos, { type: String(g.mr.mimeType || 'audio/webm').split(';')[0] });
    if (blob.size < 800) { estadoMic('livre'); return nota('🎤 A gravação ficou vazia. Tente de novo.'); }
    transcrevendo = true;
    estadoMic('transcrevendo');
    try {
      const d = await chamar('transcrever', { audio: await paraBase64(blob), tipo: blob.type });
      const texto = String(d.texto || '').trim();
      transcrevendo = false; estadoMic('livre');
      motorVoz(d);
      if (!texto) return nota('🎤 Não entendi. Fale de novo, um pouco mais perto do microfone.');
      $('#msg').value = [g.base, texto].filter(Boolean).join(' ');
      crescer();
      if (g.modo === 'enviar') enviar($('#msg').value); // parou de falar: envia sozinho
      else $('#msg').focus(); // parou no botão: o texto fica na caixa para conferir
    } catch (e) {
      transcrevendo = false; estadoMic('livre');
      if (/GROQ_API_KEY/.test(e.message)) vozNuvem = false;
      nota('🎤 Não consegui transcrever: ' + e.message);
    }
  }

  // ditado do teclado (último recurso): o cérebro acende enquanto o texto entra
  let ditando = false;
  const modoDitado = (sim) => {
    ditando = sim;
    mic.classList.toggle('on', sim);
    mic.setAttribute('aria-pressed', String(sim));
    $('#msg').placeholder = sim ? 'Use o 🎤 do teclado e fale…' : 'O que você precisa?';
    if (cerebro) cerebro.ouvindo(sim);
    if (sim) $('#msg').focus();
  };
  $('#msg').addEventListener('input', () => { if (ditando && cerebro) cerebro.falando(); });
  $('#msg').addEventListener('blur', () => { if (ditando) setTimeout(() => { if (document.activeElement !== $('#msg')) modoDitado(false); }, 200); });
  $('#enviar').addEventListener('submit', () => { if (ditando) modoDitado(false); });
  // sem reconhecimento de voz no navegador (ex.: Chrome do iPhone, iPhone sem Siri): usa o ditado do teclado
  let usarDitado = !Reconhecimento, irParaDitado = false;
  {
    const marcar = (sim) => { ouvindo = sim; estadoMic(sim ? 'ouvindo' : 'livre'); };
    mic.addEventListener('click', () => {
      if (gravacao) return pararGravacao('caixa'); // tocar de novo: para e deixa o texto na caixa para conferir
      if (transcrevendo) return;
      if (vozNuvem && podeGravar && !ditando) { gravar(); return; }
      if (usarDitado) { modoDitado(!ditando); return; }
      if (ouvindo) { pararVoz(false); return; } // tocar de novo para: o texto fica na caixa, sem enviar
      if (ocupado) return;
      rec = new Reconhecimento();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = false;
      textoBase = $('#msg').value.trim(); finalVoz = ''; enviarAoFim = true;
      rec.onstart = () => marcar(true);
      rec.onresult = (e) => {
        let parcial = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalVoz += e.results[i][0].transcript;
          else parcial += e.results[i][0].transcript;
        }
        $('#msg').value = [textoBase, (finalVoz + parcial).trim()].filter(Boolean).join(' ');
        crescer();
        if (cerebro) cerebro.falando();
      };
      rec.onerror = (e) => {
        if (e.error === 'service-not-allowed') { enviarAoFim = false; usarDitado = true; irParaDitado = true; return; }
        if (e.error === 'not-allowed') nota('🎤 O navegador bloqueou o microfone. Libere o microfone para este site nas configurações do navegador.');
        else if (e.error === 'no-speech') nota('🎤 Não ouvi nada. Toque no microfone e fale de novo.');
        else if (e.error !== 'aborted') nota('🎤 Não consegui ouvir (' + e.error + ').');
        enviarAoFim = false;
      };
      rec.onend = () => {
        marcar(false);
        if (irParaDitado) { irParaDitado = false; modoDitado(true); return; }
        const texto = $('#msg').value.trim();
        if (enviarAoFim && finalVoz.trim() && texto) enviar(texto); // parou de falar: envia sozinho
      };
      try { rec.start(); } catch (e) { marcar(false); nota('🎤 Não consegui ligar o microfone.'); }
    });
  }
  // Enter: no computador (mouse e teclado físico) envia, e Shift+Enter quebra a linha;
  // no celular quebra a linha, e quem envia é o botão ➤. Ctrl+Enter ou ⌘+Enter envia sempre.
  const ehComputador = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
  $('#msg').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const envia = e.ctrlKey || e.metaKey || (ehComputador() && !e.shiftKey && !e.altKey);
    if (!envia) return; // celular, ou Shift+Enter no computador: quebra a linha
    e.preventDefault();
    if (ditando) modoDitado(false);
    pararVoz(false);
    enviar($('#msg').value);
  });
  $('#msg').addEventListener('input', crescer);
  $('#sair').addEventListener('click', sair);
  function novaConversa() {
    abrirConversa(null); focoManual = false;
    fecharHistorico(); desenhar(); $('#msg').focus();
  }
  $('#limpar').addEventListener('click', novaConversa);

  // ---------- Histórico: as 6 últimas conversas ----------
  const quando = (t) => {
    const d = new Date(t), hoje = new Date();
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dif = Math.round((dia(hoje) - dia(d)) / 86400000);
    return dif === 0 ? 'Hoje ' + hora : dif === 1 ? 'Ontem ' + hora : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
  };
  const tituloConversa = (c) => {
    const p = c.itens.find((i) => i.role === 'user');
    return p ? p.content.split('\n')[0].trim().slice(0, 80) : 'Conversa';
  };
  function desenharHistorico() {
    const lista = conversas.filter(temMensagem).slice(0, MAX_CONVERSAS);
    $('#hist-lista').innerHTML = lista.length ? lista.map((c) => {
      const n = c.itens.filter((i) => i.role).length;
      return '<li class="hist-item' + (c === atual ? ' atual' : '') + '">' +
        '<button type="button" class="hist-abrir" data-abrir="' + esc(c.id) + '"><span class="hist-tit">' + esc(tituloConversa(c)) + '</span>' +
        '<span class="hist-sub">' + (c === atual ? 'Aberta agora · ' : '') + quando(c.atualizada) + ' · ' + n + (n === 1 ? ' mensagem' : ' mensagens') + '</span></button>' +
        '<button type="button" class="hist-apagar" data-apagar="' + esc(c.id) + '" aria-label="Apagar esta conversa" title="Apagar">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></li>';
    }).join('') : '<li class="hist-vazio">Nenhuma conversa guardada ainda.</li>';
  }
  function abrirHistorico() {
    desenharHistorico();
    mostrarNuvem();
    sincronizar(true);
    $('#hist').hidden = false;
    $('#hist-btn').setAttribute('aria-expanded', 'true');
  }
  function fecharHistorico() {
    $('#hist').hidden = true;
    $('#hist-btn').setAttribute('aria-expanded', 'false');
  }
  $('#hist-btn').addEventListener('click', () => ($('#hist').hidden ? abrirHistorico() : fecharHistorico()));
  $('#hist').addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar]')) return fecharHistorico();
    if (e.target.closest('#hist-nova')) return novaConversa();
    const ab = e.target.closest('[data-abrir]');
    if (ab) {
      const c = conversas.find((x) => x.id === ab.dataset.abrir);
      if (c) { abrirConversa(c); focoManual = false; fecharHistorico(); desenhar(); }
      return;
    }
    const ap = e.target.closest('[data-apagar]');
    if (ap) {
      const c = conversas.find((x) => x.id === ap.dataset.apagar);
      if (!c || !confirm('Apagar a conversa "' + tituloConversa(c).slice(0, 40) + '"?')) return;
      conversas = conversas.filter((x) => x !== c);
      clearTimeout(envios.get(c.id)); envios.delete(c.id);
      apagadas.push(c.id); gravarApagadas(); apagarNaNuvem(c.id);
      if (c === atual) { abrirConversa(null); desenhar(); }
      guardar(); desenharHistorico();
      return;
    }
    if (e.target.closest('#hist-sql')) copiarSql();
  });
  // copia o SQL do histórico para colar no Supabase (SQL Editor › New query › Run)
  async function copiarSql() {
    const b = $('#hist-sql');
    try {
      const sql = await (await fetch('supabase/central_conversas.sql', { cache: 'no-store' })).text();
      await navigator.clipboard.writeText(sql);
      b.textContent = '✅ SQL copiado. Cole no Supabase › SQL Editor › New query › Run';
    } catch (e) {
      window.open('supabase/central_conversas.sql', '_blank', 'noopener');
    }
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#hist').hidden) fecharHistorico(); });

  // ---------- CRM do WhatsApp: clientes que conversaram com o WhatsApp da loja ----------
  const ETAPA_NOME = { novo: 'Novo', em_atendimento: 'Em atendimento', orcamento: 'Orçamento', negociando: 'Negociando', fechado: 'Fechado', comprou: 'Comprou', perdido: 'Perdido', pos_venda: 'Pós-venda' };
  const SITUACAO_NOME = { loja_sem_responder: '🔴 Loja sem responder', cliente_sumiu: '🟠 Cliente sumiu', nao_buscou: '🟡 Fechou e não buscou', fechado: '🤝 Fechou: falta buscar ou pagar' };
  // o CRM mostra só quem quer comprar iPhone; o resto fica na aba "Outros", sem ação
  const TIPO_NOME = { vende_para_loja: 'Vendendo p/ loja', reparo: 'Reparo', outro: 'Outro assunto' };
  const TIPO_ICONE = { vende_para_loja: '📦', reparo: '🔧', outro: '💬' };
  let crmFiltro = 'sem_resposta', crmLista = [], crmBuscaTimer = null, crmLendo = false, crmEmLeitura = false;
  const fone = (n) => { const m = String(n || '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? '+55 ' + m[1] + ' ' + m[2] + '-' + m[3] : '+' + n; };
  const haQuanto = (t) => {
    const min = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    if (min < 24 * 60) return 'há ' + Math.round(min / 60) + ' h';
    return quando(t);
  };
  const reais = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function cartaoCrm(c) {
    const comprador = !c.tipo || c.tipo === 'compra_iphone';
    const esperando = comprador && c.ultima_de === 'cliente';
    const selo = comprador
      ? '<span class="crm-etapa etapa-' + esc(c.etapa) + '">' + esc(ETAPA_NOME[c.etapa] || c.etapa) + '</span>'
      : '<span class="crm-etapa etapa-fora">' + esc(TIPO_NOME[c.tipo] || 'Outro') + '</span>';
    return '<li class="crm-item' + (comprador ? '' : ' crm-fora') + '" data-numero="' + esc(c.numero) + '">' +
      '<div class="crm-topo"><b>' + esc(c.nome || fone(c.numero)) + '</b>' + selo + '</div>' +
      '<div class="crm-sub">' + esc(fone(c.numero)) + ' · ' + esc(haQuanto(c.ultimo_contato)) + (esperando ? ' · <span class="crm-esperando">esperando resposta</span>' : '') + (comprador && c.veio_do_site ? ' · 🌐 veio do site' : '') + '</div>' +
      (comprador && SITUACAO_NOME[c.situacao] ? '<div class="crm-situacao sit-' + esc(c.situacao) + '">' + SITUACAO_NOME[c.situacao] + (c.retirada_em && /fechado|nao_buscou/.test(c.situacao) ? ' · combinado para ' + esc(String(c.retirada_em).split('-').reverse().slice(0, 2).join('/')) : '') + '</div>' : '') +
      (c.interesse ? '<div class="crm-interesse">' + (comprador ? '📱' : TIPO_ICONE[c.tipo] || '💬') + ' ' + esc(c.interesse) + (comprador && Number(c.valor) > 0 ? ' · ' + reais(c.valor) : '') + '</div>' : '') +
      (c.resumo ? '<div class="crm-resumo">' + esc(c.resumo) + '</div>' : (c.msgs_novas > 0 ? '<div class="crm-resumo muted">A IA ainda vai ler esta conversa…</div>' : '')) +
      (c.proxima_acao ? '<div class="crm-acao">➡️ ' + esc(c.proxima_acao) + '</div>' : '') +
      (c.ultima_msg ? '<div class="crm-ultima">' + (c.ultima_de === 'cliente' ? (comprador ? 'Cliente' : 'Contato') : 'Loja') + ': “' + esc(c.ultima_msg) + '”</div>' : '') +
      '<div class="crm-botoes"><button type="button" class="btn-mini" data-crm-ver>Ver conversa</button>' + (comprador ? '<button type="button" class="btn-mini crm-responder" data-crm-responder>Responder com a IA</button>' : '') + '</div>' +
      '<div class="crm-conversa" hidden></div></li>';
  }
  function desenharCrm(d) {
    const ativo = !!(d && d.ativo);
    $('#crm-ligar').hidden = !ativo;
    if (!ativo) {
      $('#crm-lista').innerHTML = '<li class="hist-vazio">Para o CRM ler o WhatsApp da loja, a Z-API Omni precisa estar ligada na Vercel (ZAPI_OMNI_KEY e ZAPI_OMNI_CANAL), e o SQL rodado no Supabase.</li>';
      return;
    }
    if (d.motivo) { $('#crm-lista').innerHTML = '<li class="hist-vazio">Não consegui abrir o CRM: ' + esc(d.motivo) + '</li>'; return; }
    const vazio = crmLendo ? 'A IA está lendo as conversas…'
      : crmFiltro === 'outros' ? 'Nenhuma conversa de reparo, de quem vende para a loja ou de outro assunto.'
        : crmFiltro === 'sem_resposta' ? 'Nenhum cliente de iPhone esperando resposta. 👍'
          : 'Nenhum cliente querendo comprar iPhone ainda. As conversas novas do WhatsApp vão aparecendo aqui.';
    $('#crm-lista').innerHTML =
      (d.precisa_sql ? '<li class="hist-vazio crm-aviso">Para mostrar só quem quer comprar iPhone, rode de novo o SQL do CRM no Supabase (o mesmo arquivo de antes, supabase/central_conversas.sql).</li>' : '') +
      (crmLendo && crmLista.length ? '<li class="hist-vazio crm-aviso">🔎 A IA está lendo as conversas novas…</li>' : '') +
      (crmLista.length ? crmLista.map(cartaoCrm).join('') : '<li class="hist-vazio">' + vazio + '</li>');
  }
  // analisar = quantas levas de conversas a IA ainda pode ler agora (6 por leva)
  async function carregarCrm(analisar) {
    const busca = $('#crm-busca').value.trim();
    const outros = crmFiltro === 'outros';
    try {
      const d = await chamar('crm?filtro=' + encodeURIComponent(outros ? 'todos' : crmFiltro) + '&tipo=' + (outros ? 'outros' : 'compra_iphone') + '&busca=' + encodeURIComponent(busca));
      crmLista = Array.isArray(d.contatos) ? d.contatos : [];
      crmLendo = !!(analisar && d.ativo && !d.motivo && !crmEmLeitura); // uma leitura por vez (trocar de aba não dobra o gasto)
      desenharCrm(d);
      // a IA lê as conversas com mensagens novas, separa quem quer comprar iPhone e atualiza as fichas
      if (crmLendo) {
        crmEmLeitura = true;
        const a = await chamar('crm', { acao: 'analisar' }).catch(() => ({}));
        crmEmLeitura = false;
        crmLendo = false;
        if ($('#crm').hidden) return;
        if (a.analisados > 0) return carregarCrm(a.analisados >= 6 && analisar > 1 ? analisar - 1 : 0);
        desenharCrm(d);
      }
    } catch (e) {
      crmLendo = false;
      $('#crm-lista').innerHTML = '<li class="hist-vazio">Não consegui abrir o CRM: ' + esc(e.message) + '</li>';
    }
  }
  function abrirCrm() {
    $('#crm').hidden = false;
    $('#crm-btn').setAttribute('aria-expanded', 'true');
    $('#crm-lista').innerHTML = '<li class="hist-vazio">Carregando…</li>';
    carregarCrm(15);
  }
  async function conferirLeitura() {
    const ul = $('#crm-diag');
    ul.hidden = false; ul.innerHTML = '<li class="muted">Conferindo…</li>';
    try {
      const d = await chamar('crm', { acao: 'diagnostico' });
      ul.innerHTML = (d.itens || []).map((i) => '<li class="' + (i.ok ? 'ok' : 'falta') + '">' + (i.ok ? '✅ ' : '❌ ') + esc(i.texto) + '</li>').join('') +
        '<li class="muted">Só entram mensagens novas, a partir de quando a leitura foi ligada. Para testar, mande uma mensagem de outro celular para o WhatsApp da loja.</li>';
    } catch (er) { ul.innerHTML = '<li class="falta">❌ ' + esc(er.message) + '</li>'; }
  }
  function fecharCrm() { $('#crm').hidden = true; $('#crm-btn').setAttribute('aria-expanded', 'false'); }
  $('#crm-btn').addEventListener('click', () => ($('#crm').hidden ? abrirCrm() : fecharCrm()));
  $('#crm-busca').addEventListener('input', () => { clearTimeout(crmBuscaTimer); crmBuscaTimer = setTimeout(() => carregarCrm(false), 350); });
  $('#crm').addEventListener('click', async (e) => {
    if (e.target.closest('[data-fechar-crm]')) return fecharCrm();
    const aba = e.target.closest('[data-crm-filtro]');
    if (aba) {
      crmFiltro = aba.dataset.crmFiltro;
      document.querySelectorAll('.crm-aba').forEach((b) => b.classList.toggle('on', b === aba));
      $('#crm-lista').innerHTML = '<li class="hist-vazio">Carregando…</li>';
      return carregarCrm(15);
    }
    if (e.target.closest('#crm-ligar')) {
      const b = $('#crm-ligar');
      b.disabled = true; b.textContent = 'Ligando…';
      try {
        const d = await chamar('crm', { acao: 'ligar' });
        b.textContent = d.atualizado ? '✅ Leitura do WhatsApp já estava ligada (atualizada)' : '✅ Leitura do WhatsApp ligada: as mensagens novas vão chegar aqui';
      } catch (er) { b.textContent = 'Tentar de novo: ' + er.message; }
      b.disabled = false;
      conferirLeitura();
      return;
    }
    if (e.target.closest('#crm-conferir')) return conferirLeitura();
    const item = e.target.closest('.crm-item');
    if (!item) return;
    const numero = item.dataset.numero;
    const c = crmLista.find((x) => x.numero === numero) || {};
    if (e.target.closest('[data-crm-responder]')) {
      fecharCrm();
      $('#msg').value = 'Leia a conversa de WhatsApp com ' + (c.nome || fone(numero)) + ' (' + numero + ') e prepare uma resposta para eu confirmar.';
      crescer(); $('#msg').focus();
      return;
    }
    if (e.target.closest('[data-crm-ver]')) {
      const box = item.querySelector('.crm-conversa');
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = '<p class="muted">Carregando…</p>';
      try {
        const d = await chamar('crm', { acao: 'conversa', numero });
        const msgs = (d && d.mensagens) || [];
        box.innerHTML = msgs.length ? msgs.map((m) => '<div class="crm-msg ' + (m.de_mim ? 'loja' : 'cliente') + '"><span>' + fmt(m.texto) + '</span><small>' + esc(quando(m.criado)) + '</small></div>').join('') : '<p class="muted">Sem mensagens guardadas.</p>';
        box.scrollTop = box.scrollHeight;
      } catch (er) { box.innerHTML = '<p class="muted">' + esc(er.message) + '</p>'; }
    }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#crm').hidden) fecharCrm(); });

  if (token) entrar(); else { $('#login').hidden = false; if (cerebro) cerebro.modo('login'); }
})();
