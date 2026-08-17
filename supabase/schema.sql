-- schema.sql — Esquema Supabase para RehabClinic
--
-- Cómo usarlo: pegar todo este archivo en el SQL Editor de Supabase
-- (Dashboard → SQL Editor → New query) y ejecutar una sola vez.
--
-- Diseño: cada tabla espeja la forma actual de localStorage con una columna
-- JSONB, para minimizar el refactor del front-end (js/data.js). Esto permite
-- migrar sin normalizar todo el modelo de entidades.

-- ─── Tabla de usuarios permitidos (allowlist) ─────────────────────────────────
-- Solo estos emails (los que inician sesión con Google) pueden leer/escribir datos.

create table if not exists usuarios_permitidos (
  email  text primary key,
  nombre text,
  activo boolean not null default true
);

-- Completar acá con los emails reales del equipo antes o después de correr el resto:
-- insert into usuarios_permitidos (email, nombre) values
--   ('persona1@gmail.com', 'Nombre Apellido'),
--   ('persona2@gmail.com', 'Nombre Apellido');

-- ─── Función helper: ¿el usuario autenticado está en la allowlist? ────────────

create or replace function is_allowed_user()
returns boolean
language sql
security invoker
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_permitidos
    where email = auth.jwt() ->> 'email'
      and activo = true
  );
$$;

-- ─── Tablas de datos ───────────────────────────────────────────────────────────

create table if not exists pacientes (
  id   text primary key,
  data jsonb not null
);

create table if not exists profesionales (
  id   text primary key,
  data jsonb not null
);

create table if not exists planes (
  paciente_id text primary key,
  sesiones    jsonb not null default '{}',
  meta        jsonb
);

create table if not exists dias_state (
  fecha date primary key,
  data  jsonb not null
);

create table if not exists asignaciones (
  fecha    date primary key,
  sesiones jsonb not null default '[]'
);

create table if not exists historial (
  id             bigint generated always as identity primary key,
  fecha          date not null,
  profesional_id text,
  paciente_id    text,
  disciplina     text
);

create table if not exists auditoria (
  id        text primary key,
  timestamp timestamptz not null default now(),
  data      jsonb not null
);

-- ─── Row Level Security: solo usuarios de la allowlist ────────────────────────

alter table pacientes           enable row level security;
alter table profesionales       enable row level security;
alter table planes              enable row level security;
alter table dias_state          enable row level security;
alter table asignaciones        enable row level security;
alter table historial           enable row level security;
alter table auditoria           enable row level security;
alter table usuarios_permitidos enable row level security;

-- Una política genérica de "todo permitido si estás en la allowlist" por tabla.
-- (Postgres no permite reutilizar una política entre tablas, así que se repite.)

create policy "allowlist_all" on pacientes
  for all using (is_allowed_user()) with check (is_allowed_user());

create policy "allowlist_all" on profesionales
  for all using (is_allowed_user()) with check (is_allowed_user());

create policy "allowlist_all" on planes
  for all using (is_allowed_user()) with check (is_allowed_user());

create policy "allowlist_all" on dias_state
  for all using (is_allowed_user()) with check (is_allowed_user());

create policy "allowlist_all" on asignaciones
  for all using (is_allowed_user()) with check (is_allowed_user());

create policy "allowlist_all" on historial
  for all using (is_allowed_user()) with check (is_allowed_user());

create policy "allowlist_all" on auditoria
  for all using (is_allowed_user()) with check (is_allowed_user());

-- usuarios_permitidos: cualquier usuario autenticado puede leer (para poder
-- validar la allowlist en el propio front-end), pero solo se edita a mano
-- desde el SQL Editor (nadie tiene permiso de escritura vía la app).
create policy "lectura_autenticados" on usuarios_permitidos
  for select using (auth.role() = 'authenticated');

-- ─── Lectura pública para viewer.html (pantalla de sala, sin login) ───────────
-- viewer.html es de solo lectura y corre en una pantalla pública de la clínica,
-- por eso no exige login. Solo se habilita SELECT (nunca insert/update/delete);
-- esas operaciones siguen protegidas por la policy "allowlist_all" de arriba.

create policy "lectura_publica" on pacientes      for select using (true);
create policy "lectura_publica" on profesionales  for select using (true);
create policy "lectura_publica" on asignaciones   for select using (true);
create policy "lectura_publica" on dias_state     for select using (true);

-- ─── Realtime: habilitar para presencia de cambios en vivo ────────────────────

alter publication supabase_realtime add table pacientes;
alter publication supabase_realtime add table profesionales;
alter publication supabase_realtime add table planes;
alter publication supabase_realtime add table dias_state;
alter publication supabase_realtime add table asignaciones;
alter publication supabase_realtime add table historial;
alter publication supabase_realtime add table auditoria;
