-- rol_admin_area.sql — Agrega el rol 'admin_area' (perfil profesional + crear sesiones).
-- Ejecutar en el SQL Editor de Supabase. Revisar antes de correr: no vi las
-- políticas reales de user_profiles/asignaciones en el proyecto, solo schema.sql.

-- 1) Permitir el valor 'admin_area' si user_profiles tiene un CHECK sobre rol.
alter table user_profiles drop constraint if exists user_profiles_rol_check;
alter table user_profiles add constraint user_profiles_rol_check
  check (rol in ('pendiente', 'profesional', 'admin_area', 'admin'));

-- 2) Helper: ¿el usuario autenticado es admin de área?
create or replace function is_area_admin()
returns boolean
language sql
security invoker
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid() and rol = 'admin_area'
  );
$$;

-- 3) Escritura de sesiones (Nueva sesión fija escribe asignaciones, auditoria e historial).
create policy "area_admin_asignaciones" on asignaciones
  for all using (is_area_admin()) with check (is_area_admin());
create policy "area_admin_auditoria" on auditoria
  for insert with check (is_area_admin());
create policy "area_admin_historial" on historial
  for insert with check (is_area_admin());
-- Lectura: los datos que ya ve un profesional (pacientes, profesionales, planes,
-- dias_state) se asumen cubiertos por las políticas existentes para ese rol.
