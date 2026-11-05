-- permisos_profesionales.sql — Escritura acotada para profesional y admin de área.
-- Un profesional (o admin de área) solo puede:
--   * avisar inasistencia / cambio de horario de SU profesional en un día puntual
--   * editar campos permitidos de SU perfil de profesional
-- Se hace con funciones SECURITY DEFINER (no se abren las tablas con RLS):
-- el profesional se deduce de user_profiles.profesional_id del usuario autenticado.
-- Se puede volver a correr sin problemas.

create or replace function public.guardar_aviso_profesional(p_fecha date, p_aviso jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof text;
  v_borrar boolean := (p_aviso is null or jsonb_typeof(p_aviso) = 'null');
begin
  select profesional_id into v_prof
    from public.user_profiles
   where auth_user_id = auth.uid() and rol in ('profesional', 'admin_area');
  if v_prof is null then
    raise exception 'Tu usuario no está vinculado a un profesional';
  end if;

  insert into public.dias_state (fecha, data)
  values (p_fecha, jsonb_build_object('avisosProfesionales',
           case when v_borrar then '{}'::jsonb else jsonb_build_object(v_prof, p_aviso) end))
  on conflict (fecha) do update
    set data = jsonb_set(
      public.dias_state.data, '{avisosProfesionales}',
      case when v_borrar
        then coalesce(public.dias_state.data -> 'avisosProfesionales', '{}'::jsonb) - v_prof
        else coalesce(public.dias_state.data -> 'avisosProfesionales', '{}'::jsonb)
             || jsonb_build_object(v_prof, p_aviso)
      end, true);
end;
$$;

create or replace function public.actualizar_mi_perfil(p_cambios jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof text;
  v_permitidos jsonb;
begin
  select profesional_id into v_prof
    from public.user_profiles
   where auth_user_id = auth.uid() and rol in ('profesional', 'admin_area');
  if v_prof is null then
    raise exception 'Tu usuario no está vinculado a un profesional';
  end if;

  -- Solo estos campos: nada de disciplinas, cuota, exclusiones, etc.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_permitidos
    from jsonb_each(p_cambios)
   where key in ('diasLaborales', 'tieneManana', 'tieneTarde', 'gruposPreferencia', 'horariosPorDia');

  update public.profesionales set data = data || v_permitidos where id = v_prof;
end;
$$;

revoke all on function public.guardar_aviso_profesional(date, jsonb) from public, anon;
revoke all on function public.actualizar_mi_perfil(jsonb) from public, anon;
grant execute on function public.guardar_aviso_profesional(date, jsonb) to authenticated;
grant execute on function public.actualizar_mi_perfil(jsonb) to authenticated;
