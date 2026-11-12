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
      if (conv.itens.length > MAX_ITENS) conv.itens.splice(0, conv.itens.length - MAX_ITENS);
    }
    conversas.sort((a, b) => b.atualizada - a.atualizada);
    // guarda só as 6 mais recentes que têm mensagem do dono; a mais antiga sai quando entra a 7ª
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

  // cérebro: cada neurônio é uma aba de um sistema; tocar nele pede aquilo para a IA
  let cerebro = null;
  if (window.RBCerebro) {
    RBCerebro.criar($('#cerebro-login'), { rotulos: false });
    cerebro = RBCerebro.criar($('#cerebro-desenho'), { onClick: (a) => enviar(a.pedido) });
  }
  const CHAVE_CEREBRO = 'rbcentral_cerebro_pref'; // 'aberto' | 'recolhido' | '' (automático)
  let prefCerebro = '';
  try { prefCerebro = localStorage.getItem(CHAVE_CEREBRO) || ''; } catch (e) { /* ignora */ }
  const mostrarCerebro = (recolhido) => {
    $('#cerebro').classList.toggle('recolhido', recolhido);
    $('#cb-recolher').setAttribute('aria-expanded', String(!recolhido));
    $('#cb-recolher').textContent = recolhido ? '▾' : '▴';
    $('#cb-recolher').title = recolhido ? 'Mostrar o cérebro' : 'Recolher o cérebro';
  };
  // automático: no celular, com conversa na tela, o cérebro fica numa faixa pequena
  const ajustarCerebro = () => mostrarCerebro(prefCerebro ? prefCerebro === 'recolhido' : (itens.length > 0 && innerWidth < 760));
  $('#cb-recolher').addEventListener('click', () => {
    prefCerebro = $('#cerebro').classList.contains('recolhido') ? 'aberto' : 'recolhido';
    try { localStorage.setItem(CHAVE_CEREBRO, prefCerebro); } catch (e) { /* ignora */ }
    ajustarCerebro();
  });
  addEventListener('resize', () => ajustarCerebro());

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
  }

  async function entrar() {
    $('#login').hidden = true; $('#app').hidden = false;
    desenhar();
    try {
      const s = await chamar('status');
      if (cerebro) cerebro.status(s);
      $('#conexoes').innerHTML = [['IA', s.ia], ['Site', s.site], ['CRM', s.crm], ['OS', s.sistema_os]]
        .map(([n, on]) => '<span class="con' + (on ? ' on' : '') + '">' + (on ? '● ' : '○ ') + n + '</span>').join('');
    } catch (e) { /* mostrado ao usar */ }
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
            (!it.estado ? '<div class="botoes"><button class="btn ok" data-ok="' + k + '">Confirmar</button><button class="btn nao" data-nao="' + k + '">Cancelar</button></div>' : '') + '</div>';
        }
        if (it.tipo === 'nota') return '<div class="m nota">' + fmt(it.content) + '</div>';
        if (it.role === 'user') return '<div class="m eu">' + fmt(it.content) + '</div>';
        return '<div class="m ia" data-k="' + k + '">' + md(it.content) + '</div>';
      }).join('');
    c.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => confirmar(Number(b.dataset.ok))));
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
      (d.acoes || []).forEach((a) => lista.push({ tipo: 'acao', token: a.token, titulo: a.titulo, linhas: a.linhas, em: Date.now() }));
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
  $('#enviar').addEventListener('submit', (e) => { e.preventDefault(); pararVoz(false); enviar($('#msg').value); });

  // ---------- Microfone: fala → texto (português). Enquanto ouve, o cérebro acende em neon ----------
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, ouvindo = false, enviarAoFim = true, textoBase = '', finalVoz = '';
  function pararVoz(enviarDepois) {
    enviarAoFim = !!enviarDepois;
    if (rec && ouvindo) { try { rec.stop(); } catch (e) { /* ignora */ } }
  }
  const mic = $('#mic');
  let ditando = false;
  const modoDitado = (sim) => {
    ditando = sim;
    mic.classList.toggle('on', sim);
    mic.setAttribute('aria-pressed', String(sim));
    $('#msg').placeholder = sim ? 'Toque no 🎤 do teclado e fale…' : 'O que você precisa?';
    if (cerebro) cerebro.ouvindo(sim);
    if (sim) $('#msg').focus();
  };
  $('#msg').addEventListener('input', () => { if (ditando && cerebro) cerebro.falando(); });
  $('#msg').addEventListener('blur', () => { if (ditando) setTimeout(() => { if (document.activeElement !== $('#msg')) modoDitado(false); }, 200); });
  $('#enviar').addEventListener('submit', () => { if (ditando) modoDitado(false); });
  // sem reconhecimento de voz no navegador (ex.: Chrome do iPhone, iPhone sem Siri): usa o ditado do teclado
  let usarDitado = !Reconhecimento, irParaDitado = false;
  {
    const marcar = (sim) => {
      ouvindo = sim;
      mic.classList.toggle('on', sim);
      mic.setAttribute('aria-pressed', String(sim));
      mic.setAttribute('aria-label', sim ? 'Parar de ouvir' : 'Falar com o RB Central');
      $('#msg').placeholder = sim ? 'Pode falar… estou ouvindo' : 'O que você precisa?';
      if (cerebro) cerebro.ouvindo(sim);
    };
    mic.addEventListener('click', () => {
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
  // Enter quebra a linha (não envia). No computador, Ctrl+Enter ou ⌘+Enter envia.
  $('#msg').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (ditando) modoDitado(false); pararVoz(false); enviar($('#msg').value); }
  });
  $('#msg').addEventListener('input', crescer);
  $('#sair').addEventListener('click', sair);
  function novaConversa() {
    abrirConversa(null); prefCerebro = '';
    try { localStorage.removeItem(CHAVE_CEREBRO); } catch (e) { /* ignora */ }
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
      if (c) { abrirConversa(c); prefCerebro = ''; fecharHistorico(); desenhar(); }
      return;
    }
    const ap = e.target.closest('[data-apagar]');
    if (ap) {
      const c = conversas.find((x) => x.id === ap.dataset.apagar);
      if (!c || !confirm('Apagar a conversa "' + tituloConversa(c).slice(0, 40) + '"?')) return;
      conversas = conversas.filter((x) => x !== c);
      if (c === atual) { abrirConversa(null); desenhar(); }
      guardar(); desenharHistorico();
    }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#hist').hidden) fecharHistorico(); });

  if (token) entrar(); else $('#login').hidden = false;
})();
