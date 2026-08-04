# Puesta en marcha: GitHub Pages + Supabase + Login con Google

Pasos que tenés que hacer vos con tus cuentas. El código ya está listo, solo falta conectar credenciales.

## 1. Crear el proyecto en Supabase

1. Entrá a [supabase.com](https://supabase.com), creá cuenta/proyecto (elegí una región cercana, ej. `sa-east-1`).
2. Anotá **Project Settings → API**: `Project URL` y `anon public key`.
3. Pegalos en [`js/supabase-config.js`](js/supabase-config.js) en `SUPABASE_URL` y `SUPABASE_ANON_KEY`.

## 2. Correr el esquema SQL

1. Dashboard → **SQL Editor → New query**.
2. Pegá todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecutá.
3. Cargá el equipo permitido — en el mismo SQL Editor:
   ```sql
   insert into usuarios_permitidos (email, nombre) values
     ('persona1@gmail.com', 'Nombre Apellido'),
     ('persona2@gmail.com', 'Nombre Apellido');
   ```

## 3. Habilitar login con Google

1. Dashboard → **Authentication → Providers → Google** → activar.
2. Necesitás un Client ID/Secret de Google: en [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials → Create OAuth client ID** (tipo "Web application").
3. En "Authorized redirect URIs" de Google, agregá la URL que te muestra Supabase en esa misma pantalla (algo como `https://TU_PROYECTO.supabase.co/auth/v1/callback`).
4. Pegá el Client ID y Secret de Google en la pantalla de Supabase y guardá.
5. En Supabase → **Authentication → URL Configuration**, agregá tu URL final de GitHub Pages (ej. `https://tuusuario.github.io/turepo/`) como Redirect URL permitida.

## 4. Subir el repo a GitHub y activar Pages

1. Creá el repo público en GitHub, subí todo el contenido de esta carpeta.
2. **Settings → Pages** → Source: `main` branch, carpeta `/ (root)`.
3. Esperá el deploy (unos minutos) y anotá la URL pública.

## 5. Migrar los datos actuales

1. Abrí tu app actual (la de siempre, local) y usá el botón **⬇ Exportar** del sidebar. Se descarga `rehab_datos_*.json`.
2. Entrá a tu sitio ya publicado en GitHub Pages, iniciá sesión con Google.
3. Andá a `tuusuario.github.io/turepo/migrar.html`, elegí el archivo exportado y tocá "Migrar a Supabase".
4. Revisá el log: debería confirmar cuántos pacientes/profesionales/etc. se subieron.
5. Listo — a partir de ahora `index.html` y `viewer.html` ya leen y escriben directo en Supabase.

## 6. Verificar

- `index.html`: pide login con Google, solo entra gente en `usuarios_permitidos`.
- Abrí el sitio en dos pestañas/dispositivos con dos cuentas distintas: en el sidebar de cada una debería verse "Conectados ahora" con la otra persona, y si ambos entran a la misma sección aparece el aviso amarillo arriba.
- `viewer.html` (pantalla pública) no pide login y se actualiza solo cada 30s.

## Notas

- La `anon key` de Supabase es pública a propósito; la seguridad la da la tabla `usuarios_permitidos` + RLS (`supabase/schema.sql`). Para dar de baja a alguien: `update usuarios_permitidos set activo = false where email = '...'`.
- Si en el futuro agregás/sacás gente del equipo, se hace directo por SQL Editor, no hace falta tocar código.
- `migrar.html` y `js/migrar_a_supabase.js` solo se usan una vez; se pueden borrar del repo después si querés, pero no molestan si quedan.
