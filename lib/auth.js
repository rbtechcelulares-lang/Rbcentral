// Login do dono e assinatura de ações pendentes (sem banco de dados).
// Variáveis na Vercel: CENTRAL_SENHA (senha de acesso) e CENTRAL_SEGREDO (texto longo e aleatório).
const crypto = require('crypto');

// .trim(): ignora espaço ou quebra de linha que às vezes entra ao colar o valor na Vercel
const senhaEnv = () => String(process.env.CENTRAL_SENHA || '').trim();
const segredo = () => String(process.env.CENTRAL_SEGREDO || '').trim();
const configurado = () => senhaEnv().length >= 8 && segredo().length >= 32;

// O que falta, sem revelar nenhum valor (aparece na tela de login)
function problemas() {
  const p = [];
  if (!process.env.CENTRAL_SENHA) p.push('CENTRAL_SENHA não foi encontrada neste projeto');
  else if (senhaEnv().length < 8) p.push('CENTRAL_SENHA tem menos de 8 caracteres');
  if (!process.env.CENTRAL_SEGREDO) p.push('CENTRAL_SEGREDO não foi encontrado neste projeto');
  else if (segredo().length < 32) p.push('CENTRAL_SEGREDO tem menos de 32 caracteres');
  return p;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const de64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const assinar = (dados) => crypto.createHmac('sha256', segredo()).update(dados).digest('base64url');
const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// pacote assinado: base64(json).assinatura — usado no login e nas ações que esperam confirmação
function selar(obj, minutos) {
  const corpo = b64(JSON.stringify(Object.assign({}, obj, { exp: Date.now() + minutos * 60e3 })));
  return corpo + '.' + assinar(corpo);
}
function abrir(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig || !igual(sig, assinar(corpo))) return null;
  try {
    const obj = JSON.parse(de64(corpo));
    return obj.exp > Date.now() ? obj : null;
  } catch (e) { return null; }
}

const senhaConfere = (senha) => configurado() && igual(String(senha).trim(), senhaEnv());
const criarSessao = () => selar({ tipo: 'sessao' }, 12 * 60);
function sessaoValida(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = abrir(t);
  return !!(s && s.tipo === 'sessao');
}

module.exports = { configurado, problemas, selar, abrir, senhaConfere, criarSessao, sessaoValida };
