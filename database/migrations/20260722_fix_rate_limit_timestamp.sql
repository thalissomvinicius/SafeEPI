-- Evita a colisao entre a variavel PL/pgSQL e a palavra reservada CURRENT_TIME.
-- A colisao convertia o valor em timetz e quebrava todas as chamadas do limitador.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.api_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if length(p_key) < 8 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_parameters';
  end if;

  insert into public.api_rate_limits (
    key_hash,
    request_count,
    window_started_at,
    expires_at
  ) values (
    p_key,
    1,
    v_now,
    v_now + make_interval(secs => p_window_seconds)
  )
  on conflict (key_hash) do update
  set
    request_count = case
      when api_rate_limits.expires_at <= v_now then 1
      else api_rate_limits.request_count + 1
    end,
    window_started_at = case
      when api_rate_limits.expires_at <= v_now then v_now
      else api_rate_limits.window_started_at
    end,
    expires_at = case
      when api_rate_limits.expires_at <= v_now
        then v_now + make_interval(secs => p_window_seconds)
      else api_rate_limits.expires_at
    end
  returning * into current_row;

  allowed := current_row.request_count <= p_limit;
  retry_after := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (current_row.expires_at - v_now)))::integer)
  end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
