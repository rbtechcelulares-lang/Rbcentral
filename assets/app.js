(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  const CHAVE_TOKEN = 'rbcentral_token';
  const CHAVE_CONVERSA = 'rbcentral_conversa';
  let token = '';
  try { token = localStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { /* sem storage */ }
  // itens: { role: 'user'|'assistant', content } ou { tipo: 'acao', token, titulo, linhas, estado } ou { tipo: 'nota', content }
  let itens = [];
  try { itens = JSON.parse(localStorage.getItem(CHAVE_CONVERSA) || '[]'); } catch (e) { itens = []; }
  const guardar = () => { try { localStorage.setItem(CHAVE_CONVERSA, JSON.stringify(itens.slice(-80))); } catch (e) { /* ignora */ } };

  const RAPIDOS = ['📊 Relatório do dia', '👥 Clientes novos do CRM', '🔧 OS abertas', '📦 Pedidos de peças', '🎯 Metas', '📱 Aparelhos na vitrine'];

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
      $('#conexoes').innerHTML = [['IA', s.ia], ['Site', s.site], ['CRM', s.crm], ['Sistema de OS', s.sistema_os]]
        .map(([n, on]) => '<span class="con' + (on ? ' on' : '') + '">' + (on ? '● ' : '○ ') + n + '</span>').join('');
    } catch (e) { /* mostrado ao usar */ }
  }

  function desenhar() {
    const c = $('#conversa');
    c.innerHTML = (itens.length ? '' : '<div class="m ia">Olá! Sou o <b>RB Central</b>. Posso mudar preços, tirar aparelhos da vitrine, listar clientes do CRM, criar e atualizar OS, registrar pagamentos, avisar clientes, mexer nas metas, ver pedidos de peças e fazer o relatório do dia. Tudo que altera algo eu peço para você confirmar antes. 😉</div>') +
      itens.map((it, k) => {
        if (it.tipo === 'acao') {
          return '<div class="acao ' + (it.estado || '') + '" data-k="' + k + '"><h4>' + (it.estado === 'feita' ? '✅ ' : it.estado === 'cancelada' ? '✖ ' : it.estado === 'falhou' ? '⚠️ ' : '⏳ ') + esc(it.titulo) + '</h4>' +
            '<ul>' + (it.linhas || []).map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
            (it.resultado ? '<div class="muted">' + fmt(it.resultado) + '</div>' : '') +
            (!it.estado ? '<div class="botoes"><button class="btn ok" data-ok="' + k + '">Confirmar</button><button class="btn nao" data-nao="' + k + '">Cancelar</button></div>' : '') + '</div>';
        }
        if (it.tipo === 'nota') return '<div class="m nota">' + fmt(it.content) + '</div>';
        return '<div class="m ' + (it.role === 'user' ? 'eu' : 'ia') + '">' + fmt(it.content) + '</div>';
      }).join('');
    c.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => confirmar(Number(b.dataset.ok))));
    c.querySelectorAll('[data-nao]').forEach((b) => b.addEventListener('click', () => { itens[Number(b.dataset.nao)].estado = 'cancelada'; nota('Cancelado: ' + itens[Number(b.dataset.nao)].titulo); }));
    $('#rapidos').innerHTML = RAPIDOS.map((t) => '<button type="button">' + t + '</button>').join('');
    $('#rapidos').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => enviar(b.textContent.replace(/^\S+\s/, ''))));
    c.scrollTop = c.scrollHeight;
  }

  function nota(t) { itens.push({ tipo: 'nota', content: t }); guardar(); desenhar(); }

  // o que vai para a IA: as mensagens e as notas (ações confirmadas/canceladas) como contexto
  const historico = () => itens.filter((it) => it.role || it.tipo === 'nota')
    .map((it) => (it.role ? { role: it.role, content: it.content } : { role: 'user', content: '[registro do sistema] ' + it.content }));

  let ocupado = false;
  async function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || ocupado) return;
    ocupado = true; $('#msg').value = '';
    itens.push({ role: 'user', content: texto }); guardar(); desenhar();
    $('#conversa').insertAdjacentHTML('beforeend', '<div class="digitando">RB Central está trabalhando…</div>');
    $('#conversa').scrollTop = $('#conversa').scrollHeight;
    try {
      const d = await chamar('chat', { mensagens: historico() });
      itens.push({ role: 'assistant', content: d.resposta });
      (d.acoes || []).forEach((a) => itens.push({ tipo: 'acao', token: a.token, titulo: a.titulo, linhas: a.linhas }));
    } catch (e) {
      itens.push({ tipo: 'nota', content: '⚠️ ' + e.message });
    }
    ocupado = false; guardar(); desenhar();
  }

  async function confirmar(k) {
    const it = itens[k];
    if (!it || it.estado) return;
    it.estado = 'enviando'; desenhar();
    try {
      const d = await chamar('confirmar', { acao: it.token });
      it.estado = 'feita';
      const r = d.resultado || {};
      it.resultado = Array.isArray(r.feito) ? r.feito.join('\n') : r.link_whatsapp ? (r.enviado ? 'Mensagem enviada.' : 'Abra para enviar: ' + r.link_whatsapp) : 'Feito.';
      nota('Confirmado e executado: ' + it.titulo);
      if (r.link_whatsapp && !r.enviado) window.open(r.link_whatsapp, '_blank', 'noopener');
    } catch (e) {
      it.estado = 'falhou'; it.resultado = e.message;
      nota('Falhou: ' + it.titulo + ' (' + e.message + ')');
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
  $('#enviar').addEventListener('submit', (e) => { e.preventDefault(); enviar($('#msg').value); });
  $('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar($('#msg').value); } });
  $('#sair').addEventListener('click', sair);
  $('#limpar').addEventListener('click', () => { if (confirm('Começar uma conversa nova?')) { itens = []; guardar(); desenhar(); } });

  if (token) entrar(); else $('#login').hidden = false;
})();
