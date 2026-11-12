// Aviso automático "seu aparelho está pronto" para o cliente, pelo WhatsApp da loja.
// Dispara quando: (1) o sistema de OS avisa a Central (api/os-pronta) ao mudar uma OS para pronto, ou
// (2) o dono muda o status para pronto pela própria Central. Cada OS é avisada no máximo uma vez por dia,
// mesmo que os dois caminhos disparem juntos.
// Variáveis (opcionais) na Vercel:
//   CENTRAL_AVISO_PRONTA   "0" desliga o aviso automático
//   CENTRAL_STATUS_PRONTO  nome(s) do status de pronto no sistema de OS (padrão: pronto; vários separados por vírgula)
//   CENTRAL_MSG_OS_PRONTA  texto do aviso com {nome} {aparelho} {numero} {valor}; \n vira nova linha
const crypto = require('crypto');
const saas = require('./saas');
const whatsapp = require('./whatsapp');
const equipe = require('./equipe');
const uso = require('./uso');

const PADRAO = 'Olá, {nome}! Aqui é da *RB Tech Celulares*.\nSeu {aparelho} (OS #{numero}) já está *pronto para retirada*. ✅{valor}\nQualquer dúvida, é só responder esta mensagem.';

const simples = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const ligado = () => String(process.env.CENTRAL_AVISO_PRONTA || '1').trim() !== '0';
function statusPronto(status) {
  const v = simples(status);
  if (!v) return false;
  return String(process.env.CENTRAL_STATUS_PRONTO || 'pronto').split(',').map(simples).filter(Boolean).some((x) => v === x || v.includes(x));
}
// o aviso sai sozinho quando a OS fica pronta? (para a prévia do "Confirmar" dizer isso)
const automatico = (status) => ligado() && whatsapp.ok() && statusPronto(status);

const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const primeiroNome = (n) => {
  const p = String(n || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
};

function montar(os) {
  const nome = primeiroNome(os.cliente && os.cliente.nome);
  const aparelho = [os.aparelho && os.aparelho.marca, os.aparelho && os.aparelho.modelo].filter(Boolean).join(' ').trim() || 'aparelho';
  const valor = !os.pago && Number(os.valor) > 0 ? '\nValor: ' + brl(os.valor) + '.' : '';
  let t = String(process.env.CENTRAL_MSG_OS_PRONTA || PADRAO).replace(/\\n/g, '\n');
  if (!nome) t = t.replace(/,?\s*\{nome\}/g, '');
  return t.replace(/\{nome\}/g, nome).replace(/\{aparelho\}/g, aparelho).replace(/\{numero\}/g, String(os.numero || os.id || '')).replace(/\{valor\}/g, valor).trim();
}

// chave só com letras para o contador diário (uma por OS)
const chaveOS = (id) => 'os_' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 24).replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'['0123456789abcdef'.indexOf(c)]);

async function avisarOsPronta(osId, origem) {
  if (!ligado()) return { enviado: false, motivo: 'aviso automático desligado (CENTRAL_AVISO_PRONTA=0)' };
  if (!whatsapp.ok()) return { enviado: false, motivo: 'o envio automático de WhatsApp não está configurado (ZAPI_OMNI_KEY)' };
  // lê a OS de novo no sistema (só da minha loja): não confia em nada que veio no pedido
  const d = await saas.verOS({ os_id: osId });
  const os = (d && d.os) || d || {};
  if (!statusPronto(os.status)) return { enviado: false, motivo: 'a OS não está pronta (status: ' + (os.status || '?') + ')' };
  const numero = equipe.normalizar(os.cliente && os.cliente.whatsapp);
  if (!numero) return { enviado: false, motivo: 'a OS não tem o WhatsApp do cliente' };
  const cota = await uso.contar(chaveOS(os.id || osId), 1);
  if (!cota.ok) return { enviado: false, motivo: 'esse cliente já foi avisado hoje' };
  const mensagem = montar(os);
  await whatsapp.enviar(numero, mensagem);
  const para = (os.cliente && os.cliente.nome) || equipe.formatar(numero);
  console.log('rb-central aviso-pronta', JSON.stringify({ quando: new Date().toISOString(), os: os.numero || os.id, origem }));
  return { enviado: true, para, mensagem };
}

module.exports = { avisarOsPronta, statusPronto, automatico, montar };
