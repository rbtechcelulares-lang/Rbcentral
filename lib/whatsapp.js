// Envio automático pela API oficial do WhatsApp (Meta Cloud API). Variáveis na Vercel:
//   WHATSAPP_TOKEN     token do usuário do sistema (Configurações do negócio › Usuários do sistema), validade "Nunca"
//                      (o token de teste da tela "Experimente" também funciona, mas vence em ~24 h)
//   WHATSAPP_PHONE_ID  "Phone Number ID" do número que envia (developers.facebook.com › WhatsApp › Experimente / Configuração da API)
//   WHATSAPP_MODELO    (recomendado) modelo aprovado, categoria Utilidade, com uma variável {{1}} no meio do texto, ex.: aviso_equipe.
//                      Sem modelo, vai como texto livre, que o WhatsApp só entrega se a pessoa mandou mensagem
//                      para esse número nas últimas 24 horas.
//   WHATSAPP_IDIOMA    (opcional) idioma do modelo; padrão pt_BR
const VERSAO = () => process.env.WHATSAPP_API_VERSAO || 'v23.0';
const token = () => String(process.env.WHATSAPP_TOKEN || '').trim();
const phoneId = () => String(process.env.WHATSAPP_PHONE_ID || '').replace(/\D/g, '');
const modelo = () => String(process.env.WHATSAPP_MODELO || '').trim();
const idioma = () => String(process.env.WHATSAPP_IDIOMA || 'pt_BR').trim();

const ok = () => !!(token() && phoneId());

function erroLegivel(d, status) {
  const e = (d && d.error) || {};
  const c = Number(e.code);
  if (c === 190 || status === 401) return 'o WHATSAPP_TOKEN está inválido ou venceu (o token de teste vale só ~24 h: use o token permanente do usuário do sistema)';
  if (c === 131030) return 'esse número ainda não está na lista de destinatários de teste da Meta (Experimente › Para)';
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

async function enviar(numero, mensagem) {
  if (!ok()) throw new Error('Falta configurar WHATSAPP_TOKEN e WHATSAPP_PHONE_ID na Vercel.');
  const corpo = modelo()
    ? { messaging_product: 'whatsapp', to: numero, type: 'template', template: { name: modelo(), language: { code: idioma() }, components: [{ type: 'body', parameters: [{ type: 'text', text: paraModelo(mensagem) }] }] } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'text', text: { preview_url: false, body: String(mensagem).slice(0, 4000) } };
  const r = await fetch('https://graph.facebook.com/' + VERSAO() + '/' + phoneId() + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('WhatsApp não enviou: ' + erroLegivel(d, r.status) + '.');
  return { id: ((d.messages || [])[0] || {}).id || '', como: modelo() ? 'modelo' : 'texto' };
}

module.exports = { ok, enviar, modelo };
