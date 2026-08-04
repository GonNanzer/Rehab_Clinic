// presence.js — Quién está conectado ahora mismo (Supabase Realtime Presence)
//
// Cada pestaña abierta hace "track" de su usuario y la vista (sección) en la
// que está parado. El canal se sincroniza sola entre todos los clientes:
// - Sidebar: lista de usuarios conectados (excluyéndome a mí).
// - Banner: si alguien más está en la misma vista que yo ahora mismo.

let _canalPresencia = null;
let _usuarioPresencia = null;

function iniciarPresencia(usuario) {
  if (typeof supabaseClient === 'undefined') return;
  _usuarioPresencia = usuario;

  _canalPresencia = supabaseClient.channel('rehab-presencia', {
    config: { presence: { key: usuario.email } }
  });

  _canalPresencia
    .on('presence', { event: 'sync' }, _renderPresencia)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await _canalPresencia.track({
          nombre: usuario.nombre,
          email: usuario.email,
          vista: (typeof vistaActiva !== 'undefined' ? vistaActiva : null),
          conectadoEn: new Date().toISOString()
        });
      }
    });
}

function actualizarVistaPresencia(vista) {
  if (!_canalPresencia) return;
  _canalPresencia.track({
    nombre: _usuarioPresencia.nombre,
    email: _usuarioPresencia.email,
    vista,
    conectadoEn: new Date().toISOString()
  });
  _renderPresencia(); // refrescar el banner ya mismo con mi propia vista nueva
}

function _inicialesDe(nombre) {
  return (nombre || '?')
    .split(' ')
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function _renderPresencia() {
  const estado = _canalPresencia.presenceState();
  const otros = Object.entries(estado)
    .filter(([email]) => email !== _usuarioPresencia.email)
    .map(([, presencias]) => presencias[0]);

  // Lista en el sidebar
  const cont = document.getElementById('presencia-lista');
  if (cont) {
    cont.innerHTML = otros.length
      ? otros.map(p => `
          <div class="presencia-item">
            <span class="presencia-avatar">${_inicialesDe(p.nombre)}</span>
            <span class="presencia-nombre">${p.nombre}</span>
          </div>
        `).join('')
      : `<div class="presencia-vacio">Sos el único conectado</div>`;
  }

  // Banner: alguien más está en la misma vista ahora
  const bannerWrap = document.getElementById('banner-coedicion-wrap');
  if (bannerWrap) {
    const enMismaVista = otros.filter(p => p.vista === vistaActiva);
    bannerWrap.innerHTML = enMismaVista.length
      ? `<div class="banner-coedicion">
           👀 ${enMismaVista.map(p => p.nombre).join(', ')} también ${enMismaVista.length > 1 ? 'están' : 'está'} viendo esta sección ahora.
         </div>`
      : '';
  }
}
