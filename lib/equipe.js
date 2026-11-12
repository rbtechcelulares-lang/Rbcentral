// Equipe da loja, para a IA preparar mensagens de WhatsApp ("manda pro Nizael…").
// Os números ficam na variável CENTRAL_EQUIPE da Vercel, e não no código, porque o repositório é público.
// Formato: Nome:número com DDD (várias pessoas separadas por vírgula). Ex.: Nizael:5548999999999
function equipe() {
  return String(process.env.CENTRAL_EQUIPE || '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.+?)\s*[:=]\s*([+\d\s().-]{8,})$/);
    if (!m) return null;
    const numero = normalizar(m[2]);
    return numero ? { nome: m[1].trim(), numero } : null;
  }).filter(Boolean);
}

function normalizar(n) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^\d{12,13}$/.test(d) ? d : '';
}

// letras diferentes entre duas palavras (para nomes ditos por voz com uma letra trocada)
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const simples = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const nomes = () => equipe().map((p) => p.nome).join(', ');

// "Nizael", "nizael", "o funcionário" ou um número com DDD → { nome, numero }
function achar(para) {
  const eq = equipe();
  const digitos = String(para || '').replace(/\D/g, '');
  if (digitos.length >= 10) {
    const numero = normalizar(digitos);
    if (!numero) throw new Error('Número inválido: use DDD + número.');
    const conhecido = eq.find((p) => p.numero === numero);
    return conhecido || { nome: '+' + numero, numero };
  }
  if (!eq.length) throw new Error('Ninguém da equipe cadastrado. Falta a variável CENTRAL_EQUIPE na Vercel (ex.: Nizael:5548999999999).');
  const p = simples(para).replace(/^(o|a|pro|pra|para)\s+/, '');
  if (!p || /^(funcionari|equipe|tecnic|colaborador)/.test(p)) {
    if (eq.length === 1) return eq[0];
    throw new Error('Para qual pessoa da equipe? ' + nomes());
  }
  const primeiro = (x) => simples(x).split(/\s+/)[0];
  const achado = eq.find((x) => simples(x.nome) === p) ||
    eq.find((x) => primeiro(x.nome) === p.split(/\s+/)[0]) ||
    eq.find((x) => p.includes(simples(x.nome)) || simples(x.nome).includes(p)) ||
    eq.find((x) => primeiro(x.nome).length >= 4 && distancia(primeiro(x.nome), p.split(/\s+/)[0]) <= 1); // ex.: "Nisael" (voz) → Nizael
  if (!achado) throw new Error('Não achei "' + para + '" na equipe. Equipe: ' + nomes() + '.');
  return achado;
}

const link = (numero, mensagem) => 'https://wa.me/' + numero + '?text=' + encodeURIComponent(mensagem);

module.exports = { equipe, achar, link, nomes };
