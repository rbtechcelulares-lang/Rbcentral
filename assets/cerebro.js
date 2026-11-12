// Cérebro do RB Central: um cérebro amarelo feito só de neurônios e conexões (sem textura).
// Núcleo no centro = RB Central. Cada neurônio grande = uma aba de um sistema que ele acessa.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 400, H = 300;
  // contorno do cérebro (visto de lado) — só para posicionar os neurônios e um traço bem leve
  const CONTORNO = 'M70,168 C52,120 82,72 132,62 C162,32 222,30 252,50 C302,44 348,80 352,126 C366,162 346,200 312,210 C302,236 272,246 246,236 L242,252 C236,264 220,266 212,255 L206,238 C170,246 130,236 110,216 C82,210 64,194 70,168 Z';
  const NUCLEO = { id: 'nucleo', x: 212, y: 142, rotulo: 'RB Central', pedido: 'Relatório do dia' };
  // sistema: 'site' | 'crm' | 'os' — define se o neurônio está aceso (conectado) ou apagado
  const ABAS = [
    { id: 'aparelhos', x: 122, y: 112, rotulo: 'Aparelhos', sistema: 'site', pedido: 'Lista os aparelhos do site com preço' },
    { id: 'vitrine', x: 104, y: 172, rotulo: 'Vitrine', sistema: 'site', pedido: 'Quais aparelhos estão na vitrine?' },
    { id: 'clientes', x: 168, y: 78, rotulo: 'Clientes', sistema: 'crm', pedido: 'Clientes novos do CRM' },
    { id: 'cliques', x: 152, y: 214, rotulo: 'Cliques', sistema: 'crm', pedido: 'Como foram os cliques e propostas do site hoje?' },
    { id: 'os', x: 266, y: 82, rotulo: 'OS', sistema: 'os', pedido: 'OS abertas' },
    { id: 'pagamentos', x: 318, y: 124, rotulo: 'Pagamentos', sistema: 'os', pedido: 'Quais OS estão prontas e ainda não foram pagas?' },
    { id: 'avisos', x: 300, y: 184, rotulo: 'Avisos', sistema: 'os', pedido: 'Quais clientes de OS precisam ser avisados hoje?' },
    { id: 'metas', x: 238, y: 208, rotulo: 'Metas', sistema: 'os', pedido: 'Como estão as metas?' },
    { id: 'pecas', x: 224, y: 246, rotulo: 'Peças', sistema: 'os', pedido: 'Pedidos de peças aos fornecedores' }
  ];
  // ferramenta da IA → neurônio que acende quando ela é usada
  const FERRAMENTA_ABA = {
    site_listar_aparelhos: ['aparelhos', 'vitrine'], site_alterar_preco: ['aparelhos'], site_vitrine: ['vitrine'],
    site_clientes_crm: ['clientes'], relatorio_do_dia: ['nucleo', 'cliques', 'metas'],
    os_listar: ['os'], os_ver: ['os'], os_configuracao: ['os'], os_criar: ['os'], os_mudar_status: ['os'],
    os_marcar_pago: ['pagamentos'], os_avisar_cliente: ['avisos'], metas_listar: ['metas'], meta_alterar: ['metas'], pecas_listar_pedidos: ['pecas']
  };

  // números "aleatórios" sempre iguais, para o desenho não mudar a cada visita
  let semente = 7;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };
  const el = (tag, at) => { const e = document.createElementNS(NS, tag); Object.entries(at || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function neuroniosDentro(caminho, n) {
    semente = 7;
    const pts = [];
    const ocupados = [NUCLEO].concat(ABAS);
    let tentativas = 0;
    // formato aproximado do cérebro (usado quando o navegador não sabe medir o contorno, ex.: tela ainda escondida)
    const aprox = (p) => ((p.x - 210) / 142) ** 2 + ((p.y - 136) / 98) ** 2 < 1 || (p.x > 205 && p.x < 245 && p.y > 225 && p.y < 258);
    let medir = false;
    try { medir = caminho.isPointInFill(new DOMPoint(NUCLEO.x, NUCLEO.y)); } catch (e) { medir = false; }
    while (pts.length < n && tentativas++ < 4000) {
      const p = { x: 60 + rnd() * 300, y: 30 + rnd() * 235 };
      let dentro;
      try { dentro = medir ? caminho.isPointInFill(new DOMPoint(p.x, p.y)) : aprox(p); } catch (e) { dentro = aprox(p); }
      if (!dentro) continue;
      if (ocupados.concat(pts).some((q) => dist(p, q) < 19)) continue;
      pts.push(p);
    }
    return pts;
  }

  function criar(container, opcoes) {
    const o = Object.assign({ onClick: null, rotulos: true }, opcoes);
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'cerebro-svg', role: 'img', 'aria-label': 'Cérebro do RB Central: cada neurônio é um sistema' });
    const contorno = el('path', { d: CONTORNO, class: 'cb-contorno' });
    svg.appendChild(contorno);
    container.innerHTML = '';
    container.appendChild(svg);

    const pequenos = neuroniosDentro(contorno, 46);
    const gLinhas = el('g', { class: 'cb-malha' });
    const gConexoes = el('g', { class: 'cb-conexoes' });
    const gPequenos = el('g', { class: 'cb-pequenos' });
    const gAbas = el('g', { class: 'cb-abas' });
    svg.append(gLinhas, gConexoes, gPequenos, gAbas);

    // malha: cada neurônio pequeno liga nos 2 mais próximos (e as abas em 3)
    const todos = pequenos.concat(ABAS);
    const feitas = new Set();
    todos.forEach((p, i) => {
      const k = ABAS.includes(p) ? 3 : 2;
      todos.map((q, j) => ({ j, d: dist(p, q) })).filter((x) => x.j !== i).sort((a, b) => a.d - b.d).slice(0, k).forEach(({ j }) => {
        const chave = Math.min(i, j) + '-' + Math.max(i, j);
        if (feitas.has(chave)) return;
        feitas.add(chave);
        gLinhas.appendChild(el('line', { x1: p.x, y1: p.y, x2: todos[j].x, y2: todos[j].y }));
      });
    });
    pequenos.forEach((p, i) => gPequenos.appendChild(el('circle', { cx: p.x, cy: p.y, r: 2 + (i % 3) * 0.7, style: '--d:' + (i % 7) * 0.4 + 's' })));

    // conexões do núcleo para cada aba (com um pulso correndo quando o sistema está conectado)
    const conexoes = {};
    ABAS.forEach((a, i) => {
      const meio = { x: (NUCLEO.x + a.x) / 2 + (i % 2 ? 10 : -10), y: (NUCLEO.y + a.y) / 2 + (i % 3 ? -8 : 8) };
      const d = 'M' + NUCLEO.x + ',' + NUCLEO.y + ' Q' + meio.x + ',' + meio.y + ' ' + a.x + ',' + a.y;
      const g = el('g', { class: 'cb-conexao off', 'data-id': a.id });
      g.append(el('path', { d, class: 'cb-fio' }), el('path', { d, class: 'cb-pulso', style: '--d:' + (i * 0.37).toFixed(2) + 's' }));
      gConexoes.appendChild(g);
      conexoes[a.id] = g;
    });

    // neurônios grandes (abas) e o núcleo
    const nos = {};
    [NUCLEO].concat(ABAS).forEach((a) => {
      const nucleo = a === NUCLEO;
      const g = el('g', { class: 'cb-no' + (nucleo ? ' cb-nucleo' : ' off'), 'data-id': a.id, tabindex: '0', role: 'button', 'aria-label': a.rotulo + ': ' + a.pedido });
      g.append(el('circle', { cx: a.x, cy: a.y, r: nucleo ? 22 : 11, class: 'cb-halo' }), el('circle', { cx: a.x, cy: a.y, r: nucleo ? 14 : 7, class: 'cb-corpo' }));
      if (o.rotulos) {
        const acima = a.y < 150 && !nucleo;
        const t = el('text', { x: a.x, y: nucleo ? a.y + 34 : a.y + (acima ? -15 : 22), class: 'cb-rotulo' + (nucleo ? ' cb-rotulo-nucleo' : '') });
        t.textContent = a.rotulo;
        g.appendChild(t);
      }
      const clicar = () => { if (o.onClick) o.onClick(a); };
      g.addEventListener('click', clicar);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clicar(); } });
      gAbas.appendChild(g);
      nos[a.id] = g;
    });

    return {
      // status: { site, crm, sistema_os } → acende/apaga as abas de cada sistema
      status(s) {
        const on = { site: !!(s && s.site), crm: !!(s && s.crm), os: !!(s && s.sistema_os) };
        ABAS.forEach((a) => {
          nos[a.id].classList.toggle('off', !on[a.sistema]);
          conexoes[a.id].classList.toggle('off', !on[a.sistema]);
          nos[a.id].setAttribute('aria-label', a.rotulo + (on[a.sistema] ? '' : ' (não conectado)') + ': ' + a.pedido);
        });
      },
      pensando(sim) { svg.classList.toggle('pensando', !!sim); },
      // acende por alguns segundos os neurônios das ferramentas que a IA usou
      acender(ferramentas) {
        const ids = new Set();
        (ferramentas || []).forEach((f) => (FERRAMENTA_ABA[f] || []).forEach((id) => ids.add(id)));
        ids.forEach((id) => {
          if (nos[id].classList.contains('off')) return; // sistema não conectado não acende
          [nos[id], conexoes[id]].filter(Boolean).forEach((n) => { n.classList.remove('usado'); void n.getBBox; n.classList.add('usado'); setTimeout(() => n.classList.remove('usado'), 4500); });
        });
      }
    };
  }

  window.RBCerebro = { criar };
})();
