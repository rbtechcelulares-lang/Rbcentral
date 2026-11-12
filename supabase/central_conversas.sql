-- RB Central · histórico das 6 últimas conversas (o mesmo no iPhone e no computador)
-- e contador diário de uso, e avisos de status de OS esperando confirmação.
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
