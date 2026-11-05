-- admins_gestionan_usuarios.sql — Cualquier admin (allowlist o rol='admin' en
-- user_profiles) puede aprobar, editar y revocar usuarios. El admin de área
-- y el profesional NO pueden.
-- is_allowed_user() ya cubre ambos tipos de admin. Se puede volver a correr.

drop policy if exists "admin_update_user_profiles" on user_profiles;
create policy "admin_update_user_profiles" on user_profiles
  for update to authenticated
  using (is_allowed_user()) with check (is_allowed_user());

drop policy if exists "admin_delete_user_profiles" on user_profiles;
create policy "admin_delete_user_profiles" on user_profiles
  for delete to authenticated
  using (is_allowed_user());

-- Cierre de la escalada de privilegios (ver fix_user_profiles_rls.sql):
-- nadie puede cambiarse el rol a sí mismo ni insertarse como admin.
drop policy if exists "actualizar_perfiles" on user_profiles;
drop policy if exists "insertar_propio" on user_profiles;
create policy "insertar_propio" on user_profiles
  for insert to authenticated
  with check (auth_user_id = auth.uid() and rol = 'pendiente');
