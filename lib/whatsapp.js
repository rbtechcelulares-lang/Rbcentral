// Envio automático de WhatsApp, por um destes caminhos (o primeiro que estiver configurado na Vercel):
//
// 1) Z-API Omni, conexão "WhatsApp Web" (QR code): envia pelo WhatsApp da própria loja, sem janela de 24 h
//    e sem modelo. Documentação: developer.omni.z-api.io.
//      ZAPI_OMNI_KEY    a Secret Key (painel da Z-API Omni › Segurança)
//      ZAPI_OMNI_CANAL  (opcional) o ID do canal; sem ele, usa a conexão WhatsApp Web conectada
//
// 2) API oficial da Meta (WhatsApp Cloud API):
//      WHATSAPP_TOKEN     token do usuário do sistema (Configurações do negócio › Usuários do sistema), validade "Nunca"
//      WHATSAPP_PHONE_ID  "Phone Number ID" do número que envia
//      WHATSAPP_MODELO    (recomendado) modelo aprovado, categoria Utilidade, com uma variável {{1}} no meio do texto.
//                         Sem modelo, vai como texto livre, que só chega se a pessoa mandou mensagem nas últimas 24 h.
//      WHATSAPP_IDIOMA    (opcional) idioma do modelo; padrão pt_BR

// ---------- Z-API Omni ----------
const OMNI = 'https://api.omni.z-api.io';
const omniKey = () => String(process.env.ZAPI_OMNI_KEY || '').trim();
let canalAchado = null; // { id, em }

async function omni(metodo, caminho, corpo) {
  const r = await fetch(OMNI + caminho, {
    method: metodo,
    headers: Object.assign({ Authorization: 'Bearer ' + omniKey() }, corpo ? { 'Content-Type': 'application/json' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const d = await r.json().catch(() => ({}));
  return { r, d };
}

function erroOmni(r, d) {
  if (r.status === 401) return 'a ZAPI_OMNI_KEY está errada (use a Secret Key do menu Segurança da Z-API Omni)';
  if (d && d.subCode === 'CHANNEL_DISCONNECTED') return 'o WhatsApp da loja está desconectado da Z-API. Leia o QR code de novo em Conexões';
  if (r.status === 502) return 'a Z-API está com problema agora; tente de novo em alguns minutos';
  const m = (d && (d.message || d.error)) || '';
  return m ? 'a Z-API recusou (' + String(m).slice(0, 140) + ')' : 'a Z-API respondeu ' + r.status;
}

// ID do canal: o configurado, ou a conexão WhatsApp Web conectada (guardada por 10 minutos)
async function canalOmni() {
  const fixo = String(process.env.ZAPI_OMNI_CANAL || '').trim();
  if (fixo) return fixo;
  if (canalAchado && Date.now() - canalAchado.em < 10 * 60e3) return canalAchado.id;
  const { r, d } = await omni('GET', '/v1/channels?type=Z_API_WHATSAPP&pageSize=20');
  if (!r.ok) throw new Error('WhatsApp não enviou: ' + erroOmni(r, d) + '.');
  const lista = Array.isArray(d.content) ? d.content : [];
  const canal = lista.find((c) => c.whatsappConnected || c.phoneConnected) || lista[0];
  if (!canal) throw new Error('WhatsApp não enviou: não achei nenhuma conexão WhatsApp Web na Z-API Omni. Crie em Conexões › Adicionar conexão › WhatsApp Web.');
  canalAchado = { id: canal.id, em: Date.now() };
  return canal.id;
}

async function enviarOmni(numero, mensagem) {
  const canal = await canalOmni();
  const { r, d } = await omni('POST', '/v1/channels/' + encodeURIComponent(canal) + '/messages', {
    recipient: { identifier: numero },
    content: { type: 'TEXT', body: { message: String(mensagem).slice(0, 4000) } }
  });
  if (!r.ok) {
    if (d && d.subCode === 'CHANNEL_DISCONNECTED') canalAchado = null;
    throw new Error('WhatsApp não enviou: ' + erroOmni(r, d) + '.');
  }
  return { id: d.messageId || '', como: 'zapi' };
}

// ---------- Meta (WhatsApp Cloud API) ----------
const VERSAO = () => process.env.WHATSAPP_API_VERSAO || 'v23.0';
const token = () => String(process.env.WHATSAPP_TOKEN || '').trim();
const phoneId = () => String(process.env.WHATSAPP_PHONE_ID || '').replace(/\D/g, '');
const modelo = () => String(process.env.WHATSAPP_MODELO || '').trim();
const idioma = () => String(process.env.WHATSAPP_IDIOMA || 'pt_BR').trim();
const metaOk = () => !!(token() && phoneId());

function erroMeta(d, status) {
  const e = (d && d.error) || {};
  const c = Number(e.code);
  if (c === 190 || status === 401) return 'o WHATSAPP_TOKEN está inválido ou venceu (o token de teste vale só ~24 h: use o token permanente do usuário do sistema)';
  if (c === 131030) return 'esse número ainda não está na lista de destinatários de teste da Meta (Experimente › Para)';
  if (c === 130497) return 'a Meta não deixa esse número mandar para o Brasil (o número de teste é dos EUA): use um número brasileiro';
  if (c === 132001) return 'o modelo "' + modelo() + '" não existe ou ainda não foi aprovado no idioma ' + idioma();
  if (c === 132000 || c === 132012) return 'o modelo "' + modelo() + '" precisa ter exatamente uma variável {{1}}';
  if (c === 133010) return 'o número que envia ainda não foi registrado na API';
  if (c === 131026) return 'o WhatsApp não conseguiu entregar para esse número';
  if (c === 131056 || c === 130429 || c === 80007) return 'limite de envio do WhatsApp atingido por agora; tente em alguns minutos';
  if (c === 100 && /phone/i.test(e.message || '')) return 'o WHATSAPP_PHONE_ID está errado';
  return (e.error_data && e.error_data.details) || e.message || ('o WhatsApp respondeu ' + status);
}

// no modelo, a variável não aceita quebra de linha, tabulação nem 4 espaços seguidos
const paraModelo = (m) => String(m).replace(/\s*\n+\s*/g, ' · ').replace(/\t/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900);

async function enviarMeta(numero, mensagem) {
  const corpo = modelo()
    ? { messaging_product: 'whatsapp', to: numero, type: 'template', template: { name: modelo(), language: { code: idioma() }, components: [{ type: 'body', parameters: [{ type: 'text', text: paraModelo(mensagem) }] }] } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'text', text: { preview_url: false, body: String(mensagem).slice(0, 4000) } };
  const r = await fetch('https://graph.facebook.com/' + VERSAO() + '/' + phoneId() + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('WhatsApp não enviou: ' + erroMeta(d, r.status) + '.');
  return { id: ((d.messages || [])[0] || {}).id || '', como: modelo() ? 'modelo' : 'texto' };
}

// ---------- quem envia ----------
const caminho = () => (omniKey() ? 'zapi' : metaOk() ? 'meta' : '');
const ok = () => !!caminho();

async function enviar(numero, mensagem) {
  if (caminho() === 'zapi') return enviarOmni(numero, mensagem);
  if (caminho() === 'meta') return enviarMeta(numero, mensagem);
  throw new Error('Falta configurar o envio de WhatsApp na Vercel (ZAPI_OMNI_KEY, ou WHATSAPP_TOKEN e WHATSAPP_PHONE_ID).');
}

module.exports = { ok, enviar, caminho, modelo };
