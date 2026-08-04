// persistence.js — Capa de persistencia en archivos locales
//
// Dos mecanismos disponibles:
//   1. Exportar / Importar JSON  →  funciona en todos los navegadores
//   2. Archivo vinculado         →  Chrome/Edge: auto-guardado transparente
//
// El localStorage sigue siendo el "buffer de trabajo" en memoria.
// Este módulo lo lee para guardar a disco y lo escribe cuando carga desde disco.

const PERSIST_VERSION = '1.0';

// ¿El navegador soporta File System Access API?
const SOPORTA_FILE_SYSTEM = typeof window.showSaveFilePicker === 'function';

let archivoVinculado   = null;   // FileSystemFileHandle activo
let cambiosPendientes  = false;
let timerAutoguardado  = null;
const DEBOUNCE_MS      = 2000;   // esperar 2s de inactividad antes de auto-guardar

// ─── IndexedDB: persiste el file handle entre recargas ───────────────────────
// Los file handles de File System Access API no se pueden guardar en localStorage,
// pero sí en IndexedDB. Así el vínculo sobrevive a cerrar y reabrir el navegador.

function _abrirIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('rehab_fs_v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
  });
}

async function _guardarHandleIDB(handle) {
  try {
    const db = await _abrirIDB();
    await new Promise((res, rej) => {
      const tx  = db.transaction('handles', 'readwrite');
      const req = tx.objectStore('handles').put(handle, 'principal');
      req.onsuccess = res; req.onerror = rej;
    });
  } catch (e) { console.warn('IDB write error:', e); }
}

async function _recuperarHandleIDB() {
  try {
    const db = await _abrirIDB();
    return await new Promise((res) => {
      const tx  = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('principal');
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => res(null);
    });
  } catch (e) { return null; }
}

async function _limpiarHandleIDB() {
  try {
    const db = await _abrirIDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('principal');
  } catch (e) { /* no-op */ }
}

// ─── Serialización: localStorage → objeto / objeto → localStorage ────────────

function _recopilarDatos() {
  return {
    version:     PERSIST_VERSION,
    exportadoEn: new Date().toISOString(),
    datos: {
      pacientes:     leerStorage(STORAGE_KEYS.pacientes,     []),
      profesionales: leerStorage(STORAGE_KEYS.profesionales, []),
      planes:        leerStorage(STORAGE_KEYS.planes,        {}),
      diasState:     leerStorage(STORAGE_KEYS.diasState,     {}),
      asignaciones:  leerStorage(STORAGE_KEYS.asignaciones,  {}),
      historial:     leerStorage(STORAGE_KEYS.historial,     []),
      auditoria:     leerStorage(STORAGE_KEYS.auditoria,     [])
    }
  };
}

function _restaurarDatos(exportacion) {
  // Acepta tanto el formato completo { version, datos } como volcados planos.
  // Pasa por escribirStorage() para que también quede en el cache en memoria
  // y se sincronice con Supabase (no solo en localStorage).
  const d = exportacion.datos ?? exportacion;
  const map = [
    [STORAGE_KEYS.pacientes,     d.pacientes],
    [STORAGE_KEYS.profesionales, d.profesionales],
    [STORAGE_KEYS.planes,        d.planes],
    [STORAGE_KEYS.diasState,     d.diasState],
    [STORAGE_KEYS.asignaciones,  d.asignaciones],
    [STORAGE_KEYS.auditoria,     d.auditoria]
  ];
  map.forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== null) escribirStorage(clave, valor);
  });
  if (Array.isArray(d.historial)) _cache.historial = d.historial;
}

// ─── 1. Exportar (descarga de archivo) ───────────────────────────────────────

function exportarJSON() {
  const payload = _recopilarDatos();
  const blob    = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  const fecha   = new Date().toISOString().split('T')[0];
  a.href        = url;
  a.download    = `rehab_datos_${fecha}.json`;
  a.click();
  URL.revokeObjectURL(url);
  _marcarGuardado();
  mostrarToast('Datos exportados correctamente', 'success');
}

// ─── 2. Importar (carga desde archivo elegido por el usuario) ────────────────

function importarJSON() {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const texto = await file.text();
      const datos = JSON.parse(texto);
      if (!datos.datos && !datos.pacientes) {
        alert('El archivo no tiene el formato esperado de RehabClinic.');
        return;
      }
      if (!confirm(`¿Cargar datos desde "${file.name}"?\nLos datos actuales en memoria serán reemplazados.`)) return;
      _restaurarDatos(datos);
      _marcarGuardado();
      if (typeof renderVista === 'function') renderVista();
      mostrarToast(`Datos cargados desde ${file.name}`, 'success');
    } catch (err) {
      alert('No se pudo leer el archivo: ' + err.message);
    }
  };
  input.click();
}

// ─── 3. Archivo vinculado (File System Access API — Chrome / Edge) ────────────

async function vincularArchivo() {
  if (!SOPORTA_FILE_SYSTEM) {
    alert(
      'Tu navegador no soporta el acceso directo a archivos.\n\n' +
      'Esta función requiere Google Chrome o Microsoft Edge.\n' +
      'Podés usar "Exportar / Importar" manualmente en cualquier navegador.'
    );
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'rehab_datos.json',
      types: [{
        description: 'Archivo de datos RehabClinic',
        accept: { 'application/json': ['.json'] }
      }]
    });
    archivoVinculado = handle;
    await _guardarHandleIDB(handle);
    await _escribirEnArchivo(handle);
    _actualizarIndicador();
    mostrarToast(`Vinculado a "${handle.name}". Los cambios se guardarán automáticamente.`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') mostrarToast('No se pudo vincular el archivo: ' + err.message, 'danger');
  }
}

