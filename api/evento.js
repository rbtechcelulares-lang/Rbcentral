// O sistema de OS chama aqui a cada acontecimento (venda, OS aberta, orçamento, status, follow-up).
// A Central monta a mensagem de WhatsApp para o cliente e deixa pendente para o dono confirmar (botão "Enviar").
// POST com Authorization: Bearer <a mesma chave SAAS_API_TOKEN combinada com o sistema> e o corpo:
//   { "loja": "rbtechcelulares", "tipo": "venda" | "os_criada" | "orcamento" | "status" | "follow_up",
//     "id": "<id do registro>", "cliente": { "nome", "whatsapp" }, "dados": { ... }, "mensagem": "(opcional)" }
// Formato completo em docs/CONTRATO-API-SAAS.md. Resposta: { pendente: true, aviso } ou { pendente: false, motivo }
const crypto = require('crypto');
const avisos = require('../lib/avisos');

const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  const chave = String(process.env.SAAS_API_TOKEN || '').trim();
  const recebida = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!chave || !recebida || !igual(recebida, chave)) return res.status(401).json({ erro: 'Chave inválida.' });
  try {
    return res.status(200).json(await avisos.prepararEvento(req.body));
  } catch (e) {
    return res.status(502).json({ pendente: false, motivo: e.message });
  }
};
