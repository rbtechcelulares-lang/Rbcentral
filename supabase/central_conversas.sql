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
  etapa text not null default 'novo' check (etapa in ('novo', 'em_atendimento', 'orcamento', 'negociando', 'comprou', 'perdido', 'pos_venda')),
  interesse text check (char_length(interesse) <= 200),
  resumo text check (char_length(resumo) <= 600),
  proxima_acao text check (char_length(proxima_acao) <= 200),
  valor numeric check (valor >= 0),
  analisado timestamptz
);
create index if not exists central_wa_contatos_ultimo_idx on public.central_wa_contatos (ultimo_contato desc);
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

-- Lista os contatos: p_filtro = 'todos' | 'sem_resposta' | 'para_analisar' | uma etapa; p_busca procura em nome, número, interesse e resumo
create or replace function public.central_wa_listar(chave text, p_filtro text, p_busca text, p_limite integer)
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
      select numero, nome, primeiro_contato, ultimo_contato, ultima_msg, ultima_de, msgs_novas, etapa, interesse, resumo, proxima_acao, valor, analisado
      from central_wa_contatos
      where (coalesce(p_filtro, 'todos') = 'todos'
          or (p_filtro = 'sem_resposta' and ultima_de = 'cliente')
          or (p_filtro = 'para_analisar' and msgs_novas > 0)
          or etapa = p_filtro)
        and (coalesce(p_busca, '') = ''
          or concat_ws(' ', nome, numero, interesse, resumo, ultima_msg) ilike '%' || p_busca || '%'
          or exists (select 1 from central_wa_mensagens m where m.numero = central_wa_contatos.numero and m.texto ilike '%' || p_busca || '%'))
      order by ultimo_contato desc
      limit least(greatest(coalesce(p_limite, 30), 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.central_wa_listar(text, text, text, integer) from public;
grant execute on function public.central_wa_listar(text, text, text, integer) to anon, authenticated;

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
begin
  perform painel_checar(chave);
  update central_wa_contatos set
    etapa = case when p_dados->>'etapa' in ('novo', 'em_atendimento', 'orcamento', 'negociando', 'comprou', 'perdido', 'pos_venda') then p_dados->>'etapa' else etapa end,
    interesse = left(nullif(p_dados->>'interesse', ''), 200),
    resumo = left(nullif(p_dados->>'resumo', ''), 600),
    proxima_acao = left(nullif(p_dados->>'proxima_acao', ''), 200),
    valor = case when (p_dados->>'valor') ~ '^[0-9]+(\.[0-9]+)?$' and (p_dados->>'valor')::numeric > 0 then (p_dados->>'valor')::numeric else null end,
    msgs_novas = 0,
    analisado = now()
  where numero = p_numero;
end;
$$;
revoke all on function public.central_wa_salvar_analise(text, text, jsonb) from public;
grant execute on function public.central_wa_salvar_analise(text, text, jsonb) to anon, authenticated;
