// Login do dono e assinatura de ações pendentes (sem banco de dados).
// Senha: a MESMA do admin do site (conferida no catálogo publicado, via RB_GITHUB_TOKEN).
//   Opcional: CENTRAL_SENHA na Vercel para usar uma senha só do Central.
// Segredo das assinaturas: CENTRAL_SEGREDO (opcional); sem ele, é derivado das chaves do servidor.
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// .trim(): ignora espaço ou quebra de linha que às vezes entra ao colar o valor na Vercel
const senhaEnv = () => String(process.env.CENTRAL_SENHA || '').trim();
const temGithub = () => !!String(process.env.RB_GITHUB_TOKEN || '').trim();

function segredo() {
  const proprio = String(process.env.CENTRAL_SEGREDO || '').trim();
  if (proprio.length >= 32) return proprio;
  // derivado de chaves que só existem no servidor (trocar uma delas desloga todo mundo)
  const base = [process.env.ANTHROPIC_API_KEY, process.env.RB_GITHUB_TOKEN, process.env.SAAS_API_TOKEN].map((v) => String(v || '').trim()).join('|');
  return base.replace(/\|/g, '').length >= 20 ? sha('rb-central|' + base) : '';
}

const configurado = () => !!segredo() && (senhaEnv().length >= 8 || temGithub());

// O que falta, sem revelar nenhum valor (aparece na tela de login)
function problemas() {
  const p = [];
  if (!senhaEnv() && !temGithub()) p.push('falta RB_GITHUB_TOKEN (o login usa a mesma senha do admin do site, lida do catálogo pelo GitHub)');
  if (senhaEnv() && senhaEnv().length < 8 && !temGithub()) p.push('CENTRAL_SENHA tem menos de 8 caracteres');
  if (!segredo()) p.push('falta ANTHROPIC_API_KEY ou RB_GITHUB_TOKEN');
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
  if (!segredo()) return null;
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig || !igual(sig, assinar(corpo))) return null;
  try {
    const obj = JSON.parse(de64(corpo));
    return obj.exp > Date.now() ? obj : null;
  } catch (e) { return null; }
}

// Confere a senha: CENTRAL_SENHA (se existir) ou a senha do admin do site (hash no catálogo publicado)
async function senhaConfere(senha) {
  if (!configurado()) return false;
  const s = String(senha || '').trim();
  if (senhaEnv().length >= 8 && igual(s, senhaEnv())) return true;
  if (!temGithub()) return false;
  const { cat } = await require('./rb').lerCatalogo();
  const hash = cat && cat.loja && cat.loja.senhaHash;
  return !!hash && igual(sha('rbtech:' + s), hash);
}

const criarSessao = () => selar({ tipo: 'sessao' }, 12 * 60);
function sessaoValida(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = abrir(t);
  return !!(s && s.tipo === 'sessao');
}

// senha do webhook do WhatsApp (a Z-API manda em Authorization: Bearer); sai do segredo da Central
const tokenWebhook = () => (segredo() ? crypto.createHmac('sha256', segredo()).update('webhook-whatsapp').digest('hex') : '');
const webhookValido = (req) => {
  const t = tokenWebhook();
  const recebido = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '').trim();
  return !!(t && recebido && igual(recebido, t));
};

// chave de 32 bytes derivada do segredo da Central, para criptografar algo guardado fora (ex.: autorização do Spotify)
const chaveDerivada = (nome) => crypto.createHmac('sha256', segredo() || 'sem-segredo').update('chave:' + nome).digest();

module.exports = { configurado, problemas, selar, abrir, senhaConfere, criarSessao, sessaoValida, tokenWebhook, webhookValido, chaveDerivada };
