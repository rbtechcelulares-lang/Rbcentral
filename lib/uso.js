// Contador diário (horário de Brasília) para limitar usos pagos, ex.: 40 transcrições revisadas pelo Claude por dia.
// Fica no Supabase do site (função central_uso_contar em supabase/central_conversas.sql).
// Sem o SQL rodado, conta na memória do servidor (aproximado: zera quando a Vercel reinicia a função).
const rb = require('./rb');

const memoria = new Map();

async function contar(tipo, limite) {
  if (limite <= 0) return { ok: false, usados: 0, limite, onde: 'desligado' };
  if (rb.githubOk() && rb.supabaseOk()) {
    try {
      const d = await rb.rpcPainel('central_uso_contar', { p_tipo: tipo, p_limite: limite });
      if (d && typeof d.ok === 'boolean') return { ok: d.ok, usados: Number(d.usados) || 0, limite, onde: 'nuvem' };
    } catch (e) { /* sem o SQL: conta na memória */ }
  }
  const hoje = rb.hojeBR();
  for (const k of memoria.keys()) if (!k.startsWith(hoje)) memoria.delete(k);
  const chave = hoje + '|' + tipo;
  const n = memoria.get(chave) || 0;
  if (n >= limite) return { ok: false, usados: n, limite, onde: 'memoria' };
  memoria.set(chave, n + 1);
  return { ok: true, usados: n + 1, limite, onde: 'memoria' };
}

module.exports = { contar };
