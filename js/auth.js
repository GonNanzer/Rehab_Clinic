// auth.js — Guard de sesión y control de acceso
//
// Roles:
//   'admin'       → en tabla usuarios_permitidos (flujo existente, acceso total)
//   'profesional' → en tabla user_profiles con rol='profesional'
//   'pendiente'   → en user_profiles con rol='pendiente' (esperando aprobación admin)

let usuarioActual = null; // { email, nombre, rol, profesionalId }

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    _irALogin();
    return null;
  }

  const email = session.user.email;
  const uid   = session.user.id;

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

  if (perfil.rol === 'profesional' || perfil.rol === 'admin') {
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

function _watchSignOut() {
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
