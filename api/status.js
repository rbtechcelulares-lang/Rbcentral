// O que está conectado (para a tela mostrar). Não revela nenhuma chave.
const auth = require('../lib/auth');
const rb = require('../lib/rb');
const saas = require('../lib/saas');
const whatsapp = require('../lib/whatsapp');
const cameras = require('../lib/cameras');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.sessaoValida(req)) return res.status(401).json({ erro: 'Faça login.' });
  return res.status(200).json({
    ia: !!process.env.ANTHROPIC_API_KEY,
    site: rb.githubOk(),
    crm: rb.githubOk() && rb.supabaseOk(),
    sistema_os: saas.ok(),
    voz: !!String(process.env.GROQ_API_KEY || '').trim(), // microfone com transcrição Whisper no servidor
    whatsapp: whatsapp.ok(), // envio automático de WhatsApp (Z-API ou Meta)
    crm_whatsapp: require('../lib/crm-whatsapp').ativo(), // CRM das conversas do WhatsApp
    musica: require('../lib/spotify').configurado(), // Spotify da loja (falta só conectar, se ainda não conectou)
    cameras: cameras.ativo() ? await cameras.estado().then((e) => e.configurado).catch(() => false) : false // link das câmeras salvo
  });
};
