// auth.js — Guard de sesión y control de acceso (allowlist)
//
// Se usa desde index.html y viewer.html. Antes de cargar datos, cada página
// debe llamar a requireAuth() y esperar a que resuelva. Si no hay sesión
// válida o el email no está en la allowlist, redirige a login.html.

let usuarioActual = null; // { email, nombre }

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    _irALogin();
    return null;
  }

  const email = session.user.email;

  const { data: permitido, error } = await supabaseClient
    .from('usuarios_permitidos')
    .select('email, nombre, activo')
    .eq('email', email)
    .maybeSingle();

  if (error || !permitido || permitido.activo === false) {
    await supabaseClient.auth.signOut();
    _irALogin('no_autorizado');
    return null;
  }

  usuarioActual = { email, nombre: permitido.nombre || email.split('@')[0] };

  // Reaccionar si la sesión expira o el usuario cierra sesión en otra pestaña
  supabaseClient.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') _irALogin();
  });

  return usuarioActual;
}

function _irALogin(motivo) {
  const params = motivo ? `?motivo=${motivo}` : '';
  window.location.href = `login.html${params}`;
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}
