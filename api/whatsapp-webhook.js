// A Z-API Omni chama aqui a cada mensagem do WhatsApp da loja (webhook ligado pelo botão do CRM na Central).
// Protegido por senha: Authorization: Bearer <token que a Central gerou e cadastrou na Z-API>.
const auth = require('../lib/auth');
const crm = require('../lib/crm-whatsapp');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  if (!auth.webhookValido(req)) return res.status(401).json({ erro: 'Não autorizado.' });
  try {
    return res.status(200).json({ ok: true, registradas: await crm.registrar(req.body) });
  } catch (e) {
    console.log('rb-central webhook-whatsapp erro', e.message);
    return res.status(200).json({ ok: false }); // não faz a Z-API repetir em loop
  }
};
