// auth.js — Guard de sesión y control de acceso
//
// Roles:
//   'admin'       → en tabla usuarios_permitidos (flujo existente, acceso total)
//   'profesional' → en tabla user_profiles con rol='profesional'
//   'admin_area'  → en user_profiles con rol='admin_area' (vistas de profesional + crear sesiones)
//   'pendiente'   → en user_profiles con rol='pendiente' (esperando aprobación admin)

let usuarioActual = null; // { email, nombre, rol, profesionalId }

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    _irALogin();
    return null;
  }

  // getSession() solo lee el token guardado en el dispositivo: un usuario borrado
  // de Supabase Auth seguiría "adentro" hasta que venza. getUser() lo valida
  // contra el servidor y falla si el usuario ya no existe.
  const user = await _validarUsuarioEnServidor();
  if (!user) {
    await _cerrarSesionLocal();
    _irALogin('no_autorizado');
    return null;
  }

  const email = user.email;
  const uid   = user.id;

  // ── 1. Verificar si es admin (tabla usuarios_permitidos) ──────────────────
  const { data: permitido } = await supabaseClient
    .from('usuarios_permitidos')
    .select('email, nombre, activo')
    .eq('email', email)
    .maybeSingle();

  if (permitido && permitido.activo !== false) {
    usuarioActual = {
      email,
      nombre:        permitido.nombre || email.split('@')[0],
      rol:           'admin',
      profesionalId: null,
    };
    _watchSignOut();
    return usuarioActual;
  }

  // ── 2. Verificar perfil en user_profiles ──────────────────────────────────
  let { data: perfil } = await supabaseClient
    .from('user_profiles')
    .select('*')
    .eq('auth_user_id', uid)
    .maybeSingle();

  if (!perfil) {
    // Primer login: crear perfil pendiente
    const { error } = await supabaseClient.from('user_profiles').insert({
      auth_user_id: uid,
      email,
      rol: 'pendiente',
    });
    if (error) console.error('Error creando perfil pendiente:', error);
    perfil = { rol: 'pendiente', email, profesional_id: null };
  }

  if (perfil.rol === 'pendiente') {
    usuarioActual = { email, nombre: email.split('@')[0], rol: 'pendiente', profesionalId: null };
    _watchSignOut();
    return usuarioActual; // la app muestra pantalla de "pendiente"
  }

  if (perfil.rol === 'profesional' || perfil.rol === 'admin_area' || perfil.rol === 'admin') {
    usuarioActual = {
      email,
      nombre:        email.split('@')[0],
      rol:           perfil.rol,
      profesionalId: perfil.profesional_id || null,
    };
    _watchSignOut();
    return usuarioActual;
  }

  // Estado desconocido
  await supabaseClient.auth.signOut();
  _irALogin('no_autorizado');
  return null;
}

// Devuelve el usuario si el servidor lo reconoce; null si ya no existe o el
// token es inválido. Ante un error de red devuelve el de la sesión local para
// no echar a nadie por una conexión caída (el celular pierde señal seguido).
async function _validarUsuarioEnServidor() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (data?.user) return data.user;
  const rechazado = error && (
    [400, 401, 403, 404].includes(error.status) ||
    ['user_not_found', 'session_not_found', 'bad_jwt', 'refresh_token_not_found'].includes(error.code)
  );
  if (rechazado) return null;
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.user || null;
}

async function _cerrarSesionLocal() {
  try { await supabaseClient.auth.signOut({ scope: 'local' }); } catch (_) { /* usuario ya borrado */ }
}

// Si la app queda abierta (típico en el celular), revalida al volver a primer plano.
let _ultimaRevalidacion = 0;
function _revalidarAlVolver() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - _ultimaRevalidacion < 60000) return;
    _ultimaRevalidacion = Date.now();
    if (!(await _validarUsuarioEnServidor())) {
      await _cerrarSesionLocal();
      _irALogin('no_autorizado');
    }
  });
}

let _watching = false;
function _watchSignOut() {
  if (_watching) return;
  _watching = true;
  _revalidarAlVolver();
  supabaseClient.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') _irALogin();
  });
}

function _irALogin(motivo) {
  const params = motivo ? `?motivo=${motivo}` : '';
  window.location.href = `login.html${params}`;
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}