async function desvincularArchivo() {
  if (!confirm('¿Desvincular el archivo? El auto-guardado se desactivará, pero los datos no se borran.')) return;
  archivoVinculado = null;
  await _limpiarHandleIDB();
  _actualizarIndicador();
  mostrarToast('Archivo desvinculado', 'info');
}

async function _escribirEnArchivo(handle) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(_recopilarDatos(), null, 2));
  await writable.close();
}

// ─── Notificación de cambios (llamada por data.js) ───────────────────────────

function onDataChanged() {
  cambiosPendientes = true;
  _actualizarIndicador();

  if (!archivoVinculado) return;

  // Auto-guardado con debounce: espera que el usuario termine de operar
  clearTimeout(timerAutoguardado);
  timerAutoguardado = setTimeout(async () => {
    try {
      await _escribirEnArchivo(archivoVinculado);
      _marcarGuardado();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        // El navegador revocó el permiso (ej: se recargó la página sin reconectar)
        archivoVinculado = null;
        _actualizarIndicador();
        mostrarToast('Permiso del archivo revocado. Guardá manualmente o reconectá el archivo.', 'warning');
      } else {
        console.warn('Error en auto-guardado:', err);
      }
    }
  }, DEBOUNCE_MS);
}

function _marcarGuardado() {
  cambiosPendientes = false;
  _actualizarIndicador();
}

// ─── Indicador visual en sidebar ──────────────────────────────────────────────

function _actualizarIndicador() {
  const el = document.getElementById('pers-status');
  if (!el) return;

  if (archivoVinculado) {
    if (cambiosPendientes) {
      el.innerHTML = `<span class="pers-dot dot-pending" title="Guardando..."></span> Guardando...`;
    } else {
      el.innerHTML = `<span class="pers-dot dot-ok" title="Guardado"></span>
        <span class="pers-filename" title="${archivoVinculado.name}">${archivoVinculado.name}</span>`;
    }
  } else {
    if (cambiosPendientes) {
      el.innerHTML = `<span class="pers-dot dot-warn"></span> Cambios sin guardar`;
    } else {
      el.innerHTML = `<span class="pers-dot dot-neutral"></span> Solo en memoria local`;
    }
  }

  // Botón vincular / desvincular
  const btnV = document.getElementById('btn-vincular-archivo');
  if (btnV) {
    btnV.textContent = archivoVinculado ? '⛓ Desvincular' : '🔗 Vincular archivo';
    btnV.onclick = archivoVinculado ? desvincularArchivo : vincularArchivo;
  }
}

// ─── Inicialización al cargar la página ──────────────────────────────────────

async function inicializarPersistencia() {
  // Con Supabase como fuente de verdad compartida, ya NO se auto-carga un
  // archivo vinculado al abrir la página: eso pisaría en silencio los datos
  // en vivo de todo el equipo con una foto vieja del archivo local. El
  // archivo vinculado, si lo hay, ahora sirve solo como backup de
  // auto-guardado (ver onDataChanged) — nunca como fuente de carga.
  _actualizarIndicador();

  if (!SOPORTA_FILE_SYSTEM) return;

  const handle = await _recuperarHandleIDB();
  if (!handle) return;

  try {
    const permiso = await handle.queryPermission({ mode: 'readwrite' });
    if (permiso === 'granted') {
      archivoVinculado = handle;
      _marcarGuardado();
    } else if (permiso === 'prompt') {
      _mostrarBannerReconexion(handle);
    }
  } catch (err) {
    await _limpiarHandleIDB();
  }

  _actualizarIndicador();
}

function _mostrarBannerReconexion(handle) {
  // Guardar handle en variable global temporal para que el botón lo pueda usar
  window.__rehabHandlePendiente = handle;

  const banner = document.createElement('div');
  banner.id    = 'banner-reconexion';
  banner.innerHTML = `
    <span>📂 Hay un archivo vinculado: <strong>${handle.name}</strong></span>
    <button class="btn btn-sm btn-primary"
      onclick="reconectarArchivo(window.__rehabHandlePendiente)">
      Reconectar (solo backup)
    </button>
    <button class="btn btn-sm btn-secondary"
      onclick="document.getElementById('banner-reconexion').remove()">
      Ignorar
    </button>`;
  document.querySelector('.main-content')?.prepend(banner);
}

async function reconectarArchivo(handle) {
  // Reconecta el archivo solo para seguir recibiendo el auto-guardado de
  // backup. Ya NO carga su contenido (los datos viven en Supabase).
  try {
    const permiso = await handle.requestPermission({ mode: 'readwrite' });
    if (permiso === 'granted') {
      archivoVinculado = handle;
      _marcarGuardado();
      document.getElementById('banner-reconexion')?.remove();
      mostrarToast('Archivo reconectado para backup', 'success');
    }
  } catch (err) {
    mostrarToast('No se pudo reconectar el archivo', 'danger');
  }
  _actualizarIndicador();
}
