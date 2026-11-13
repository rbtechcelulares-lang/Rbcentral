// Equipe da loja, para a IA preparar mensagens de WhatsApp ("manda pro Nizael…").
// Os números ficam em variáveis da Vercel, e não no código, porque o repositório é público.
// CENTRAL_EQUIPE: Nome:número com DDD (várias pessoas separadas por vírgula). Ex.: Nizael:5548999999999
// CENTRAL_PESSOAL: contatos pessoais do dono (família), no mesmo formato, com o parentesco entre parênteses.
//   Ex.: Fulana (esposa):5548999999999. A IA manda mensagem pessoal para eles quando o dono pede,
//   e as conversas com eles (como as da equipe) não entram no CRM.
function lerLista(variavel, pessoal) {
  return String(process.env[variavel] || '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.+?)\s*[:=]\s*([+\d\s().-]{8,})$/);
    if (!m) return null;
    const numero = normalizar(m[2]);
    if (!numero) return null;
    const r = m[1].trim().match(/^(.*?)\s*\(([^)]+)\)$/); // "Pamella (esposa)" → nome + parentesco
    return { nome: (r ? r[1] : m[1]).trim(), relacao: r ? r[2].trim() : '', numero, pessoal };
  }).filter(Boolean);
}
function equipe() {
  const todos = lerLista('CENTRAL_EQUIPE', false).concat(lerLista('CENTRAL_PESSOAL', true));
  return todos.filter((p, i) => todos.findIndex((x) => x.numero === p.numero) === i);
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
const rotulo = (p) => p.nome + (p.relacao ? ' (' + p.relacao + ')' : '');
// tipo: 'equipe' (só funcionários), 'pessoal' (só família) ou nada (todos)
const nomes = (tipo) => equipe().filter((p) => !tipo || (tipo === 'pessoal' ? p.pessoal : !p.pessoal)).map(rotulo).join(', ');

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
  if (!eq.length) throw new Error('Ninguém cadastrado. Falta a variável CENTRAL_EQUIPE (equipe) ou CENTRAL_PESSOAL (família) na Vercel.');
  const p = simples(para).replace(/^(o|a|pro|pra|para)\s+/, '').replace(/^(minha|meu)\s+/, '');
  if (!p || /^(funcionari|equipe|tecnic|colaborador)/.test(p)) {
    const func = eq.filter((x) => !x.pessoal);
    if (func.length === 1) return func[0];
    if (!func.length) throw new Error('Ninguém da equipe cadastrado. Falta a variável CENTRAL_EQUIPE na Vercel (ex.: Nizael:5548999999999).');
    throw new Error('Para qual pessoa da equipe? ' + nomes('equipe'));
  }
  const primeiro = (x) => simples(x).split(/\s+/)[0];
  const achado = eq.find((x) => simples(x.nome) === p) ||
    eq.find((x) => x.relacao && simples(x.relacao) === p) || // "minha esposa" → quem tem (esposa)
    eq.find((x) => primeiro(x.nome) === p.split(/\s+/)[0]) ||
    eq.find((x) => p.includes(simples(x.nome)) || simples(x.nome).includes(p)) ||
    eq.find((x) => primeiro(x.nome).length >= 4 && distancia(primeiro(x.nome), p.split(/\s+/)[0]) <= 1); // ex.: "Nisael" (voz) → Nizael
  if (!achado) throw new Error('Não achei "' + para + '" nos contatos. Cadastrados: ' + nomes() + '. Contato pessoal novo vai na variável CENTRAL_PESSOAL da Vercel.');
  return achado;
}

// "5548991234567" → "+55 48 99123-4567" (para o dono conferir o número no cartão)
function formatar(n) {
  const d = String(n || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? '+55 ' + m[1] + ' ' + m[2] + '-' + m[3] : '+' + d;
}

// destino de uma mensagem: um número (cliente) ou alguém da equipe/família → { nome, numero, equipe, pessoal, relacao }
function destino(para, nome) {
  const digitos = String(para || '').replace(/\D/g, '');
  if (digitos.length >= 10) {
    const numero = normalizar(digitos);
    if (!numero) throw new Error('Número inválido: use DDD + número.');
    const daEquipe = equipe().find((p) => p.numero === numero);
    if (daEquipe) return Object.assign({ equipe: true }, daEquipe);
    return { nome: String(nome || '').trim().slice(0, 60) || formatar(numero), numero, equipe: false };
  }
  return Object.assign({ equipe: true }, achar(para));
}

const link = (numero, mensagem) => 'https://wa.me/' + numero + '?text=' + encodeURIComponent(mensagem);

module.exports = { equipe, achar, destino, formatar, normalizar, link, nomes, rotulo };
