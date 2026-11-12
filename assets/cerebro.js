// Cérebro do RB Central em 3D: uma rede de neurônios amarelos no fundo preto, que ocupa a tela toda, gira sozinha
// no sentido anti-horário (visto de cima) e dá para girar arrastando com o mouse ou o dedo.
// Os neurônios grandes são os sistemas e os mini neurônios em volta são as funções de cada um: acendem quando a
// IA usa aquela função e, tocados, fazem a pergunta.
// Com conversa na tela, ele fica escurecido no fundo para não atrapalhar a leitura.
(() => {
  // posição de cada sistema no cérebro (x = lado, y = altura, z = frente)
  const NUCLEO = { id: 'nucleo', p: [0, 0.14, 0.05], rotulo: 'RB Central', pedido: 'Relatório do dia' };
  // sub: [id, nome curto, pergunta que vai para a IA ao tocar, ferramentas da IA que acendem esse mini neurônio]
  const ABAS = [
    { id: 'aparelhos', p: [-0.42, 0.42, 0.66], rotulo: 'Aparelhos', sistema: 'site', pedido: 'Lista os aparelhos do site com preço', subs: [
      ['ap-lista', 'Disponíveis', 'Quais aparelhos estão disponíveis no site?', ['site_listar_aparelhos']],
      ['ap-preco', 'Preço', 'Quero mudar o preço de um aparelho do site', ['site_alterar_preco']],
      ['ap-novo', 'Cadastrar', 'Quero cadastrar um aparelho novo no site', ['site_aparelho_adicionar']],
      ['ap-editar', 'Cor e bateria', 'Quero mudar a cor, a bateria ou a condição de um aparelho do site', ['site_aparelho_editar']],
      ['ap-tirar', 'Tirar do site', 'Quero tirar do site um aparelho que vendeu', ['site_aparelho_remover']]] },
    { id: 'vitrine', p: [0.5, 0.12, 0.8], rotulo: 'Vitrine', sistema: 'site', pedido: 'Quais aparelhos estão na vitrine?', subs: [
      ['vi-promo', 'Promoção', 'Quais aparelhos estão na vitrine de promoção?', ['site_vitrine']],
      ['vi-topo', 'Topo', 'Quais aparelhos estão no topo do site?', []],
      ['vi-catalogo', 'Catálogo', 'Quais aparelhos estão no catálogo do site?', []],
      ['vi-fora', 'Fora do site', 'Quais aparelhos estão fora do site?', []]] },
    { id: 'clientes', p: [0.12, 0.7, 0.18], rotulo: 'Clientes', sistema: 'crm', pedido: 'Clientes novos do CRM', subs: [
      ['cl-site', 'CRM do site', 'Clientes novos do CRM do site', ['site_clientes_crm']],
      ['cl-espera', 'Esperando', 'Quem está esperando resposta no WhatsApp?', ['whatsapp_crm']],
      ['cl-negocia', 'Negociando', 'Como estão as negociações no WhatsApp?', []],
      ['cl-conversa', 'Conversas', 'Me mostra a última conversa de WhatsApp de um cliente', ['whatsapp_conversa']]] },
    { id: 'cliques', p: [0.86, -0.14, 0.28], rotulo: 'Cliques', sistema: 'crm', pedido: 'Como foram os cliques e propostas do site hoje?', subs: [
      ['cq-visitas', 'Visitas', 'Quantas visitas o site teve hoje?', []],
      ['cq-propostas', 'Propostas', 'Quantas propostas foram enviadas pelo site hoje?', []],
      ['cq-vistos', 'Mais vistos', 'Quais aparelhos foram mais vistos no site hoje?', []]] },
    { id: 'os', p: [-0.66, 0.46, -0.32], rotulo: 'OS', sistema: 'os', pedido: 'OS abertas', subs: [
      ['os-abertas', 'Abertas', 'OS abertas', ['os_listar']],
      ['os-nova', 'Nova OS', 'Quero abrir uma OS', ['os_criar']],
      ['os-status', 'Status', 'Quero mudar o status de uma OS', ['os_mudar_status', 'os_configuracao']],
      ['os-editar', 'Editar', 'Quero corrigir os dados de uma OS', ['os_editar']],
      ['os-link', 'Link', 'Me passa o link de acompanhamento de uma OS', ['os_ver']]] },
    { id: 'pagamentos', p: [0.48, 0.3, -0.82], rotulo: 'Pagamentos', sistema: 'os', pedido: 'Quais OS estão prontas e ainda não foram pagas?', subs: [
      ['pg-receber', 'Receber', 'Quero registrar o pagamento de uma OS', ['os_marcar_pago']],
      ['pg-pendentes', 'Sem pagar', 'Quais OS estão prontas e ainda não foram pagas?', []],
      ['pg-formas', 'Formas', 'Quais formas de pagamento o sistema aceita?', []]] },
    { id: 'avisos', p: [-0.86, -0.06, 0.1], rotulo: 'Avisos', sistema: 'os', pedido: 'Quais clientes de OS precisam ser avisados hoje?', subs: [
      ['av-pronto', 'Pronto', 'Quero avisar o cliente de uma OS que já está pronta', ['os_aviso_pronto']],
      ['av-cliente', 'Avisar', 'Quais clientes de OS precisam ser avisados hoje?', ['os_avisar_cliente']],
      ['av-equipe', 'Equipe', 'Quero mandar uma mensagem para o Nizael', []]] },
    { id: 'metas', p: [0.34, -0.5, -0.66], rotulo: 'Metas', sistema: 'os', pedido: 'Como estão as metas?', subs: [
      ['me-mes', 'Do mês', 'Como estão as metas?', ['metas_listar']],
      ['me-alterar', 'Alterar', 'Quero mudar o valor de uma meta', ['meta_alterar']],
      ['me-dia', 'Relatório', 'Relatório do dia', ['relatorio_do_dia']]] },
    { id: 'pecas', p: [0, -0.98, -0.34], rotulo: 'Peças', sistema: 'os', pedido: 'Pedidos de peças aos fornecedores', subs: [
      ['pc-pedidos', 'Pedidos', 'Pedidos de peças aos fornecedores', ['pecas_listar_pedidos']],
      ['pc-atraso', 'Atrasadas', 'Quais pedidos de peças estão atrasados?', []]] },
    { id: 'whatsapp', p: [0.7, 0.5, -0.2], rotulo: 'WhatsApp', sistema: 'zap', pedido: 'Quem está esperando resposta no WhatsApp?', subs: [
      ['wa-enviar', 'Enviar', 'Quero mandar uma mensagem de WhatsApp para um cliente', ['whatsapp_enviar']],
      ['wa-follow', 'Follow-up', 'Quem eu preciso cobrar no WhatsApp?', []],
      ['wa-buscar', 'Não buscou', 'Quem fechou e não buscou o aparelho?', []],
      ['wa-perdas', 'Perdas', 'Por que os clientes não fecharam este mês?', ['relatorio_perdas']]] },
    { id: 'vendas', p: [-0.4, -0.2, -0.82], rotulo: 'Vendas', sistema: 'os', pedido: 'Quais celulares tenho no estoque?', subs: [
      ['ve-vender', 'Vender', 'Quero registrar uma venda', ['venda_registrar']],
      ['ve-estoque', 'Estoque', 'Quais celulares tenho no estoque?', ['estoque_aparelhos']],
      ['ve-acess', 'Acessórios', 'Quais acessórios tenho em estoque?', ['produtos_listar']],
      ['ve-troca', 'Troca', 'Quero cadastrar no estoque um aparelho que entrou na troca', ['aparelho_cadastrar']]] }
  ];
  // ferramenta da IA → neurônios que acendem (o mini neurônio e o sistema dele)
  const FERRAMENTA_ABA = { relatorio_do_dia: ['nucleo', 'cliques', 'cq-visitas', 'cq-propostas', 'cq-vistos'] };
  ABAS.forEach((a) => a.subs.forEach(([id, , , fs]) => fs.forEach((f) => { (FERRAMENTA_ABA[f] = FERRAMENTA_ABA[f] || []).push(id, a.id); })));
  // mini neurônios em volta do sistema, na superfície do cérebro
  const MINIS = [];
  ABAS.forEach((a) => {
    const centro = a.p[1] < -0.6 ? [0, -0.5, -0.45] : [Math.sign(a.p[0] || 1) * 0.37, 0.1, 0];
    let n = a.p.map((v, k) => v - centro[k]); const ln = Math.hypot(...n) || 1; n = n.map((v) => v / ln);
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cruz = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const u = norm(cruz(n, ref)), w = cruz(n, u);
    a.subs.forEach(([id, rotulo, pedido], k) => {
      const ang = (k / a.subs.length) * Math.PI * 2 + 0.4, r = 0.17 + (k % 2) * 0.05;
      const p = a.p.map((v, j) => v + (u[j] * Math.cos(ang) + w[j] * Math.sin(ang)) * r + n[j] * 0.03);
      MINIS.push({ id, rotulo, pedido, pai: a, p });
    });
  });
  // cores da Central: amarelo-ouro no preto (AMARELO = linhas, CLARO = rede de dentro, OURO = sistemas)
  const AMARELO = [245, 197, 66], CLARO = [255, 232, 160], OURO = [255, 214, 102];

  // números "aleatórios" sempre iguais: o cérebro tem sempre o mesmo formato
  let semente = 11;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };
  const direcao = () => {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(a), u, r * Math.sin(a)];
  };
  // dobras do córtex: o raio sobe e desce um pouco conforme a direção
  const dobras = (d) => 1 + 0.05 * Math.sin(9 * d[0] + 4 * d[1]) * Math.cos(7 * d[2] + 3 * d[1]) + 0.035 * Math.sin(13 * d[1] + 5 * d[2] + 2 * d[0]);

  // nuvem de pontos com o formato de um cérebro visto de lado (frente à esquerda quando gira)
  function montarCerebro(n) {
    semente = 11;
    const pts = [], tipo = [], normais = []; // tipo 0 = superfície, 1 = interior, 2 = cerebelo/tronco
    const hemis = Math.round(n * 0.72), cereb = Math.round(n * 0.12), tronco = Math.round(n * 0.05);
    for (let i = 0; i < hemis; i++) {
      const lado = i % 2 ? 1 : -1;
      const d = direcao();
      if (d[0] * lado < -0.35 && rnd() > 0.25) { i--; continue; } // a parede do meio tem menos pontos
      const m = dobras(d);
      let x = lado * 0.37 + d[0] * 0.47 * m, y = 0.1 + d[1] * 0.62 * m, z = d[2] * 0.98 * m;
      if (y < 0) y *= 0.74; // base mais achatada
      if (y < -0.08 && z > -0.3) x += lado * 0.05; // lobo temporal
      pts.push([x, y, z]); tipo.push(0); normais.push(d);
    }
    for (let i = 0; i < cereb; i++) {
      const d = direcao();
      if (d[2] > 0.55) { i--; continue; }
      const m = 1 + 0.06 * Math.sin(30 * d[1]);
      pts.push([d[0] * 0.6 * m, -0.44 + d[1] * 0.25 * m, -0.6 + d[2] * 0.33 * m]); tipo.push(2); normais.push(d);
    }
    for (let i = 0; i < tronco; i++) {
      const t = rnd(), a = rnd() * Math.PI * 2;
      pts.push([Math.cos(a) * 0.11, -0.42 - t * 0.6, -0.26 - t * 0.1 + Math.sin(a) * 0.11]); tipo.push(2); normais.push([Math.cos(a), 0, Math.sin(a)]);
    }
    while (pts.length < n) { // interior: a rede de dentro, em ciano
      const lado = rnd() > 0.5 ? 1 : -1, d = direcao(), k = 0.25 + rnd() * 0.6;
      pts.push([lado * 0.37 + d[0] * 0.45 * k, 0.1 + d[1] * 0.55 * k * (d[1] < 0 ? 0.74 : 1), d[2] * 0.95 * k]); tipo.push(1); normais.push([0, 0, 1]);
    }
    // malha: cada ponto liga nos 2 vizinhos mais próximos (as linhas laranja do cérebro)
    const arestas = [], vistas = new Set(), limite = 40 / n;
    for (let i = 0; i < pts.length; i++) {
      let a = -1, b = -1, da = 1e9, db = 1e9;
      for (let j = 0; j < pts.length; j++) {
        if (j === i) continue;
        const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], dz = pts[i][2] - pts[j][2];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < da) { b = a; db = da; a = j; da = dd; } else if (dd < db) { b = j; db = dd; }
      }
      [[a, da], [b, db]].forEach(([j, dd]) => {
        if (j < 0 || dd > limite) return;
        const chave = i < j ? i + ':' + j : j + ':' + i;
        if (!vistas.has(chave)) { vistas.add(chave); arestas.push(i, j); }
      });
    }
    return { pts, tipo, normais, arestas };
  }

  // brilho redondo pré-desenhado (bem mais leve que shadowBlur)
  function sprite(cor, tam) {
    const c = document.createElement('canvas');
    c.width = c.height = tam;
    const g = c.getContext('2d'), r = tam / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(' + cor + ',.95)');
    gr.addColorStop(0.45, 'rgba(' + cor + ',.28)');
    gr.addColorStop(1, 'rgba(' + cor + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, tam, tam);
    return c;
  }
  function bokeh(cor, tam) {
    const c = document.createElement('canvas');
    c.width = c.height = tam;
    const g = c.getContext('2d'), r = tam / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(' + cor + ',.55)');
    gr.addColorStop(0.6, 'rgba(' + cor + ',.38)');
    gr.addColorStop(1, 'rgba(' + cor + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, tam, tam);
    return c;
  }

  function criar(canvas, opcoes) {
    const o = Object.assign({ onClick: null, area: null }, opcoes);
    const ctx = canvas.getContext('2d');
    const parado = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const celular = Math.min(innerWidth, innerHeight) < 600;
    const modelo = montarCerebro(celular ? 1700 : 2600);
    const N = modelo.pts.length;
    const proj = new Float32Array(N * 3); // x, y na tela e profundidade
    const luzPt = new Float32Array(N); // brilho de cada ponto: frente + contorno (borda do cérebro mais acesa)
    const brilhos = Array.from({ length: celular ? 60 : 100 }, () => ({ i: Math.floor(rnd() * N), fase: rnd() * 6.28, vel: 0.6 + rnd() * 1.6, ciano: rnd() < 0.35 }));
    const sLaranja = sprite(AMARELO.join(','), 64), sCiano = sprite(CLARO.join(','), 64), sOuro = sprite(OURO.join(','), 96);
    const sApagado = sprite('120,110,90', 64);
    const bLaranja = bokeh('245,197,66', 128), bCiano = bokeh('170,120,30', 128);
    // fundo: bolhas desfocadas e uma rede fina de pontos, como no espaço em volta do cérebro
    const bolhas = Array.from({ length: celular ? 26 : 44 }, () => ({ x: rnd(), y: rnd(), r: 0.01 + rnd() * 0.05, a: 0.12 + rnd() * 0.4, ciano: rnd() < 0.7, vx: (rnd() - 0.5) * 0.004, vy: (rnd() - 0.5) * 0.004, z: 0.3 + rnd() * 0.7 }));
    const poeira = Array.from({ length: celular ? 70 : 130 }, () => ({ x: rnd(), y: rnd(), vx: (rnd() - 0.5) * 0.006, vy: (rnd() - 0.5) * 0.006, ciano: rnd() < 0.75 }));

    const est = {
      yaw: 0.6, pitch: 0.16, vel: 0, modo: 'foco', alvoAlfa: 1, alfa: 0, cx: 0, cy: 0, esc: 0,
      ligado: { site: false, crm: false, os: false }, usado: {}, pensando: false, ouvindo: false, falando: 0
    };
    let W = 0, H = 0, dpr = 1, ultimo = 0, quadro = 0, arrasto = null, rodando = true;

    function medir() {
      dpr = Math.min(window.devicePixelRatio || 1, celular ? 1.75 : 2);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    function alvoPosicao() {
      const a = (o.area && o.area()) || { top: 0, bottom: H };
      const top = Math.max(0, a.top || 0), bottom = Math.min(H, a.bottom || H), h = Math.max(120, bottom - top);
      return {
        cx: W / 2,
        cy: top + h * (est.modo === 'fundo' ? 0.5 : 0.46),
        esc: Math.min(W * (celular ? 0.38 : 0.3), h * 0.44)
      };
    }

    // gira (yaw em volta do eixo vertical, pitch inclinando) e projeta com perspectiva
    function projetar(p, cy, sy, cp, sp) {
      const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
      const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
      const s = 3.4 / (3.4 - z2);
      return [est.cx + x1 * s * est.esc, est.cy - y2 * s * est.esc, z2];
    }

    function desenhar(t) {
      const dt = Math.min(0.05, (t - (ultimo || t)) / 1000);
      ultimo = t;
      // velocidade: anti-horário visto de cima; mais rápido pensando; o empurrão do dedo vai perdendo força
      const base = parado ? 0 : (est.pensando ? 0.75 : est.modo === 'fundo' ? 0.12 : 0.22);
      if (!arrasto) {
        est.vel += (base - est.vel) * Math.min(1, dt * 1.6);
        est.yaw += est.vel * dt;
        est.pitch += (0.16 - est.pitch) * Math.min(1, dt * 0.6);
      }
      const alvo = alvoPosicao();
      const k = est.esc ? Math.min(1, dt * 4) : 1;
      est.cx += (alvo.cx - est.cx) * k; est.cy += (alvo.cy - est.cy) * k; est.esc += (alvo.esc - est.esc) * k;
      est.alfa += (est.alvoAlfa - est.alfa) * Math.min(1, dt * 3);
      est.falando = Math.max(0, est.falando - dt * 2.2);
      const luz = est.alfa * (est.ouvindo ? 1.45 : 1) * (1 + est.falando * 0.8);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      // fundo azul petróleo, mais claro atrás do cérebro
      const fundo = ctx.createRadialGradient(est.cx, est.cy, 0, est.cx, est.cy, Math.max(W, H) * 0.85);
      fundo.addColorStop(0, '#1b1506'); fundo.addColorStop(0.4, '#0b0a07'); fundo.addColorStop(1, '#000000');
      ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      // rede fina do fundo
      const mexe = parado ? 0 : dt;
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(245,197,66,0.06)';
      ctx.beginPath();
      for (let i = 0; i < poeira.length; i++) {
        const p = poeira[i];
        p.x = (p.x + p.vx * mexe + 1) % 1; p.y = (p.y + p.vy * mexe + 1) % 1;
        const x = p.x * W, y = p.y * H;
        for (let j = i + 1; j < poeira.length; j++) {
          const q = poeira[j], dx = x - q.x * W, dy = y - q.y * H;
          if (dx * dx + dy * dy < 9000) { ctx.moveTo(x, y); ctx.lineTo(q.x * W, q.y * H); }
        }
      }
      ctx.stroke();
      for (const p of poeira) {
        ctx.fillStyle = p.ciano ? 'rgba(245,197,66,.45)' : 'rgba(255,235,180,.5)';
        ctx.fillRect(p.x * W - 1, p.y * H - 1, 2, 2);
      }
      // bolhas desfocadas (andam um pouco com o giro, para dar profundidade)
      for (const b of bolhas) {
        b.x += b.vx * mexe; b.y += b.vy * mexe;
        if (b.x > 1.1) b.x -= 1.2; else if (b.x < -0.1) b.x += 1.2;
        if (b.y > 1.1) b.y -= 1.2; else if (b.y < -0.1) b.y += 1.2;
        const r = b.r * Math.max(W, H);
        const x = (b.x + Math.sin(est.yaw) * 0.02 * b.z) * W, y = b.y * H;
        ctx.globalAlpha = b.a * 0.55 * (est.modo === 'fundo' ? 0.6 : 1);
        ctx.drawImage(b.ciano ? bCiano : bLaranja, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      // halo atrás do cérebro
      const halo = ctx.createRadialGradient(est.cx, est.cy, 0, est.cx, est.cy, est.esc * 1.5);
      halo.addColorStop(0, 'rgba(245,197,66,' + (0.15 * luz) + ')');
      halo.addColorStop(0.55, 'rgba(217,165,20,' + (0.05 * luz) + ')');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo; ctx.fillRect(est.cx - est.esc * 1.6, est.cy - est.esc * 1.6, est.esc * 3.2, est.esc * 3.2);

      const cy = Math.cos(est.yaw), sy = Math.sin(est.yaw), cp = Math.cos(est.pitch), sp = Math.sin(est.pitch);
      for (let i = 0; i < N; i++) {
        const r = projetar(modelo.pts[i], cy, sy, cp, sp);
        proj[i * 3] = r[0]; proj[i * 3 + 1] = r[1]; proj[i * 3 + 2] = r[2];
        const n = modelo.normais[i];
        const nz = n[1] * sp + (-n[0] * sy + n[2] * cy) * cp; // normal virada para a tela?
        const borda = modelo.tipo[i] === 1 ? 0.3 : 1 - Math.abs(nz);
        luzPt[i] = (0.25 + (r[2] + 1) * 0.28) * (0.45 + borda * borda * 1.3);
      }
      // linhas em 5 faixas de brilho (a parte de trás apagada, a borda do cérebro acesa)
      const ar = modelo.arestas;
      for (let f = 0; f < 5; f++) {
        ctx.beginPath();
        for (let e = 0; e < ar.length; e += 2) {
          const l = (luzPt[ar[e]] + luzPt[ar[e + 1]]) / 2;
          if (Math.min(4, Math.floor(l * 4.2)) !== f) continue;
          const a = ar[e] * 3, b = ar[e + 1] * 3;
          ctx.moveTo(proj[a], proj[a + 1]); ctx.lineTo(proj[b], proj[b + 1]);
        }
        ctx.lineWidth = celular ? 0.6 : 0.75;
        ctx.strokeStyle = 'rgba(' + AMARELO.join(',') + ',' + Math.min(1, (0.06 + f * 0.17) * luz) + ')';
        ctx.stroke();
      }
      // neurônios pequenos (laranja na casca, ciano por dentro), em 3 faixas de brilho
      for (let f = 0; f < 6; f++) {
        const ciano = f >= 3, faixa = f % 3;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if ((modelo.tipo[i] === 1) !== ciano || Math.min(2, Math.floor(luzPt[i] * 3)) !== faixa) continue;
          const r = (0.5 + (proj[i * 3 + 2] + 1) * 0.45) * (celular ? 0.85 : 1);
          ctx.moveTo(proj[i * 3] + r, proj[i * 3 + 1]);
          ctx.arc(proj[i * 3], proj[i * 3 + 1], r, 0, 6.283);
        }
        const a = (0.22 + faixa * 0.3) * luz;
        ctx.fillStyle = ciano ? 'rgba(' + CLARO.join(',') + ',' + a * 0.8 + ')' : 'rgba(255,220,120,' + a + ')';
        ctx.fill();
      }
      // faíscas piscando
      const seg = t / 1000;
      for (const b of brilhos) {
        const i = b.i * 3, z = proj[i + 2];
        const pisca = Math.max(0, Math.sin(seg * b.vel + b.fase)) ** 3;
        const tam = (8 + pisca * 18) * (0.6 + (z + 1) * 0.3);
        ctx.globalAlpha = Math.min(1, (0.25 + pisca * 0.75) * luz * (0.45 + (z + 1) * 0.3));
        ctx.drawImage(b.ciano ? sCiano : sLaranja, proj[i] - tam / 2, proj[i + 1] - tam / 2, tam, tam);
      }
      ctx.globalAlpha = 1;

      // núcleo e sistemas
      const nucleo = projetar(NUCLEO.p, cy, sy, cp, sp);
      const pulsoNucleo = est.pensando ? 0.5 + 0.5 * Math.sin(seg * 7) : 0.5 + 0.2 * Math.sin(seg * 2);
      const comRotulo = est.modo === 'foco';
      ABAS.forEach((a, i) => {
        const q = projetar(a.p, cy, sy, cp, sp);
        a._x = q[0]; a._y = q[1]; a._z = q[2];
        const on = est.ligado[a.sistema], usado = (est.usado[a.id] || 0) > t;
        const frente = 0.45 + (q[2] + 1) * 0.3;
        // fio do núcleo até o sistema, com um pulso correndo quando conectado
        ctx.strokeStyle = 'rgba(' + OURO.join(',') + ',' + ((on ? (usado ? 0.9 : 0.32) : 0.08) * luz * frente) + ')';
        ctx.lineWidth = usado ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(nucleo[0], nucleo[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        if (on && !parado) {
          const fr = (seg * (est.pensando ? 0.9 : 0.35) + i * 0.37) % 1;
          const px = nucleo[0] + (q[0] - nucleo[0]) * fr, py = nucleo[1] + (q[1] - nucleo[1]) * fr;
          ctx.globalAlpha = 0.8 * luz * frente;
          ctx.drawImage(sOuro, px - 7, py - 7, 14, 14);
          ctx.globalAlpha = 1;
        }
        const tam = (on ? (usado ? 46 + 10 * Math.sin(seg * 8) : 30) : 16) * (0.7 + (q[2] + 1) * 0.25);
        ctx.globalAlpha = (on ? 0.95 : 0.35) * luz * frente;
        ctx.drawImage(on ? sOuro : sApagado, q[0] - tam / 2, q[1] - tam / 2, tam, tam);
        ctx.globalAlpha = 1;
      });
      // mini neurônios (subfunções) ligados ao sistema deles
      MINIS.forEach((m, i) => {
        const q = projetar(m.p, cy, sy, cp, sp);
        m._x = q[0]; m._y = q[1]; m._z = q[2];
        const pai = m.pai, on = est.ligado[pai.sistema], usado = (est.usado[m.id] || 0) > t;
        const frente = 0.4 + (q[2] + 1) * 0.3;
        ctx.strokeStyle = 'rgba(' + OURO.join(',') + ',' + ((on ? (usado ? 0.95 : 0.3) : 0.07) * luz * frente) + ')';
        ctx.lineWidth = usado ? 1.6 : 0.8;
        ctx.beginPath(); ctx.moveTo(pai._x, pai._y); ctx.lineTo(q[0], q[1]); ctx.stroke();
        const pisca = 0.75 + 0.25 * Math.sin(seg * 2.2 + i);
        const tam = (on ? (usado ? 30 + 6 * Math.sin(seg * 9) : 15 * pisca) : 9) * (0.7 + (q[2] + 1) * 0.25);
        ctx.globalAlpha = (on ? 0.9 : 0.3) * luz * frente;
        ctx.drawImage(on ? sOuro : sApagado, q[0] - tam / 2, q[1] - tam / 2, tam, tam);
        ctx.globalAlpha = 1;
      });
      const tn = (56 + pulsoNucleo * 30 + est.falando * 40) * (est.ouvindo ? 1.3 : 1);
      ctx.globalAlpha = Math.min(1, 0.95 * luz);
      ctx.drawImage(sOuro, nucleo[0] - tn / 2, nucleo[1] - tn / 2, tn, tn);
      ctx.globalAlpha = 1;

      // nomes dos sistemas (só com o cérebro em destaque, e só os que estão do lado da frente)
      ctx.globalCompositeOperation = 'source-over';
      if (comRotulo && est.alfa > 0.5) {
        ctx.font = '700 ' + (celular ? 11.5 : 12.5) + 'px Manrope, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.lineJoin = 'round';
        // primeiro os sistemas (nome em negrito), depois as subfunções (nome pequeno, para fora do sistema);
        // um nome que encostaria em outro não aparece agora (aparece quando o cérebro gira)
        const ocupado = [];
        const cabe = (x, y, w, h) => !ocupado.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
        const escrever = (txt, x, y, cor, alfa, tam) => {
          const w = ctx.measureText(txt).width + 4, h = tam + 2;
          if (!cabe(x - w / 2, y - h + 2, w, h)) return false;
          ocupado.push([x - w / 2, y - h + 2, w, h]);
          ctx.globalAlpha = alfa;
          ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(txt, x, y);
          ctx.fillStyle = cor; ctx.fillText(txt, x, y);
          return true;
        };
        const tamSistema = celular ? 11.5 : 12.5, tamSub = celular ? 9.5 : 10.5;
        ctx.font = '700 ' + tamSistema + 'px Manrope, system-ui, sans-serif';
        ctx.lineWidth = 3;
        [Object.assign(NUCLEO, { _x: nucleo[0], _y: nucleo[1], _z: nucleo[2] })].concat(ABAS.slice().sort((a, b) => b._z - a._z)).forEach((a) => {
          if (a._z < -0.25) return;
          const on = a === NUCLEO || est.ligado[a.sistema];
          escrever(a.rotulo, a._x, a._y + (a === NUCLEO ? 30 : -14), a === NUCLEO ? '#f5c542' : on ? '#f4efe6' : '#8a8172',
            Math.min(1, (a._z + 0.25) * 1.6) * est.alfa * (on ? 1 : 0.55), tamSistema);
        });
        ctx.font = '600 ' + tamSub + 'px Manrope, system-ui, sans-serif';
        ctx.lineWidth = 2.5;
        MINIS.slice().sort((a, b) => b._z - a._z).forEach((m) => {
          if (m._z < 0.05) return;
          const on = est.ligado[m.pai.sistema];
          let dx = m._x - m.pai._x, dy = m._y - m.pai._y;
          const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
          escrever(m.rotulo, m._x + dx * 14, m._y + dy * 12 + 4, (est.usado[m.id] || 0) > t ? '#ffe9a8' : on ? '#d9cfbd' : '#7d7466',
            Math.min(1, (m._z - 0.05) * 2.2) * est.alfa * (on ? 0.85 : 0.45), tamSub);
        });
        ctx.globalAlpha = 1;
      }
    }

    function laco(t) {
      if (!rodando) return;
      requestAnimationFrame(laco);
      quadro++;
      if (est.modo === 'fundo' && !arrasto && quadro % 2) return; // no fundo, 30 quadros por segundo bastam
      desenhar(t);
    }

    // ---------- girar com o mouse ou o dedo; toque rápido num sistema faz a pergunta ----------
    const sistemaPerto = (x, y) => {
      if (est.modo !== 'foco') return null;
      let melhor = null, dm = Infinity;
      ABAS.concat([NUCLEO], MINIS).forEach((a) => {
        if (a._x === undefined || a._z < -0.35) return;
        const raio = MINIS.includes(a) ? (celular ? 20 : 15) : (celular ? 30 : 24);
        const d = (a._x - x) ** 2 + (a._y - y) ** 2;
        if (d < raio * raio && d < dm) { dm = d; melhor = a; }
      });
      return melhor;
    };
    canvas.addEventListener('pointerdown', (e) => {
      arrasto = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), mov: 0 };
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignora */ }
      canvas.classList.add('arrastando');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!arrasto || arrasto.id !== e.pointerId) {
        canvas.style.cursor = sistemaPerto(e.clientX, e.clientY) ? 'pointer' : '';
        return;
      }
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      arrasto.x = e.clientX; arrasto.y = e.clientY;
      arrasto.mov += Math.abs(dx) + Math.abs(dy);
      const gira = 0.009;
      est.yaw += dx * gira;
      est.pitch = Math.max(-0.9, Math.min(0.9, est.pitch + dy * gira * 0.7));
      est.vel = dx * gira * 60; // o empurrão continua um pouco depois de soltar
    });
    const soltar = (e) => {
      if (!arrasto || arrasto.id !== e.pointerId) return;
      const toque = arrasto.mov < 8 && performance.now() - arrasto.t < 500;
      const x = e.clientX, y = e.clientY;
      arrasto = null;
      canvas.classList.remove('arrastando');
      est.vel = Math.max(-6, Math.min(6, est.vel));
      if (toque) {
        const a = sistemaPerto(x, y);
        if (a && o.onClick) o.onClick(a);
      }
    };
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);

    medir();
    addEventListener('resize', medir);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) rodando = false;
      else if (!rodando) { rodando = true; ultimo = 0; requestAnimationFrame(laco); }
    });
    requestAnimationFrame(laco);

    return {
      // 'foco' = cérebro em destaque (sem conversa), 'fundo' = escurecido atrás da conversa, 'login' = tela de entrada
      modo(m) {
        est.modo = m === 'fundo' || m === 'login' ? m : 'foco';
        est.alvoAlfa = est.modo === 'fundo' ? 0.35 : est.modo === 'login' ? 0.85 : 1;
      },
      // status: { site, crm, sistema_os } → acende/apaga os sistemas
      status(s) { est.ligado = { site: !!(s && s.site), crm: !!(s && s.crm), os: !!(s && s.sistema_os), zap: !!(s && (s.whatsapp || s.crm_whatsapp)) }; },
      pensando(sim) { est.pensando = !!sim; },
      // microfone ligado: o cérebro inteiro acende mais forte
      ouvindo(sim) { est.ouvindo = !!sim; },
      // a cada trecho de voz reconhecido o brilho dá um pulso
      falando() { est.falando = 1; },
      // acende por alguns segundos os sistemas das ferramentas que a IA usou
      acender(ferramentas) {
        const ate = performance.now() + 4500;
        (ferramentas || []).forEach((f) => (FERRAMENTA_ABA[f] || []).forEach((id) => { est.usado[id] = ate; }));
        est.falando = Math.max(est.falando, 0.6);
      }
    };
  }

  window.RBCerebro = { criar };
})();
