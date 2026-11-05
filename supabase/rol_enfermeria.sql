-- rol_enfermeria.sql — Agrega el rol 'enfermeria' (solo horarios de baño de pacientes).
-- Ejecutar en el SQL Editor de Supabase. Se puede volver a correr sin problemas.
--
-- Enfermería NO tiene permisos de escritura sobre ninguna tabla. Lo único que puede
-- hacer es llamar a guardar_banos_pacientes(), que:
--   * solo toca pacientes.data -> 'bañosSemana' y 'bañosSemanaFecha' (nada más)
--   * no crea ni borra pacientes
--   * registra la entrada de auditoría en la misma operación
-- Los usuarios con este rol no se vinculan a un profesional (profesional_id = null),
-- así que nunca forman parte de la asignación de terapias de la agenda diaria.

-- 1) Permitir el valor 'enfermeria' en user_profiles.rol
alter table user_profiles drop constraint if exists user_profiles_rol_check;
alter table user_profiles add constraint user_profiles_rol_check
  check (rol in ('pendiente', 'profesional', 'admin_area', 'enfermeria', 'admin'));

-- 2) Escritura acotada de horarios de baño
--    p_banos:     { "<pacienteId>": { "bañosSemana": [...], "bañosSemanaFecha": "<iso>" }, ... }
--    p_auditoria: { "id": "...", ...resto de la entrada de auditoría }  (opcional)
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
    if jsonb_typeof(v_item.value -> 'bañosSemana') <> 'array' then
      raise exception 'bañosSemana inválido para el paciente %', v_item.key;
    end if;

    update public.pacientes
       set data = data || jsonb_build_object(
             'bañosSemana',      v_item.value -> 'bañosSemana',
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
