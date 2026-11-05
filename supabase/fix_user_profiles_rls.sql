-- fix_user_profiles_rls.sql — Cierra una escalada de privilegios en user_profiles.
-- Con las políticas anteriores, cualquier usuario autenticado podía:
--   * actualizar su propia fila (incluida la columna rol) -> hacerse 'admin'
--   * insertar su fila con rol='admin'
-- y is_allowed_user() da acceso total a quien tenga rol='admin' en user_profiles.

drop policy if exists "actualizar_perfiles" on user_profiles;  -- los cambios de rol los hace un admin (admin_update_user_profiles)

drop policy if exists "insertar_propio" on user_profiles;
create policy "insertar_propio" on user_profiles
  for insert to authenticated
  with check (auth_user_id = auth.uid() and rol = 'pendiente');
