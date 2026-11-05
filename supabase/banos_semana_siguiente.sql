-- banos_semana_siguiente.sql — Horarios de baño por semana (actual y siguiente).
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de rol_enfermeria.sql. Se puede re-ejecutar.
--
-- Formato nuevo: pacientes.data -> 'bañosPorSemana' = { "YYYY-MM-DD" (lunes): [ ...baños ] }
-- El formato anterior ('bañosSemana', una sola semana) lo migra la app y la función de limpieza.
-- Los datos de semanas vencidas no se usan aunque sigan guardados; esto solo los borra.

-- 1) RPC de Enfermería: ahora recibe bañosPorSemana y elimina el campo anterior.
create or replace function public.guardar_banos_pacientes(p_banos jsonb, p_auditoria jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  if not exists (
    select 1 from public.user_profiles
     where auth_user_id = auth.uid() and rol = 'enfermeria'
  ) then
    raise exception 'Tu usuario no tiene permiso para modificar horarios de baño';
  end if;

  if p_banos is null or jsonb_typeof(p_banos) <> 'object' then
    raise exception 'Formato inválido';
  end if;

  for v_item in select key, value from jsonb_each(p_banos) loop
    if jsonb_typeof(v_item.value -> 'bañosPorSemana') <> 'object' then
      raise exception 'bañosPorSemana inválido para el paciente %', v_item.key;
    end if;

    update public.pacientes
       set data = (data - 'bañosSemana') || jsonb_build_object(
             'bañosPorSemana',   v_item.value -> 'bañosPorSemana',
             'bañosSemanaFecha', coalesce(v_item.value -> 'bañosSemanaFecha', 'null'::jsonb))
     where id = v_item.key;
  end loop;

  if p_auditoria is not null and jsonb_typeof(p_auditoria) = 'object'
     and (p_auditoria ->> 'id') is not null then
    insert into public.auditoria (id, "timestamp", data)
    values (p_auditoria ->> 'id', now(), p_auditoria)
    on conflict (id) do nothing;
  end if;
end;
$$;

revoke all on function public.guardar_banos_pacientes(jsonb, jsonb) from public, anon;
grant execute on function public.guardar_banos_pacientes(jsonb, jsonb) to authenticated;

-- 2) Limpieza de semanas vencidas (y migración del formato anterior).
--    "Semana vigente" = la que contiene (ahora en Buenos Aires + 2 minutos): así, si corre
--    el domingo a las 23:59, ya considera terminada la semana que cierra.
create or replace function public.limpiar_banos_semanas_vencidas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz     constant text := 'America/Argentina/Buenos_Aires';
  v_lunes  text := to_char(date_trunc('week', (now() at time zone v_tz) + interval '2 minutes')::date, 'YYYY-MM-DD');
  v_filas  integer;
begin
  update public.pacientes p
     set data = (p.data - 'bañosSemana') || jsonb_build_object(
       'bañosPorSemana',
       coalesce((
         select jsonb_object_agg(e.key, e.value)
           from jsonb_each(
             case
               when jsonb_typeof(p.data -> 'bañosPorSemana') = 'object' then p.data -> 'bañosPorSemana'
               when jsonb_typeof(p.data -> 'bañosSemana') = 'array'
                    and jsonb_array_length(p.data -> 'bañosSemana') > 0
                    and coalesce(to_char(date_trunc('week',
                          ((p.data ->> 'bañosSemanaFecha')::timestamptz at time zone v_tz))::date, 'YYYY-MM-DD'), v_lunes) >= v_lunes
                 then jsonb_build_object(v_lunes, p.data -> 'bañosSemana')
               else '{}'::jsonb
             end) as e
          where e.key >= v_lunes and jsonb_array_length(e.value) > 0
       ), '{}'::jsonb))
   where p.data ? 'bañosSemana' or p.data ? 'bañosPorSemana';

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- Solo el scheduler (rol postgres) y el SQL Editor la ejecutan; nadie desde la app.
revoke all on function public.limpiar_banos_semanas_vencidas() from public, anon, authenticated;

-- 3) OPCIONAL — ejecución automática los domingos a las 23:59 (hora de Buenos Aires).
--    Requiere habilitar la extensión pg_cron (Database → Extensions → pg_cron).
--    pg_cron usa UTC: domingo 23:59 ART (UTC-3, sin horario de verano) = lunes 02:59 UTC.
--    Descomentar y ejecutar una sola vez:
--
-- select cron.schedule(
--   'limpiar-banos-semanales',
--   '59 2 * * 1',
--   $cron$ select public.limpiar_banos_semanas_vencidas(); $cron$
-- );
--
-- Para quitarlo:  select cron.unschedule('limpiar-banos-semanales');
