-- RB Central · histórico das 6 últimas conversas (o mesmo no iPhone e no computador)
-- contador diário de uso, avisos de status de OS esperando confirmação e o CRM do WhatsApp.
-- Rode no Supabase do SITE (o mesmo do CRM): SQL Editor › New query › cole tudo › Run.
-- Precisa do clientes.sql do site já rodado (usa a mesma chave do painel).
-- Pode rodar de novo sem perder nada.

create table if not exists public.central_conversas (
  id text primary key check (id ~ '^[a-z0-9]{6,24}$'),
  atualizada_ms bigint not null,
  dados jsonb not null
);
create index if not exists central_conversas_atualizada_idx on public.central_conversas (atualizada_ms desc);

-- Ninguém lê nem altera a tabela pela chave pública: só pelas funções abaixo, com a chave do painel.
alter table public.central_conversas enable row level security;
revoke all on public.central_conversas from anon, authenticated;

-- As 6 conversas mais recentes (da mais nova para a mais antiga)
create or replace function public.central_conversas_listar(chave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return coalesce((
    select jsonb_agg(x.dados order by x.atualizada_ms desc)
    from (select dados, atualizada_ms from central_conversas order by atualizada_ms desc limit 6) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.central_conversas_listar(text) from public;
grant execute on function public.central_conversas_listar(text) to anon, authenticated;

-- Salva uma conversa (a versão mais nova vence) e mantém só as 6 mais recentes
create or replace function public.central_conversa_salvar(chave text, p_id text, p_atualizada bigint, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  if octet_length(p_dados::text) > 900000 then
    raise exception 'conversa grande demais';
  end if;
  insert into central_conversas (id, atualizada_ms, dados)
  values (p_id, p_atualizada, p_dados)
  on conflict (id) do update set atualizada_ms = excluded.atualizada_ms, dados = excluded.dados
  where central_conversas.atualizada_ms <= excluded.atualizada_ms;
  delete from central_conversas
  where id not in (select c.id from central_conversas c order by c.atualizada_ms desc limit 6);
end;
$$;
revoke all on function public.central_conversa_salvar(text, text, bigint, jsonb) from public;
grant execute on function public.central_conversa_salvar(text, text, bigint, jsonb) to anon, authenticated;

-- Apaga uma conversa
create or replace function public.central_conversa_apagar(chave text, p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  delete from central_conversas where id = p_id;
end;
$$;
revoke all on function public.central_conversa_apagar(text, text) from public;
grant execute on function public.central_conversa_apagar(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Contador diário de uso (ex.: 40 transcrições do microfone revisadas pelo Claude por dia;
-- passando do limite, o microfone segue só com o Whisper grátis até o dia seguinte)
create table if not exists public.central_uso (
  dia date not null,
  tipo text not null check (tipo ~ '^[a-z_]{1,30}$'),
  qtd integer not null default 0,
  primary key (dia, tipo)
);
alter table public.central_uso enable row level security;
revoke all on public.central_uso from anon, authenticated;

-- Conta um uso de hoje (horário de Brasília) se ainda couber no limite e diz se pode usar
create or replace function public.central_uso_contar(chave text, p_tipo text, p_limite integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  n integer;
begin
  perform painel_checar(chave);
  insert into central_uso (dia, tipo, qtd) values (hoje, p_tipo, 1)
  on conflict (dia, tipo) do update set qtd = central_uso.qtd + 1
  where central_uso.qtd < p_limite
  returning qtd into n;
  delete from central_uso where dia < hoje - 30;
  if n is null then
    return jsonb_build_object('ok', false, 'usados', p_limite, 'limite', p_limite);
  end if;
  return jsonb_build_object('ok', true, 'usados', n, 'limite', p_limite);
end;
$$;
revoke all on function public.central_uso_contar(text, text, integer) from public;
grant execute on function public.central_uso_contar(text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Avisos de mudança de status de OS esperando o dono confirmar (botão "Enviar" na Central)
create table if not exists public.central_avisos (
  id text primary key check (id ~ '^[a-z0-9]{8,32}$'),
  os_id text not null check (char_length(os_id) between 1 and 60),
  status text not null check (char_length(status) between 1 and 60),
  estado text not null default 'pendente' check (estado in ('pendente', 'enviado', 'descartado')),
  dados jsonb not null,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create unique index if not exists central_avisos_pendente_idx on public.central_avisos (os_id, status) where estado = 'pendente';
alter table public.central_avisos enable row level security;
revoke all on public.central_avisos from anon, authenticated;

-- Guarda o aviso (um por OS e status enquanto estiver pendente). Devolve o id, ou null se esse
-- mesmo aviso já foi enviado nas últimas 12 horas.
create or replace function public.central_aviso_criar(chave text, p_id text, p_os_id text, p_status text, p_dados jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  perform painel_checar(chave);
  if exists (select 1 from central_avisos where os_id = p_os_id and status = p_status and estado = 'enviado' and atualizado > now() - interval '12 hours') then
    return null;
  end if;
  insert into central_avisos (id, os_id, status, dados) values (p_id, p_os_id, p_status, p_dados)
  on conflict (os_id, status) where estado = 'pendente' do update set dados = excluded.dados, atualizado = now()
  returning id into v;
  delete from central_avisos where estado <> 'pendente' and atualizado < now() - interval '30 days';
  return v;
end;
$$;
revoke all on function public.central_aviso_criar(text, text, text, text, jsonb) from public;
grant execute on function public.central_aviso_criar(text, text, text, text, jsonb) to anon, authenticated;

-- Avisos pendentes, do mais novo para o mais antigo
create or replace function public.central_avisos_listar(chave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'os_id', x.os_id, 'status', x.status, 'criado', x.criado) || x.dados order by x.criado desc)
    from (select * from central_avisos where estado = 'pendente' order by criado desc limit 30) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.central_avisos_listar(text) from public;
grant execute on function public.central_avisos_listar(text) to anon, authenticated;

-- Muda o estado de um aviso só se ele estiver no estado esperado (evita enviar duas vezes).
-- Devolve o aviso, ou null se não estava no estado esperado.
create or replace function public.central_aviso_marcar(chave text, p_id text, p_de text, p_para text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform painel_checar(chave);
  if p_para not in ('pendente', 'enviado', 'descartado') then
    raise exception 'estado inválido';
  end if;
  update central_avisos set estado = p_para, atualizado = now()
  where id = p_id and estado = p_de
  returning jsonb_build_object('id', id, 'os_id', os_id, 'status', status) || dados into v;
  return v;
end;
$$;
revoke all on function public.central_aviso_marcar(text, text, text, text) from public;
grant execute on function public.central_aviso_marcar(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- CRM do WhatsApp: as conversas do WhatsApp da loja (chegam pela Z-API) e a ficha de cada cliente,
-- que a IA da Central mantém (etapa, interesse, resumo, próximo passo). Mensagens ficam 90 dias.
create table if not exists public.central_wa_contatos (
  numero text primary key check (numero ~ '^[0-9]{10,15}$'),
  nome text check (char_length(nome) <= 80),
  primeiro_contato timestamptz not null default now(),
  ultimo_contato timestamptz not null default now(),
  ultima_msg text check (char_length(ultima_msg) <= 300),
  ultima_de text check (ultima_de in ('cliente', 'loja')),
  msgs_novas integer not null default 0,
  etapa text not null default 'novo' check (etapa in ('novo', 'em_atendimento', 'orcamento', 'negociando', 'fechado', 'comprou', 'perdido', 'pos_venda')),
  interesse text check (char_length(interesse) <= 200),
  resumo text check (char_length(resumo) <= 600),
  proxima_acao text check (char_length(proxima_acao) <= 200),
  valor numeric check (valor >= 0),
  analisado timestamptz
);
create index if not exists central_wa_contatos_ultimo_idx on public.central_wa_contatos (ultimo_contato desc);
-- tipo de conversa (a IA decide): o CRM mostra só quem quer comprar iPhone
--   compra_iphone · vende_para_loja (a loja é que compra) · reparo · outro · null = ainda não lido
alter table public.central_wa_contatos add column if not exists tipo text check (tipo in ('compra_iphone', 'vende_para_loja', 'reparo', 'outro'));
-- contatos lidos antes da separação por tipo: a IA lê de novo para separar
update public.central_wa_contatos set msgs_novas = greatest(msgs_novas, 1) where tipo is null and analisado is not null;
-- Funil (site → WhatsApp → venda):
--   codigo/sessao = o código "Ref. RB-XXXXXX" que o site põe na mensagem pronta liga o número à visita no site
--   retirada_em = dia que o cliente combinou de buscar ou pagar (a IA lê na conversa)
--   venda_em = venda registrada no sistema de OS (ou marcada pelo dono)
--   etapa_fixa = o dono escolheu a etiqueta na mão; a IA não troca mais
alter table public.central_wa_contatos add column if not exists codigo text check (codigo ~ '^[A-Z0-9]{6}$');
alter table public.central_wa_contatos add column if not exists sessao text check (char_length(sessao) <= 60);
alter table public.central_wa_contatos add column if not exists retirada_em date;
alter table public.central_wa_contatos add column if not exists venda_em timestamptz;
alter table public.central_wa_contatos add column if not exists etapa_fixa boolean not null default false;
-- por que não fechou (a IA classifica quem foi perdido): motivo, detalhe curto e se o cliente disse (certo) ou é dedução (provavel)
alter table public.central_wa_contatos add column if not exists motivo_perda text check (motivo_perda in ('preco', 'pagamento', 'troca', 'estoque', 'aparelho', 'confianca', 'concorrente', 'demora_loja', 'entrega', 'desistiu', 'sumiu', 'outro'));
alter table public.central_wa_contatos add column if not exists motivo_detalhe text check (char_length(motivo_detalhe) <= 160);
alter table public.central_wa_contatos add column if not exists motivo_certeza text check (motivo_certeza in ('certo', 'provavel'));
alter table public.central_wa_contatos add column if not exists motivo_em timestamptz;
-- etapa nova "fechado" (combinou a compra, falta pagar ou buscar)
alter table public.central_wa_contatos drop constraint if exists central_wa_contatos_etapa_check;
alter table public.central_wa_contatos add constraint central_wa_contatos_etapa_check
  check (etapa in ('novo', 'em_atendimento', 'orcamento', 'negociando', 'fechado', 'comprou', 'perdido', 'pos_venda'));
-- desde quando o site manda o código (cliques antes disso não contam como "clicou e não mandou")
create table if not exists public.central_funil (id int primary key default 1 check (id = 1), desde timestamptz not null default now());
insert into public.central_funil (id) values (1) on conflict (id) do nothing;
alter table public.central_funil enable row level security;
revoke all on public.central_funil from anon, authenticated;
-- busca rápida dos cliques do site pela sessão e pelo código (fim da sessão)
do $$
begin
  if to_regclass('public.eventos') is not null then
    create index if not exists eventos_sessao_idx on public.eventos (sessao);
    create index if not exists eventos_sessao_fim_idx on public.eventos (right(sessao, 6));
  end if;
end;
$$;

-- Em que pé está o cliente (as regras de prazo do funil):
--   comprou · perdido · loja_sem_responder (cliente esperando há mais de 30 min) · nao_buscou (fechou e passou
--   2 dias do dia combinado) · fechado · aguardando_loja · cliente_sumiu (mais de 24 h sem responder a loja;
--   7 dias vira perdido) · em_conversa
create or replace function public.central_wa_situacao(c public.central_wa_contatos)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when c.venda_em is not null or c.etapa in ('comprou', 'pos_venda') then 'comprou'
    when c.etapa = 'perdido' then 'perdido'
    when c.ultima_de = 'cliente' and c.ultimo_contato < now() - interval '30 minutes' then 'loja_sem_responder'
    when c.etapa = 'fechado' and coalesce(c.retirada_em, (c.ultimo_contato at time zone 'America/Sao_Paulo')::date)
      < (now() at time zone 'America/Sao_Paulo')::date - 2 then 'nao_buscou'
    when c.etapa = 'fechado' then 'fechado'
    when c.ultima_de = 'cliente' then 'aguardando_loja'
    when c.ultima_de = 'loja' and c.ultimo_contato < now() - interval '7 days' then 'perdido'
    when c.ultima_de = 'loja' and c.ultimo_contato < now() - interval '24 hours' then 'cliente_sumiu'
    else 'em_conversa'
  end;
$$;
revoke all on function public.central_wa_situacao(public.central_wa_contatos) from public;
create table if not exists public.central_wa_mensagens (
  id text primary key check (char_length(id) between 1 and 80),
  numero text not null references public.central_wa_contatos (numero) on delete cascade,
  de_mim boolean not null,
  texto text not null check (char_length(texto) <= 4000),
  criado timestamptz not null default now()
);
create index if not exists central_wa_mensagens_numero_idx on public.central_wa_mensagens (numero, criado desc);
alter table public.central_wa_contatos enable row level security;
alter table public.central_wa_mensagens enable row level security;
revoke all on public.central_wa_contatos from anon, authenticated;
revoke all on public.central_wa_mensagens from anon, authenticated;

-- Guarda uma mensagem (a mesma mensagem duas vezes não conta de novo)
create or replace function public.central_wa_registrar(chave text, p_id text, p_numero text, p_nome text, p_de_mim boolean, p_texto text, p_quando timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  perform painel_checar(chave);
  insert into central_wa_contatos (numero, nome, primeiro_contato, ultimo_contato)
  values (p_numero, case when p_de_mim or trim(coalesce(p_nome, '')) ~ '^[0-9+ ()-]*$' then null else left(trim(p_nome), 80) end, p_quando, p_quando)
  on conflict (numero) do nothing;
  -- mensagem da loja que a Central já guardou ao enviar e volta pelo webhook com outro id: não entra de novo
  if p_de_mim and exists (select 1 from central_wa_mensagens m where m.numero = p_numero and m.de_mim and m.texto = left(p_texto, 4000)
      and m.criado between p_quando - interval '3 minutes' and p_quando + interval '3 minutes') then return; end if;
  insert into central_wa_mensagens (id, numero, de_mim, texto, criado)
  values (p_id, p_numero, p_de_mim, left(p_texto, 4000), p_quando)
  on conflict (id) do nothing
  returning id into v;
  if v is null then return; end if;
  update central_wa_contatos set
    nome = case when not p_de_mim and nullif(trim(p_nome), '') is not null and trim(p_nome) !~ '^[0-9+ ()-]+$' then left(trim(p_nome), 80) else nome end,
    ultimo_contato = greatest(ultimo_contato, p_quando),
    ultima_msg = case when p_quando >= ultimo_contato then left(p_texto, 300) else ultima_msg end,
    ultima_de = case when p_quando >= ultimo_contato then (case when p_de_mim then 'loja' else 'cliente' end) else ultima_de end,
    msgs_novas = msgs_novas + 1
  where numero = p_numero;
  if random() < 0.02 then
    delete from central_wa_mensagens where criado < now() - interval '90 days';
    delete from central_wa_contatos c where c.ultimo_contato < now() - interval '90 days';
  end if;
end;
$$;
revoke all on function public.central_wa_registrar(text, text, text, text, boolean, text, timestamptz) from public;
grant execute on function public.central_wa_registrar(text, text, text, text, boolean, text, timestamptz) to anon, authenticated;

-- Lista os contatos: p_filtro = 'todos' | 'sem_resposta' | 'para_analisar' | uma etapa; p_busca procura em nome, número, interesse e resumo;
-- p_tipo = 'compra_iphone' (padrão: só quem quer comprar iPhone) | 'outros' (vende para a loja, reparo, outro) | 'todos'
drop function if exists public.central_wa_listar(text, text, text, integer);
create or replace function public.central_wa_listar(chave text, p_filtro text, p_busca text, p_limite integer, p_tipo text default 'compra_iphone')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.ultimo_contato desc)
    from (
      select c.numero, c.nome, c.primeiro_contato, c.ultimo_contato, c.ultima_msg, c.ultima_de, c.msgs_novas, c.tipo, c.etapa, c.etapa_fixa,
        c.interesse, c.resumo, c.proxima_acao, c.valor, c.analisado, c.retirada_em, c.venda_em, c.sessao is not null as veio_do_site,
        c.motivo_perda, c.motivo_detalhe, c.motivo_certeza,
        central_wa_situacao(c) as situacao
      from central_wa_contatos c
      where (coalesce(p_tipo, 'compra_iphone') = 'todos'
          or (coalesce(p_tipo, 'compra_iphone') = 'compra_iphone' and c.tipo = 'compra_iphone')
          or (p_tipo = 'outros' and c.tipo <> 'compra_iphone'))
        and (coalesce(p_filtro, 'todos') = 'todos'
          or (p_filtro = 'sem_resposta' and c.ultima_de = 'cliente')
          or (p_filtro = 'para_analisar' and c.msgs_novas > 0)
          or (p_filtro = 'perda_sem_motivo' and c.motivo_perda is null and c.msgs_novas = 0 and central_wa_situacao(c) = 'perdido')
          or c.etapa = p_filtro
          or central_wa_situacao(c) = p_filtro)
        and (coalesce(p_busca, '') = ''
          or concat_ws(' ', c.nome, c.numero, c.interesse, c.resumo, c.ultima_msg) ilike '%' || p_busca || '%'
          or exists (select 1 from central_wa_mensagens m where m.numero = c.numero and m.texto ilike '%' || p_busca || '%'))
      order by c.ultimo_contato desc
      limit least(greatest(coalesce(p_limite, 30), 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.central_wa_listar(text, text, text, integer, text) from public;
grant execute on function public.central_wa_listar(text, text, text, integer, text) to anon, authenticated;

-- A ficha e as últimas mensagens de um contato (da mais antiga para a mais nova)
create or replace function public.central_wa_conversa(chave text, p_numero text, p_limite integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return jsonb_build_object(
    'contato', (select to_jsonb(c) from central_wa_contatos c where c.numero = p_numero),
    'mensagens', coalesce((
      select jsonb_agg(jsonb_build_object('de_mim', m.de_mim, 'texto', m.texto, 'criado', m.criado) order by m.criado)
      from (select * from central_wa_mensagens where numero = p_numero order by criado desc limit least(greatest(coalesce(p_limite, 30), 1), 80)) m
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.central_wa_conversa(text, text, integer) from public;
grant execute on function public.central_wa_conversa(text, text, integer) to anon, authenticated;

-- A IA atualiza a ficha do contato
create or replace function public.central_wa_salvar_analise(chave text, p_numero text, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia date;
begin
  perform painel_checar(chave);
  begin
    if (p_dados->>'retirada_em') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_dia := (p_dados->>'retirada_em')::date; end if;
  exception when others then v_dia := null;
  end;
  update central_wa_contatos set
    retirada_em = coalesce(v_dia, retirada_em),
    tipo = case when p_dados->>'tipo' in ('compra_iphone', 'vende_para_loja', 'reparo', 'outro') then p_dados->>'tipo' else tipo end,
    etapa = case when etapa_fixa then etapa
      when p_dados->>'etapa' in ('novo', 'em_atendimento', 'orcamento', 'negociando', 'fechado', 'comprou', 'perdido', 'pos_venda') then p_dados->>'etapa' else etapa end,
    interesse = left(nullif(p_dados->>'interesse', ''), 200),
    resumo = left(nullif(p_dados->>'resumo', ''), 600),
    proxima_acao = case when p_dados->>'tipo' is null or p_dados->>'tipo' = 'compra_iphone' then left(nullif(p_dados->>'proxima_acao', ''), 200) end,
    valor = case when (p_dados->>'valor') ~ '^[0-9]+(\.[0-9]+)?$' and (p_dados->>'valor')::numeric > 0 then (p_dados->>'valor')::numeric else null end,
    motivo_perda = null, motivo_detalhe = null, motivo_certeza = null, motivo_em = null,
    msgs_novas = 0,
    analisado = now()
  where numero = p_numero;
end;
$$;
revoke all on function public.central_wa_salvar_analise(text, text, jsonb) from public;
grant execute on function public.central_wa_salvar_analise(text, text, jsonb) to anon, authenticated;

-- O código "Ref. RB-XXXXXX" chegou numa mensagem: liga o número à visita no site (tabela eventos)
create or replace function public.central_wa_vincular(chave text, p_numero text, p_codigo text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  perform painel_checar(chave);
  if coalesce(p_codigo, '') !~ '^[A-Z0-9]{6}$' then return false; end if;
  if to_regclass('public.eventos') is not null then
    execute 'select sessao from eventos where right(sessao, 6) = $1 order by criado_em desc limit 1' into v using lower(p_codigo);
  end if;
  update central_wa_contatos set codigo = p_codigo, sessao = coalesce(v, sessao) where numero = p_numero;
  return v is not null;
end;
$$;
revoke all on function public.central_wa_vincular(text, text, text) from public;
grant execute on function public.central_wa_vincular(text, text, text) to anon, authenticated;

-- Venda registrada no sistema de OS para este WhatsApp: o cliente vira "comprou"
create or replace function public.central_wa_venda(chave text, p_numero text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  update central_wa_contatos set venda_em = now(), etapa = case when etapa = 'pos_venda' then etapa else 'comprou' end
  where numero = p_numero;
  return found;
end;
$$;
revoke all on function public.central_wa_venda(text, text) from public;
grant execute on function public.central_wa_venda(text, text) to anon, authenticated;

-- O dono troca a etiqueta na mão (fica fixa); 'auto' devolve para a IA
create or replace function public.central_wa_etiquetar(chave text, p_numero text, p_etapa text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  if p_etapa = 'auto' then
    update central_wa_contatos set etapa_fixa = false, msgs_novas = greatest(msgs_novas, 1) where numero = p_numero;
  elsif p_etapa in ('novo', 'em_atendimento', 'orcamento', 'negociando', 'fechado', 'comprou', 'perdido', 'pos_venda') then
    update central_wa_contatos set etapa = p_etapa, etapa_fixa = true,
      venda_em = case when p_etapa in ('comprou', 'pos_venda') then coalesce(venda_em, now()) else null end,
      tipo = coalesce(tipo, 'compra_iphone')
    where numero = p_numero;
  else
    raise exception 'etiqueta inválida';
  end if;
end;
$$;
revoke all on function public.central_wa_etiquetar(text, text, text) from public;
grant execute on function public.central_wa_etiquetar(text, text, text) to anon, authenticated;

-- Funil para o Admin do site: clientes de iPhone do WhatsApp com o que fizeram no site,
-- e quem tocou no WhatsApp do site e não mandou a mensagem (depois de 2 h)
create or replace function public.painel_funil_whatsapp(chave text, p_dias integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dias integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  tem_eventos boolean := to_regclass('public.eventos') is not null;
  tem_clientes boolean := to_regclass('public.clientes') is not null;
  v_contatos jsonb;
  v_cliques jsonb := '[]'::jsonb;
  v_desde timestamptz;
begin
  perform painel_checar(chave);
  select coalesce(jsonb_agg(x order by x.ultimo_contato desc), '[]'::jsonb) into v_contatos
  from (
    select c.numero, c.nome, c.ultimo_contato, c.primeiro_contato, c.ultima_msg, c.ultima_de, c.msgs_novas, c.tipo, c.etapa, c.etapa_fixa,
      c.interesse, c.resumo, c.proxima_acao, c.valor, c.retirada_em, c.venda_em, c.codigo, c.sessao,
      c.motivo_perda, c.motivo_detalhe, c.motivo_certeza,
      central_wa_situacao(c) as situacao
    from central_wa_contatos c
    where (c.tipo = 'compra_iphone' or (c.tipo is null and c.sessao is not null))
      and c.ultimo_contato > now() - make_interval(days => dias)
    order by c.ultimo_contato desc
    limit 300
  ) x;
  if tem_eventos then
    -- o que cada cliente fez no site (pela sessão ligada ao código)
    execute $q$
      select coalesce(jsonb_agg(c || jsonb_build_object('site', (
        select jsonb_build_object(
          'origem', (select e.origem from eventos e where e.sessao = c->>'sessao' and e.tipo = 'visita' order by e.criado_em limit 1),
          'primeira_visita', (select min(e.criado_em) from eventos e where e.sessao = c->>'sessao'),
          'cliques', (select count(*) from eventos e where e.sessao = c->>'sessao' and e.tipo = 'clique'),
          'produtos', (select coalesce(jsonb_agg(p), '[]'::jsonb) from (
              select e.produto_nome as nome, count(*) as vezes from eventos e
              where e.sessao = c->>'sessao' and e.produto_nome is not null
              group by e.produto_nome order by count(*) desc limit 5) p),
          'whatsapp', (select jsonb_build_object('quando', e.criado_em, 'origem', e.origem, 'produto', e.produto_nome, 'detalhe', e.detalhe)
              from eventos e where e.sessao = c->>'sessao' and e.tipo = 'whatsapp' order by e.criado_em desc limit 1))
        where c->>'sessao' is not null)) order by i), '[]'::jsonb)
      from jsonb_array_elements($1) with ordinality as t(c, i)
    $q$ into v_contatos using v_contatos;
    -- tocou no WhatsApp do site (depois que o código começou) e nenhuma mensagem com o código chegou em 2 h
    select desde into v_desde from central_funil where id = 1;
    execute $q$
      select coalesce(jsonb_agg(z order by z.quando desc), '[]'::jsonb) from (
        select e.sessao, max(e.criado_em) as quando,
          (array_agg(e.produto_nome order by e.criado_em desc) filter (where e.produto_nome is not null))[1] as produto,
          (array_agg(e.origem order by e.criado_em desc))[1] as botao,
          (array_agg(e.detalhe order by e.criado_em desc) filter (where e.detalhe is not null))[1] as detalhe,
          (select v.origem from eventos v where v.sessao = e.sessao and v.tipo = 'visita' order by v.criado_em limit 1) as veio_de
        from eventos e
        where e.tipo = 'whatsapp' and e.sessao is not null
          and e.criado_em > greatest($1, now() - make_interval(days => $2))
          and e.criado_em < now() - interval '2 hours'
          and not exists (select 1 from central_wa_contatos c where c.sessao = e.sessao or c.codigo = upper(right(e.sessao, 6)))
        group by e.sessao
        order by max(e.criado_em) desc
        limit 100
      ) z
    $q$ into v_cliques using coalesce(v_desde, now()), dias;
  end if;
  if tem_clientes then
    -- quem também deixou nome e WhatsApp no RBChat
    execute $q$
      select coalesce(jsonb_agg(c || coalesce((select jsonb_build_object('rbchat', jsonb_build_object('nome', k.nome, 'interesse', k.interesse, 'entrada', k.entrada, 'status', k.status, 'criado_em', k.criado_em))
        from clientes k where k.whatsapp = c->>'numero'), '{}'::jsonb) order by i), '[]'::jsonb)
      from jsonb_array_elements($1) with ordinality as t(c, i)
    $q$ into v_contatos using v_contatos;
  end if;
  return jsonb_build_object('contatos', v_contatos, 'cliques_sem_mensagem', v_cliques, 'desde', v_desde, 'agora', now());
end;
$$;
revoke all on function public.painel_funil_whatsapp(text, integer) from public;
grant execute on function public.painel_funil_whatsapp(text, integer) to anon, authenticated;

-- A IA guarda por que o cliente não fechou
create or replace function public.central_wa_salvar_motivo(chave text, p_numero text, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  if coalesce(p_dados->>'motivo', '') not in ('preco', 'pagamento', 'troca', 'estoque', 'aparelho', 'confianca', 'concorrente', 'demora_loja', 'entrega', 'desistiu', 'sumiu', 'outro') then raise exception 'motivo inválido'; end if;
  update central_wa_contatos set
    motivo_perda = p_dados->>'motivo',
    motivo_detalhe = left(nullif(p_dados->>'detalhe', ''), 160),
    motivo_certeza = case when p_dados->>'certeza' = 'certo' then 'certo' else 'provavel' end,
    motivo_em = now()
  where numero = p_numero;
end;
$$;
revoke all on function public.central_wa_salvar_motivo(text, text, jsonb) from public;
grant execute on function public.central_wa_salvar_motivo(text, text, jsonb) to anon, authenticated;

-- Relatório de por que os clientes de iPhone não fecharam (últimos p_dias): motivos com exemplos, aparelhos,
-- de onde vieram, tempo até a primeira resposta da loja (quem comprou x quem perdeu) e valor que ficou na mesa
create or replace function public.central_wa_relatorio_perdas(chave text, p_dias integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dias integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  r jsonb;
  v_origem jsonb := '[]'::jsonb;
begin
  perform painel_checar(chave);
  with rel as (
    select c.numero, c.nome, c.interesse, c.valor, central_wa_situacao(c) as situacao, c.motivo_perda as motivo,
      c.motivo_detalhe as detalhe, c.motivo_certeza as certeza, c.sessao,
      (select extract(epoch from (
          (select min(m2.criado) from central_wa_mensagens m2 where m2.numero = c.numero and m2.de_mim and m2.criado > t.t0) - t.t0)) / 60
       from (select min(m1.criado) as t0 from central_wa_mensagens m1 where m1.numero = c.numero and not m1.de_mim) t) as resp_min
    from central_wa_contatos c
    where c.tipo = 'compra_iphone' and c.ultimo_contato > now() - make_interval(days => dias)
  )
  select jsonb_build_object(
    'dias', dias,
    'conversas', (select count(*) from rel),
    'compraram', (select count(*) from rel where situacao = 'comprou'),
    'perdidos', (select count(*) from rel where situacao = 'perdido'),
    'em_aberto', (select count(*) from rel where situacao not in ('comprou', 'perdido')),
    'sem_motivo', (select count(*) from rel where situacao = 'perdido' and motivo is null),
    'conversao_pct', (select case when count(*) filter (where situacao in ('comprou', 'perdido')) = 0 then null
        else round(100.0 * count(*) filter (where situacao = 'comprou') / count(*) filter (where situacao in ('comprou', 'perdido'))) end from rel),
    'valor_perdido', (select coalesce(sum(valor), 0) from rel where situacao = 'perdido' and valor > 0),
    'motivos', (select coalesce(jsonb_agg(m order by m.qtd desc), '[]'::jsonb) from (
        select g.motivo, count(*) as qtd, count(*) filter (where g.certeza = 'certo') as certos,
          coalesce(sum(g.valor) filter (where g.valor > 0), 0) as valor,
          (select jsonb_agg(jsonb_build_object('nome', e.nome, 'numero', e.numero, 'interesse', e.interesse, 'detalhe', e.detalhe))
             from (select * from rel x where x.situacao = 'perdido' and x.motivo = g.motivo order by (x.certeza = 'certo') desc limit 3) e) as exemplos
        from rel g where g.situacao = 'perdido' and g.motivo is not null group by g.motivo) m),
    'aparelhos', (select coalesce(jsonb_agg(a order by a.perdidos desc, a.compraram desc), '[]'::jsonb) from (
        select min(interesse) as aparelho, count(*) filter (where situacao = 'perdido') as perdidos, count(*) filter (where situacao = 'comprou') as compraram
        from rel where interesse is not null and situacao in ('comprou', 'perdido') group by lower(interesse)
        order by count(*) filter (where situacao = 'perdido') desc limit 6) a),
    'primeira_resposta_min', jsonb_build_object(
        'compraram', (select round(percentile_cont(0.5) within group (order by resp_min)::numeric) from rel where situacao = 'comprou' and resp_min is not null),
        'perdidos', (select round(percentile_cont(0.5) within group (order by resp_min)::numeric) from rel where situacao = 'perdido' and resp_min is not null))
  ) into r;
  if to_regclass('public.eventos') is not null then
    execute $q$
      select coalesce(jsonb_agg(o order by o.total desc), '[]'::jsonb) from (
        select coalesce((select v.origem from eventos v where v.sessao = c.sessao and v.tipo = 'visita' order by v.criado_em limit 1), 'direto') as origem,
          count(*) as total, count(*) filter (where central_wa_situacao(c) = 'comprou') as compraram, count(*) filter (where central_wa_situacao(c) = 'perdido') as perdidos
        from central_wa_contatos c
        where c.tipo = 'compra_iphone' and c.sessao is not null and c.ultimo_contato > now() - make_interval(days => $1)
        group by 1) o
    $q$ into v_origem using dias;
  end if;
  return r || jsonb_build_object('origem_site', v_origem, 'gerado_em', now());
end;
$$;
revoke all on function public.central_wa_relatorio_perdas(text, integer) from public;
grant execute on function public.central_wa_relatorio_perdas(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Pedidos de peças aos fornecedores (a lista da Central) e os fornecedores com o WhatsApp deles.
-- status: a_pedir · cotando (perguntou o preço) · pedido (pediu para enviar) · chegou · cancelado
create table if not exists public.central_fornecedores (
  id text primary key check (char_length(id) between 1 and 40),
  nome text not null check (char_length(nome) between 1 and 80),
  whatsapp text check (whatsapp ~ '^[0-9]{12,13}$'),
  observacoes text check (char_length(observacoes) <= 300),
  criado timestamptz not null default now()
);
create unique index if not exists central_fornecedores_nome_idx on public.central_fornecedores (lower(nome));
create table if not exists public.central_pecas (
  id text primary key check (char_length(id) between 1 and 40),
  numero bigint generated always as identity,
  peca text not null check (char_length(peca) between 1 and 120),
  aparelho text check (char_length(aparelho) <= 120),
  quantidade integer not null default 1 check (quantidade between 1 and 99),
  fornecedor_id text references public.central_fornecedores (id) on delete set null,
  os_numero text check (char_length(os_numero) <= 20),
  cliente text check (char_length(cliente) <= 80),
  status text not null default 'a_pedir' check (status in ('a_pedir', 'cotando', 'pedido', 'chegou', 'cancelado')),
  valor numeric check (valor >= 0),
  previsao date,
  observacoes text check (char_length(observacoes) <= 300),
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists central_pecas_status_idx on public.central_pecas (status, atualizado desc);
alter table public.central_fornecedores enable row level security;
alter table public.central_pecas enable row level security;
revoke all on public.central_fornecedores from anon, authenticated;
revoke all on public.central_pecas from anon, authenticated;

-- Cadastra ou atualiza um fornecedor (pelo id, ou pelo nome sem diferença de maiúsculas)
create or replace function public.central_fornecedor_salvar(chave text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v central_fornecedores;
begin
  perform painel_checar(chave);
  select * into v from central_fornecedores where id = p_dados->>'id' or lower(nome) = lower(trim(p_dados->>'nome')) limit 1;
  if v.id is null then
    insert into central_fornecedores (id, nome, whatsapp, observacoes)
    values (p_dados->>'novo_id', trim(p_dados->>'nome'), nullif(p_dados->>'whatsapp', ''), nullif(p_dados->>'observacoes', ''))
    returning * into v;
  else
    update central_fornecedores set
      nome = case when v.id = p_dados->>'id' then coalesce(nullif(trim(p_dados->>'nome'), ''), nome) else nome end,
      whatsapp = coalesce(nullif(p_dados->>'whatsapp', ''), whatsapp),
      observacoes = coalesce(nullif(p_dados->>'observacoes', ''), observacoes)
    where id = v.id returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;
revoke all on function public.central_fornecedor_salvar(text, jsonb) from public;
grant execute on function public.central_fornecedor_salvar(text, jsonb) to anon, authenticated;

create or replace function public.central_fornecedores_listar(chave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return coalesce((select jsonb_agg(to_jsonb(f) order by lower(f.nome)) from central_fornecedores f), '[]'::jsonb);
end;
$$;
revoke all on function public.central_fornecedores_listar(text) from public;
grant execute on function public.central_fornecedores_listar(text) to anon, authenticated;

-- Cria (sem id existente) ou atualiza um pedido de peça; só mexe nos campos enviados
create or replace function public.central_peca_salvar(chave text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v central_pecas;
  v_prev date;
begin
  perform painel_checar(chave);
  begin
    if (p_dados->>'previsao') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_prev := (p_dados->>'previsao')::date; end if;
  exception when others then v_prev := null;
  end;
  select * into v from central_pecas where id = p_dados->>'id' or (p_dados ? 'numero' and numero::text = p_dados->>'numero') limit 1;
  if v.id is null and coalesce(p_dados->>'novo_id', '') = '' then raise exception 'pedido de peça não encontrado'; end if;
  if v.id is null then
    insert into central_pecas (id, peca, aparelho, quantidade, fornecedor_id, os_numero, cliente, status, valor, previsao, observacoes)
    values (p_dados->>'novo_id', trim(p_dados->>'peca'), nullif(p_dados->>'aparelho', ''), coalesce((p_dados->>'quantidade')::int, 1),
      nullif(p_dados->>'fornecedor_id', ''), nullif(p_dados->>'os_numero', ''), nullif(p_dados->>'cliente', ''),
      coalesce(nullif(p_dados->>'status', ''), 'a_pedir'), (p_dados->>'valor')::numeric, v_prev, nullif(p_dados->>'observacoes', ''))
    returning * into v;
  else
    update central_pecas set
      peca = case when p_dados ? 'peca' then trim(p_dados->>'peca') else peca end,
      aparelho = case when p_dados ? 'aparelho' then nullif(p_dados->>'aparelho', '') else aparelho end,
      quantidade = case when p_dados ? 'quantidade' then (p_dados->>'quantidade')::int else quantidade end,
      fornecedor_id = case when p_dados ? 'fornecedor_id' then nullif(p_dados->>'fornecedor_id', '') else fornecedor_id end,
      os_numero = case when p_dados ? 'os_numero' then nullif(p_dados->>'os_numero', '') else os_numero end,
      status = case when p_dados ? 'status' then p_dados->>'status' else status end,
      valor = case when p_dados ? 'valor' then (p_dados->>'valor')::numeric else valor end,
      previsao = case when p_dados ? 'previsao' then v_prev else previsao end,
      observacoes = case when p_dados ? 'observacoes' then nullif(p_dados->>'observacoes', '') else observacoes end,
      atualizado = now()
    where id = v.id returning * into v;
  end if;
  return to_jsonb(v) || jsonb_build_object('fornecedor', (select jsonb_build_object('id', f.id, 'nome', f.nome, 'whatsapp', f.whatsapp) from central_fornecedores f where f.id = v.fornecedor_id));
end;
$$;
revoke all on function public.central_peca_salvar(text, jsonb) from public;
grant execute on function public.central_peca_salvar(text, jsonb) to anon, authenticated;

-- Lista os pedidos: p_status = 'abertos' (a pedir, cotando, pedido) | 'todos' | um status; p_busca na peça, aparelho, OS e fornecedor
create or replace function public.central_pecas_listar(chave text, p_status text, p_busca text, p_limite integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return coalesce((
    select jsonb_agg(y.x order by y.ordem, y.atualizado desc)
    from (
      select to_jsonb(p) || jsonb_build_object('fornecedor', case when f.id is null then null else jsonb_build_object('id', f.id, 'nome', f.nome, 'whatsapp', f.whatsapp) end) as x,
        array_position(array['a_pedir', 'cotando', 'pedido', 'chegou', 'cancelado'], p.status) as ordem, p.atualizado
      from central_pecas p left join central_fornecedores f on f.id = p.fornecedor_id
      where (coalesce(p_status, 'abertos') = 'todos'
          or (coalesce(p_status, 'abertos') = 'abertos' and p.status in ('a_pedir', 'cotando', 'pedido'))
          or p.status = p_status)
        and (coalesce(p_busca, '') = '' or concat_ws(' ', p.peca, p.aparelho, p.os_numero, p.cliente, f.nome, p.numero::text) ilike '%' || p_busca || '%')
      order by array_position(array['a_pedir', 'cotando', 'pedido', 'chegou', 'cancelado'], p.status), p.atualizado desc
      limit least(greatest(coalesce(p_limite, 50), 1), 100)
    ) y(x, ordem, atualizado)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.central_pecas_listar(text, text, text, integer) from public;
grant execute on function public.central_pecas_listar(text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Configurações guardadas pela Central (ex.: a autorização do Spotify, já criptografada pela Central).
create table if not exists public.central_config (
  nome text primary key check (char_length(nome) between 1 and 60),
  valor text check (char_length(valor) <= 4000),
  atualizado timestamptz not null default now()
);
alter table public.central_config enable row level security;
revoke all on public.central_config from anon, authenticated;

create or replace function public.central_config_ler(chave text, p_nome text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  return (select c.valor from central_config c where c.nome = p_nome);
end;
$$;
revoke all on function public.central_config_ler(text, text) from public;
grant execute on function public.central_config_ler(text, text) to anon, authenticated;

-- p_valor vazio apaga
create or replace function public.central_config_salvar(chave text, p_nome text, p_valor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform painel_checar(chave);
  if coalesce(p_valor, '') = '' then delete from central_config where nome = p_nome; return; end if;
  insert into central_config (nome, valor, atualizado) values (p_nome, p_valor, now())
  on conflict (nome) do update set valor = excluded.valor, atualizado = now();
end;
$$;
revoke all on function public.central_config_salvar(text, text, text) from public;
grant execute on function public.central_config_salvar(text, text, text) to anon, authenticated;
