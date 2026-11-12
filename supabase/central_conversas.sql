-- RB Central · histórico das 6 últimas conversas, o mesmo no iPhone e no computador.
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
