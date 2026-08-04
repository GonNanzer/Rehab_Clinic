// app.js — Controlador principal, vistas y manejo de eventos

// ─── Utilidades de UI ─────────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

function discChip(disc, corto = false) {
  const d = DISCIPLINAS[disc];
  if (!d) return `<span class="chip chip-almuerzo">${esc(disc === '_almuerzo' ? '🍽 Almuerzo' : disc)}</span>`;
  const lbl = corto ? d.corto : d.label;
  return `<span class="chip" style="background:${d.bg};color:${d.color};border-color:${d.border}">${esc(lbl)}</span>`;
}

function discLabel(disc) {
  if (disc === '_almuerzo') return '🍽 Almuerzo terapéutico';
  return DISCIPLINAS[disc]?.label || disc;
}

// Devuelve las disciplinas activas (sesiones > 0) del plan de un paciente
function _discsDelPlan(pacienteId) {
  const plan = Planes.delPaciente(pacienteId);
  return Object.keys(plan).filter(d => (plan[d] || 0) > 0);
}

function formatFecha(fecha) {
  if (!fecha) return '';
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('es-AR');
}

function pctColor(pct) {
  if (pct >= 90) return 'var(--color-success)';
  if (pct >= 60) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function abrirModal(html, ancho = 'normal') {
  document.getElementById('modal-overlay').classList.remove('hidden');
  const box = document.getElementById('modal-box');
  box.classList.toggle('modal-wide', ancho === 'wide');
  box.innerHTML = html;
}

function cerrarModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  const box = document.getElementById('modal-box');
  box.innerHTML = '';
  box.classList.remove('modal-wide');
}

function toggleHdrDropdown(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const abierto = dd.classList.contains('hdr-dd-open');
  document.querySelectorAll('.hdr-dropdown.hdr-dd-open').forEach(d => d.classList.remove('hdr-dd-open'));
  if (!abierto) dd.classList.add('hdr-dd-open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.hdr-dropdown'))
    document.querySelectorAll('.hdr-dropdown.hdr-dd-open').forEach(d => d.classList.remove('hdr-dd-open'));
});

// ─── Router / Estado global ───────────────────────────────────────────────────

let fechaActiva = new Date().toISOString().split('T')[0];
let vistaActiva = 'grilla';
let pacientesLayout = 'cards';      // 'cards' | 'lista'
let profesionalesLayout = 'cards';  // 'cards' | 'lista'
let pacientesOrden = 'apellido';    // 'apellido' | 'grupo'
let profesionalesOrden = 'apellido'; // 'apellido' | 'disciplina'
let modoSwap = null;                // { sesionId, fecha } mientras se espera la segunda sesión
let modoRotacion = null;            // { cola: [{ sesionId, fecha }] } para rotación de N sesiones
let modoMover = null;               // { sesionId, fecha, pacienteId } mientras se espera el slot destino
let filtroProf = null;              // id del profesional activo en el filtro de grilla (null = todos)
let profSeleccionadoLista = null;   // profesional seleccionado en "Lista por profesional"
let sesionesCola = [];              // [{ pacienteId, profesionalId, disciplina, slotOriginal, esAlmuerzo, motivo, urgente }]
let modoColocarDeCola = null;       // { idx } — índice en sesionesCola que se está colocando
let _dragSesionId    = null;        // sesionId en vuelo durante drag-and-drop
let sidebarCollapsed = false;       // panel derecho de profesionales colapsado
let dispRowCollapsed = false;       // fila de disponibles colapsada
let dispPinned      = true;         // panel de disponibles fijado (sticky)
let _updateSidebarPosition  = null;  // función de reposicionamiento sticky del sidebar
let _sidebarScrollListener  = null;  // ref para poder limpiar el listener al re-renderizar
let _sidebarResizeListener  = null;

const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function _weekday(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=Dom … 6=Sáb
}

function _profsDelHorario(profs, fecha) {
  const dw = _weekday(fecha);
  return profs.filter(p => (p.diasLaborales||[]).includes(dw)).map(p => p.id);
}

// Retorna array de IDs de profesionales presentes, soportando ambos formatos de guardado:
// nuevo: presenciaProfesionales: { id: 'dia'|'manana'|'tarde' }
// viejo: profesionalesPresentes: [id, ...]
function _idsProfsPresentes(estado, fecha) {
  if (estado && 'presenciaProfesionales' in estado)
    return Object.keys(estado.presenciaProfesionales || {});
  if (estado?.profesionalesPresentes?.length)
    return estado.profesionalesPresentes;
  // Sin configuración explícita → horario habitual del día
  if (fecha)
    return _profsDelHorario(Profesionales.activos(), fecha);
  return [];
}

function navegarA(vista) {
  if (modoRotacion) cancelarModoRotacion();
  if (modoSwap) cancelarModoSwap();
  vistaActiva = vista;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === vista));
  renderVista();
  if (typeof actualizarVistaPresencia === 'function') actualizarVistaPresencia(vista);
  document.querySelector('.sidebar')?.classList.remove('mobile-open'); // cerrar el drawer en mobile al navegar
}

function renderVista() {
  const contenedor = document.getElementById('vista');
  switch (vistaActiva) {
    case 'grilla':        contenedor.innerHTML = vistaGrilla();        bindGrilla();        break;
    case 'pacientes':     contenedor.innerHTML = vistaPacientes();     bindPacientes();     break;
    case 'lista-prof':    contenedor.innerHTML = vistaListaProf();  bindListaProf();       break;
    case 'banos':         contenedor.innerHTML = vistaBanos();                              break;
    case 'egresados':     contenedor.innerHTML = vistaEgresados();     bindEgresados();     break;
    case 'profesionales': contenedor.innerHTML = vistaProfesionales(); bindProfesionales(); break;
    case 'practicantes':  contenedor.innerHTML = vistaPracticantes();  bindPracticantes();  break;
    case 'planes':        contenedor.innerHTML = vistaPlanes();        bindPlanes();        break;
    case 'disponibilidad':contenedor.innerHTML = vistaDisponibilidad();bindDisponibilidad();break;
    case 'metricas':      contenedor.innerHTML = vistaMetricas();      bindMetricas();      break;
    case 'historial':     contenedor.innerHTML = vistaHistorial();     bindHistorial();     break;
    case 'auditoria':     contenedor.innerHTML = vistaAuditoria();                          break;
    default: contenedor.innerHTML = '<p>Vista no encontrada</p>';
  }
}

// ─── Vista: Grilla horaria ────────────────────────────────────────────────────

function vistaGrilla() {
  const sesiones = Asignaciones.delDia(fechaActiva);
  const pacientes = Pacientes.activos();
  const estado = DiasState.delDia(fechaActiva);
  const alertas = []; // calculadas en tiempo real si hay sesiones

  const tieneSesiones = sesiones.length > 0;

  // Profesionales con sesiones hoy (para el filtro)
  const profsHoy = Profesionales.activos().filter(p =>
    sesiones.some(s => s.profesionalId === p.id)
  ).sort((a, b) => a.apellido.localeCompare(b.apellido));

  // Profesionales presentes sin sesión por slot (para panel disponibles)
  const _idsPresentes = _idsProfsPresentes(estado, fechaActiva);
  const _idsExcluidos = estado.profesionalesExcluidos || [];
  const _diaNum = _weekday(fechaActiva);
  const _profsPresentes = Profesionales.todos()
    .filter(p => p.activo !== false && _idsPresentes.includes(p.id) && !_idsExcluidos.includes(p.id));
  const _busyBySlot = {};
  SLOTS.forEach(s => {
    _busyBySlot[s.id] = new Set([
      ...sesiones.filter(x => x.slotId === s.id).map(x => x.profesionalId),
      ...sesiones.filter(x => x.slotId === s.id).flatMap(x => x.profesionalesAdicionales || [])
    ]);
  });
  const _libresBySlot = {};
  SLOTS.forEach(slot => {
    if (slot.esAlmuerzo) { _libresBySlot[slot.id] = []; return; }
    _libresBySlot[slot.id] = _profsPresentes.filter(p => {
      if (_busyBySlot[slot.id].has(p.id)) return false;
      const horarios = (p.horariosPorDia || {})[_diaNum];
      if (horarios && horarios.length > 0 && !horarios.includes(slot.id)) return false;
      return true;
    });
  });
  const _hayDisponibles = Object.values(_libresBySlot).some(arr => arr.length > 0);

  let html = `
  <div class="vista-header">
    <div class="vista-header-left">
      <h2>Agenda del día</h2>
      <input type="date" id="fecha-picker" value="${fechaActiva}" class="date-input">
    </div>
    <div class="vista-header-right">
      ${tieneSesiones && profsHoy.length > 0 ? `
      <select id="filtro-prof" class="select-field" style="max-width:200px" title="Filtrar por profesional">
        <option value="">Todos los profesionales</option>
        ${profsHoy.map(p => `<option value="${p.id}" ${filtroProf === p.id ? 'selected' : ''}>${esc(p.apellido)}${p.nombre ? ', ' + esc(p.nombre) : ''}</option>`).join('')}
      </select>` : ''}

      <button class="btn btn-secondary" onclick="window.print()"
        data-tooltip="Abre el diálogo de impresión del navegador con la agenda del día formateada.">🖨 Imprimir</button>
      <button class="btn btn-secondary" onclick="exportarGrillaPDF()"
        data-tooltip="Descarga la agenda del día como archivo PDF.">📄 PDF</button>
      ${tieneSesiones ? `
      <div class="hdr-dropdown" id="dd-sesiones">
        <button class="btn btn-secondary hdr-dropdown-toggle" onclick="toggleHdrDropdown('dd-sesiones')"
          data-tooltip="Acciones sobre las sesiones: mejorar asignaciones, fijar/desfijar o eliminar.">Sesiones ▾</button>
        <div class="hdr-dropdown-menu">
          <button class="hdr-dd-item" id="btn-mejorar"
            data-tooltip="Ejecuta un algoritmo de mejora local que reasigna sesiones para subir el índice de calidad sin perder cobertura.">✦ Mejorar agenda</button>
          <div class="hdr-dd-sep"></div>
          <button class="hdr-dd-item" id="btn-fijar-todas"
            data-tooltip="Marca todas las sesiones del día como fijas: no serán movidas si regenerás la agenda.">🔒 Fijar todas</button>
          <button class="hdr-dd-item" id="btn-desfijar-todas"
            data-tooltip="Quita la marca de fijo de todas las sesiones: quedan disponibles para ser reasignadas automáticamente.">🔓 Desfijar todas</button>
          <div class="hdr-dd-sep"></div>
          <button class="hdr-dd-item hdr-dd-item-danger" id="btn-limpiar"
            data-tooltip="Elimina todas las sesiones del día. Podés elegir si también eliminás las sesiones marcadas como fijas.">🗑 Eliminar sesiones</button>
        </div>
      </div>` : ''}
      <div class="hdr-dropdown" id="dd-generar">
        <button class="btn btn-primary hdr-dropdown-toggle" onclick="toggleHdrDropdown('dd-generar')"
          data-tooltip="Genera la agenda automáticamente. Elegí el modo de generación según tu preferencia.">⚡ Generar ▾</button>
        <div class="hdr-dropdown-menu">
          <button class="hdr-dd-item" id="btn-generar"
            data-tooltip="Recorre los pacientes de mayor a menor prioridad y para cada uno busca el mejor profesional y horario disponible. Modo recomendado.">⚡ Por paciente</button>
          <button class="hdr-dd-item" id="btn-generar-horario"
            data-tooltip="Barre cada franja horaria de izquierda a derecha y llena los slots con la mejor combinación paciente-profesional. Refleja el método manual.">⏱ Por horario</button>
        </div>
      </div>
    </div>
  </div>
  ${modoMover ? `
  <div class="modo-activo-banner modo-mover-banner">
    <span>↕ Modo mover: elegí un slot vacío del mismo paciente como destino</span>
    <button class="btn btn-sm" onclick="cancelarModoMover()">✕ Cancelar</button>
  </div>` : ''}`;

  if (pacientes.length === 0) {
    html += `<div class="empty-state"><div class="empty-icon">👥</div><p>No hay pacientes cargados. Agregá pacientes antes de crear la agenda.</p></div>`;
    return html;
  }

  if (!tieneSesiones) {
    const idsPresentes = _idsProfsPresentes(estado, fechaActiva);
    html += `<div class="grilla-aviso-vacia">
      <span class="grilla-aviso-icono">📋</span>
      <span>Agenda vacía para el ${formatFecha(fechaActiva)}. Generá la agenda automáticamente o hacé click en cualquier celda para agregar sesiones manualmente.</span>
      ${idsPresentes.length === 0 ? '<span class="grilla-aviso-warn">⚠ No hay profesionales marcados como presentes hoy.</span>' : ''}
    </div>`;
  }

  // Calcular alertas de déficit
  const alertasActuales = [];
  pacientes.forEach(p => {
    const mis = sesiones.filter(s => s.pacienteId === p.id);
    if (mis.length < HORAS_OBJETIVO_DIA) {
      alertasActuales.push({ paciente: p, asignadas: mis.length });
    }
  });

  const _alertasHtml = alertasActuales.length > 0 ? `<div class="alertas-bar">
      ⚠️ <strong>Déficit de horas:</strong> ${alertasActuales.map(a =>
        `${esc(a.paciente.apellido)}: ${a.asignadas}/${HORAS_OBJETIVO_DIA}h`
      ).join(' &nbsp;|&nbsp; ')}
    </div>` : '';

  // Panel de cola de sesiones desplazadas
  if (sesionesCola.length > 0) {
    html += `<div class="cola-panel">
      <div class="cola-panel-header">
        <span class="cola-panel-titulo">📋 Sesiones pendientes de reasignación (${sesionesCola.length})</span>
        <span class="text-muted" style="font-size:11px">Colocalas en la grilla o descartálas</span>
      </div>
      <div class="cola-items">
        ${sesionesCola.map((item, idx) => {
          const pac  = Pacientes.porId(item.pacienteId);
          const prof = Profesionales.porId(item.profesionalId);
          const slot = SLOTS.find(s => s.id === item.slotOriginal);
          const activo = modoColocarDeCola?.idx === idx;
          return `<div class="cola-item${activo ? ' cola-item-activo' : ''}">
            <div class="cola-item-info">
              <strong>${esc(pac?.apellido || '—')}</strong>
              ${discChip(item.disciplina, true)}
              <span class="text-muted" style="font-size:11px">${esc(Profesionales.iniciales(prof))} ${esc(prof?.apellido || '')}</span>
              <span class="cola-slot-orig">era ${esc(slot?.inicio || item.slotOriginal)}</span>
            </div>
            <div class="cola-item-acciones">
              ${activo
                ? `<button class="btn btn-sm btn-secondary" onclick="cancelarColocarDeCola()">✕ Cancelar</button>`
                : `<button class="btn btn-sm btn-primary"   onclick="iniciarColocarDeCola(${idx})">↕ Colocar</button>`}
              <button class="btn btn-sm btn-danger-outline" onclick="descartarDeCola(${idx})">🗑</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // Banner de modo colocar de cola
  if (modoColocarDeCola !== null) {
    const item = sesionesCola[modoColocarDeCola.idx];
    const pac  = Pacientes.porId(item?.pacienteId);
    html += `<div class="modo-activo-banner modo-mover-banner">
      <span>↕ Elegí un slot vacío de <strong>${esc(pac?.apellido || '—')}</strong> como destino</span>
      <button class="btn btn-sm" onclick="cancelarColocarDeCola()">✕ Cancelar</button>
    </div>`;
  }

  // Panel de disponibles: div independiente con sticky, fuera de la tabla
  const _dispChipsHtml = function(slot) {
    const libres = _libresBySlot[slot.id] || [];
    return libres.map(function(p) {
      const disc0 = (p.disciplinas || [])[0];
      const dc = disc0 ? DISCIPLINAS[disc0] : null;
      const st = dc
        ? 'background:' + dc.bg + ';color:' + dc.color + ';border-color:' + dc.border
        : 'background:#e0f2fe;color:#0369a1;border-color:#7dd3fc';
      const chipClass = p.esPracticante ? 'disp-libre-chip disp-libre-chip-practicante' : 'disp-libre-chip';
      const chipStyle = p.esPracticante ? 'background:#fef9c3;color:#ca8a04;border:1px dashed #fbbf24' : st;
      const labelDisc = dc ? dc.label : (disc0 || 'Pro');
      const titleText = esc(p.apellido) + ' \xb7 ' + (p.esPracticante ? 'Practicante' : esc(labelDisc));
      const suffix = p.esPracticante ? '*' : '';
      return '<span class="' + chipClass + '" style="' + chipStyle + '" title="' + titleText + '">' + esc(Profesionales.iniciales(p)) + suffix + '</span>';
    }).join('');
  };
  let _dispPanelHtml = '';
  if (_hayDisponibles) {
    const _collapsed = dispRowCollapsed ? ' disp-panel-collapsed' : '';
    const _pinned    = dispPinned      ? ' disp-pinned'          : '';
    const _arrow     = dispRowCollapsed ? '▸' : '▾';
    let _colsHtml = '';
    SLOTS.forEach(function(slot) {
      const _colClass = 'disp-panel-col' + (slot.esAlmuerzo ? ' disp-panel-col-alm' : '');
      _colsHtml += '<div class="' + _colClass + '">' + _dispChipsHtml(slot) + '</div>';
    });
    _dispPanelHtml = '<div id="disponibles-panel" class="disp-panel' + _collapsed + _pinned + '">'
      + '<div class="disp-panel-inner">'
      + '<div class="disp-panel-lbl" onclick="toggleDisponibles()" title="Mostrar/ocultar disponibles">'
      + '<span class="disp-toggle-arrow">' + _arrow + '</span>'
      + ' 👥 Disponibles'
      + '<button class="disp-panel-pin-btn" id="btn-disp-pin" onclick="event.stopPropagation();toggleDispPin()" title="Fijar panel">'
      + (dispPinned ? '📌' : '📍')
      + '</button>'
      + '</div>'
      + '<div class="disp-panel-chips" id="disp-panel-chips">'
      + _colsHtml
      + '<div class="disp-panel-col-horas"></div>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  html += _dispPanelHtml;
  html += `<div class="grilla-wrapper" id="grilla-wrapper"><table class="grilla-tabla">
    <thead><tr>
      <th class="grilla-th-pac">Paciente</th>
      ${SLOTS.map(s => `<th class="${s.esAlmuerzo ? 'col-almuerzo' : ''}">${esc(s.label)}</th>`).join('')}
      <th>Horas</th>
    </tr></thead>
    <tbody>`;

  pacientes.sort((a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a))
    .forEach(pac => {
      const misSesiones = sesiones.filter(s => s.pacienteId === pac.id);
      const grupo = GRUPOS_DIAGNOSTICOS[pac.grupo];
      const transf = TRANSFERENCIAS[pac.transferencias];
      const estadoDia = DiasState.delDia(fechaActiva);
      const _bCoy = {};
      (estadoDia.bloquesPacientes?.[pac.id] || []).forEach(b => { _bCoy[b.slotId] = b; });
      const _bEst = {};
      (pac.bloqueosPermanentes || []).forEach(b => { _bEst[b.slotId] = b; });
      // Bloqueos de baño: estructurales día-específicos
      const _diaGrilla = _weekday(fechaActiva);
      (pac.bañosSemana || []).forEach(b => {
        if (b.dia === _diaGrilla && !_bEst[b.slotId])
          _bEst[b.slotId] = { motivo: 'Baño' };
      });
      const bloqueados = new Set([...Object.keys(_bCoy), ...Object.keys(_bEst)]);
      const edif = pac.edificio || pac.habitacion || '';

      html += `<tr>
        <td class="grilla-pac-cell">
          <div class="pac-nombre">${esc(pac.nombre)} ${esc(pac.apellido)}</div>
          <div class="pac-info">
            ${edif ? `<span class="text-muted" style="font-size:10px">${esc(edif)}</span>` : ''}
            ${grupo ? `<span class="badge" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border}">${grupo.label}</span>` : ''}
            ${transf ? `<span class="badge badge-warning" style="font-size:10px">${transf.label}</span>` : ''}
          </div>
        </td>`;

      SLOTS.forEach(slot => {
        const sesionesEnSlot = misSesiones.filter(s => s.slotId === slot.id);
        const sesion = sesionesEnSlot[0]; // puede haber dual KTR
        const bloqueado = bloqueados.has(slot.id);

        if (bloqueado && !sesion) {
          const _partes = [];
          if (_bEst[slot.id]) _partes.push('Estructural' + (_bEst[slot.id].motivo ? ': ' + _bEst[slot.id].motivo : ''));
          if (_bCoy[slot.id]) _partes.push('Coyuntural' + (_bCoy[slot.id].motivo ? ': ' + _bCoy[slot.id].motivo : ''));
          const _bloqTitle = esc(_partes.join(' · ') || 'Bloqueado');
          html += `<td class="celda-bloqueada" title="${_bloqTitle}">🚫</td>`;
        } else if (sesion) {
          const prof = Profesionales.porId(sesion.profesionalId);
          const disc = DISCIPLINAS[sesion.disciplina];
          const esRef = pac.referentes?.[sesion.disciplina] === sesion.profesionalId;
          const bgColor = disc?.bg || '#f0f0f0';
          const textColor = disc?.color || '#333';
          const iconOrigen = sesion.origen === 'manual' || sesion.origen === 'automatico_mejora' ? '✏ ' : '';
          const lockIcon = sesion.fijo
            ? `<span class="lock-icon" data-sesion-id="${sesion.id}" data-fecha="${fechaActiva}" title="Sesión fija (click para desbloquear)">🔒</span>`
            : `<span class="lock-icon lock-icon-free" data-sesion-id="${sesion.id}" data-fecha="${fechaActiva}" title="Click para fijar sesión">🔓</span>`;
          const rotIdx = modoRotacion ? modoRotacion.cola.findIndex(c => c.sesionId === sesion.id) : -1;
          const enRotacion = rotIdx >= 0 ? ` rot-en-cola rot-idx-${rotIdx}` : '';
          const esSrcMover = modoMover?.sesionId === sesion.id;
          const dimmed = filtroProf && sesion.profesionalId !== filtroProf && !esSrcMover ? ' celda-dimmed' : '';
          html += `<td class="celda-sesion${sesion.fijo ? ' sesion-fija' : ''}${enRotacion}${esSrcMover ? ' celda-mover-src' : ''}${dimmed}"
            draggable="true"
            style="background:${bgColor};border-left:3px solid ${textColor}"
            data-sesion-id="${sesion.id}"
            data-fecha="${fechaActiva}"
            data-pac-id="${pac.id}"
            data-slot-id="${slot.id}"
            title="${esSrcMover ? 'Sesión a mover — elegí un slot vacío destino' : 'Arrastrá para mover o intercambiar · Click para editar'}">
            ${lockIcon}
            <div class="celda-disc" style="color:${textColor}">
              ${(sesion.profesionalesAdicionales||[]).length > 0 ? '👥 ' : ''}${sesion.esAlmuerzo ? '🍽 ' : ''}${esc(disc?.corto || sesion.disciplina)}
            </div>
            <div class="celda-prof">${iconOrigen}${esc(Profesionales.iniciales(prof))} ${esc(prof?.apellido || '')}</div>
            ${esRef ? '<div class="ref-badge">★ Ref.</div>' : ''}
          </td>`;
        } else if (slot.esAlmuerzo && (pac.almuerza ?? true) && !pac.requiereAlmuerzoTerapeutico) {
          html += `<td class="celda-almuerzo-libre" title="Almuerzo (sin terapista)">🍽</td>`;
        } else {
          const colaItem = modoColocarDeCola !== null ? sesionesCola[modoColocarDeCola.idx] : null;
          const esMoverTarget = (modoMover?.pacienteId === pac.id)
                             || (colaItem?.pacienteId === pac.id);
          html += `<td class="celda-vacia${esMoverTarget ? ' celda-mover-target' : ''}"
            data-pac-id="${pac.id}" data-slot-id="${slot.id}" data-fecha="${fechaActiva}"
            title="${esMoverTarget ? 'Colocar aquí' : 'Agregar sesión'}">${esMoverTarget ? '↕' : '+'}</td>`;
        }
      });

      const pct = Math.round(misSesiones.length / HORAS_OBJETIVO_DIA * 100);
      const barColor = pctColor(pct);
      html += `<td class="celda-horas">
        <div class="horas-num" style="color:${barColor}">${misSesiones.length}/${HORAS_OBJETIVO_DIA}</div>
        <div class="horas-bar"><div class="horas-fill" style="width:${Math.min(100,pct)}%;background:${barColor}"></div></div>
      </td></tr>`;
    });

  html += `</tbody></table></div>`;

  // ── Sidebar de profesionales ──────────────────────────────────────────────
  const sidebarProfs = Profesionales.activos()
    .filter(p => sesiones.some(s => s.profesionalId === p.id))
    .sort((a, b) => a.apellido.localeCompare(b.apellido));

  let sidebarHtml = '';
  sidebarProfs.forEach(prof => {
    const profSesiones = sesiones
      .filter(s => s.profesionalId === prof.id)
      .sort((a, b) => {
        const ia = SLOTS.findIndex(s => s.id === a.slotId);
        const ib = SLOTS.findIndex(s => s.id === b.slotId);
        return ia - ib;
      });

    const items = profSesiones.map(s => {
      const slot = SLOTS.find(sl => sl.id === s.slotId);
      const pac  = Pacientes.porId(s.pacienteId);
      const disc = DISCIPLINAS[s.disciplina];
      return `<div class="sidebar-sesion-item">
        <span class="sidebar-sesion-hora">${esc(slot?.inicio || '')}</span>
        <span class="sidebar-sesion-pac">${esc(pac?.apellido || '—')}</span>
        <span class="sidebar-sesion-disc" style="background:${disc?.bg||'#eee'};color:${disc?.color||'#333'}">${esc(disc?.corto || s.disciplina)}</span>
      </div>`;
    }).join('');

    sidebarHtml += `<div class="sidebar-prof-card" onclick="toggleSidebarProf('${prof.id}')">
      <div class="sidebar-prof-head">
        <span class="sidebar-prof-nombre">${esc(prof.apellido)}${prof.nombre ? ', ' + esc(prof.nombre) : ''}</span>
        <span class="sidebar-prof-count">${profSesiones.length}</span>
      </div>
      <div class="sidebar-prof-sesiones" id="sidebar-ses-${prof.id}">${items}</div>
    </div>`;
  });

  const grillaPlusSidebar = `
    <div class="grilla-layout">
      <div class="grilla-main">${html}</div>
      ${sidebarProfs.length > 0 ? `
      <button class="sidebar-toggle-wrap" id="sidebar-toggle-btn" onclick="toggleSidebar()"
        style="right:${sidebarCollapsed ? '4px' : '210px'}"
        data-tooltip="${sidebarCollapsed ? 'Mostrar el panel de profesionales con agenda asignada hoy.' : 'Ocultar el panel lateral para ganar espacio en la grilla.'}">${sidebarCollapsed ? '›' : '‹'}</button>
      <div class="grilla-sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}" id="grilla-sidebar">
        <div class="sidebar-titulo">Profesionales</div>
        ${sidebarHtml}
      </div>` : ''}
    </div>`;

  html = grillaPlusSidebar;
  html += _alertasHtml;
  return html;
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const sb  = document.getElementById('grilla-sidebar');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (sb)  sb.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  if (btn) {
    btn.textContent = sidebarCollapsed ? '›' : '‹';
    btn.title = sidebarCollapsed ? 'Mostrar profesionales' : 'Ocultar profesionales';
  }
  if (_updateSidebarPosition) _updateSidebarPosition();
}

function toggleDisponibles() {
  dispRowCollapsed = !dispRowCollapsed;
  const panel = document.getElementById('disponibles-panel');
  if (!panel) return;
  panel.classList.toggle('disp-panel-collapsed', dispRowCollapsed);
  const arrow = panel.querySelector('.disp-toggle-arrow');
  if (arrow) arrow.textContent = dispRowCollapsed ? '▸' : '▾';
}

function toggleDispPin() {
  dispPinned = !dispPinned;
  const panel = document.getElementById('disponibles-panel');
  const btn   = document.getElementById('btn-disp-pin');
  if (panel) panel.classList.toggle('disp-pinned', dispPinned);
  if (btn)   btn.textContent = dispPinned ? '📌' : '📍';
}

function _syncDispPanelWidths() {
  const table = document.querySelector('.grilla-tabla');
  const panel = document.getElementById('disponibles-panel');
  if (!table || !panel) return;
  const ths = Array.from(table.querySelectorAll('thead th'));
  if (!ths.length) return;
  const lbl   = panel.querySelector('.disp-panel-lbl');
  const cols  = Array.from(panel.querySelectorAll('.disp-panel-col'));
  const horas = panel.querySelector('.disp-panel-col-horas');
  function setW(el, th) {
    if (!el || !th) return;
    const w = th.getBoundingClientRect().width;
    if (w > 0) { el.style.width = w + 'px'; el.style.flex = 'none'; }
  }
  setW(lbl, ths[0]);
  ths.slice(1, ths.length - 1).forEach(function(th, i) { setW(cols[i], th); });
  setW(horas, ths[ths.length - 1]);
}

function _initSidebarSticky() {
  const scroller = document.querySelector('.main-content') || window;

  function update() {
    const layout  = document.querySelector('.grilla-layout');
    const wrapper = document.getElementById('grilla-wrapper');
    const sidebar = document.getElementById('grilla-sidebar');
    const btn     = document.getElementById('sidebar-toggle-btn');
    if (!layout || !wrapper) return;

    const layoutRect  = layout.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const rightGap    = Math.max(0, window.innerWidth - layoutRect.right);
    const btnRight    = rightGap + (sidebarCollapsed ? 4 : 210);

    if (wrapperRect.top <= 0) {
      // Sticky: fijo al viewport
      if (sidebar) {
        sidebar.style.position  = 'fixed';
        sidebar.style.top       = '0';
        sidebar.style.right     = rightGap + 'px';
        sidebar.style.maxHeight = '100vh';
      }
      if (btn) {
        btn.style.position = 'fixed';
        btn.style.top      = '0';
        btn.style.right    = btnRight + 'px';
      }
    } else {
      // Normal: absoluto dentro del layout
      const topOffset = wrapperRect.top - layoutRect.top;
      if (sidebar) {
        sidebar.style.position  = 'absolute';
        sidebar.style.top       = topOffset + 'px';
        sidebar.style.right     = '0';
        sidebar.style.maxHeight = '85vh';
      }
      if (btn) {
        btn.style.position = 'absolute';
        btn.style.top      = topOffset + 'px';
        btn.style.right    = (sidebarCollapsed ? 4 : 210) + 'px';
      }
    }
  }

  // Limpia listeners anteriores si vistaGrilla() se re-ejecuta
  if (_sidebarScrollListener) scroller.removeEventListener('scroll', _sidebarScrollListener);
  if (_sidebarResizeListener) window.removeEventListener('resize', _sidebarResizeListener);
  _sidebarScrollListener = update;
  _sidebarResizeListener = update;
  scroller.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  _updateSidebarPosition = update;
  update();
}

function _initDispSync() {
  const panel   = document.getElementById('disponibles-panel');
  const wrapper = document.getElementById('grilla-wrapper');
  if (!panel || !wrapper) return;
  let syncingP = false, syncingW = false;
  panel.addEventListener('scroll', () => {
    if (syncingP) return;
    syncingW = true;
    wrapper.scrollLeft = panel.scrollLeft;
    requestAnimationFrame(() => { syncingW = false; });
  });
  wrapper.addEventListener('scroll', () => {
    if (syncingW) return;
    syncingP = true;
    panel.scrollLeft = wrapper.scrollLeft;
    requestAnimationFrame(() => { syncingP = false; });
  });
}

function toggleSidebarProf(profId) {
  const el = document.getElementById(`sidebar-ses-${profId}`);
  if (!el) return;
  const card = el.closest('.sidebar-prof-card');
  const isOpen = el.classList.contains('open');
  // Cerrar todos
  document.querySelectorAll('.sidebar-prof-sesiones.open').forEach(e => {
    e.classList.remove('open');
    e.closest('.sidebar-prof-card')?.classList.remove('sidebar-prof-card-active');
  });
  if (!isOpen) {
    el.classList.add('open');
    card?.classList.add('sidebar-prof-card-active');
  }
}

function bindGrilla() {
  document.getElementById('fecha-picker')?.addEventListener('change', e => {
    fechaActiva = e.target.value;
    renderVista();
  });

  document.getElementById('btn-mejorar')?.addEventListener('click', () => {
    const resultado = mejoraLocal(fechaActiva);
    renderVista();
    if (resultado.sesionesAgregadas === 0) {
      abrirModal(`
        <div class="modal-header">
          <h3>Resultado de la mejora</h3>
          <button class="modal-close" onclick="cerrarModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="mejora-resultado mejora-sin-cambios">
            <div class="mejora-icono">✓</div>
            <p>La agenda ya está en su estado óptimo alcanzable.<br>
            No se encontraron swaps ni slots libres para mejorar la cobertura actual.</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="cerrarModal()">Cerrar</button>
        </div>`);
    } else {
      abrirModal(`
        <div class="modal-header">
          <h3>Mejora completada</h3>
          <button class="modal-close" onclick="cerrarModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="mejora-resultado mejora-con-cambios">
            <div class="mejora-stats">
              <div class="mejora-stat">
                <span class="mejora-num">+${resultado.sesionesAgregadas}</span>
                <span class="mejora-lbl">sesiones agregadas</span>
              </div>
              ${resultado.swapsRealizados > 0 ? `
              <div class="mejora-stat">
                <span class="mejora-num">${resultado.swapsRealizados}</span>
                <span class="mejora-lbl">swaps realizados</span>
              </div>` : ''}
            </div>
            <ul class="mejora-detalles">
              ${resultado.detalles.map(d => `<li>${esc(d)}</li>`).join('')}
            </ul>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="cerrarModal()">Ver agenda actualizada</button>
        </div>`);
    }
  });

  document.getElementById('btn-fijar-todas')?.addEventListener('click', () => {
    const sesiones = Asignaciones.delDia(fechaActiva);
    const noFijas = sesiones.filter(s => !s.fijo);
    if (noFijas.length === 0) { mostrarToast('Todas las sesiones ya están fijadas', 'info'); return; }
    const actualizadas = sesiones.map(s => s.fijo ? s : { ...s, fijo: true });
    Asignaciones.guardarDia(fechaActiva, actualizadas);
    renderVista();
    mostrarToast(`${noFijas.length} sesión${noFijas.length > 1 ? 'es fijadas' : ' fijada'} — no se modificarán al regenerar`, 'success');
  });

  document.getElementById('btn-desfijar-todas')?.addEventListener('click', () => {
    const sesiones = Asignaciones.delDia(fechaActiva);
    const fijas = sesiones.filter(s => s.fijo);
    if (fijas.length === 0) { mostrarToast('No hay sesiones fijadas', 'info'); return; }
    const actualizadas = sesiones.map(s => s.fijo ? { ...s, fijo: false } : s);
    Asignaciones.guardarDia(fechaActiva, actualizadas);
    renderVista();
    mostrarToast(`${fijas.length} sesión${fijas.length > 1 ? 'es desfijadas' : ' desfijada'}`, 'info');
  });

  document.getElementById('btn-limpiar')?.addEventListener('click', () => abrirModalLimpiarSesiones(fechaActiva));

  document.getElementById('btn-generar')?.addEventListener('click', () => {
    const estado = DiasState.delDia(fechaActiva);
    if (_idsProfsPresentes(estado, fechaActiva).length === 0) {
      alert('No hay profesionales marcados como presentes. Configurá la disponibilidad del día primero.');
      return;
    }
    const yaExiste = Asignaciones.delDia(fechaActiva).length > 0;
    if (yaExiste && !confirm('Ya existe una agenda para este día. ¿Regenerar? Se perderán los cambios manuales.')) return;

    const resultado = generarAgendaOptima(fechaActiva);
    renderVista();

    if (resultado.candidatos) {
      // Hay agendas empatadas: abrir modal de comparación
      abrirModalComparacionAgendas(resultado.candidatos, fechaActiva);
    } else {
      // Única ganadora: feedback por toast
      const deficits = resultado.alertas.filter(a => a.tipo === 'deficit_horas').length;
      const scoreStr = resultado.indice ? ` · Índice: ${resultado.indice.score}%` : '';
      if (deficits === 0) {
        mostrarToast(`Agenda generada: ${resultado.sesiones.length} sesiones ✓${scoreStr}`, 'success');
      } else {
        mostrarToast(`Agenda generada con ${deficits} paciente(s) con déficit de horas${scoreStr}`, 'warning');
      }
    }
  });

  document.getElementById('btn-generar-horario')?.addEventListener('click', () => {
    const estado = DiasState.delDia(fechaActiva);
    if (_idsProfsPresentes(estado, fechaActiva).length === 0) {
      alert('No hay profesionales marcados como presentes. Configurá la disponibilidad del día primero.');
      return;
    }
    const yaExiste = Asignaciones.delDia(fechaActiva).length > 0;
    if (yaExiste && !confirm('Ya existe una agenda para este día. ¿Regenerar? Se perderán los cambios manuales.')) return;
    const resultado = generarAgendaSlotPorSlot(fechaActiva);
    renderVista();
    mostrarToast(`Agenda por horario: ${resultado.sesiones.length} sesiones`, 'success');
  });

  // Click en lock icon — toggle fijo (no propaga al click de la celda)
  document.querySelectorAll('.lock-icon').forEach(ic => {
    ic.addEventListener('click', e => {
      e.stopPropagation();
      const sesionId = ic.dataset.sesionId;
      const fecha    = ic.dataset.fecha;
      toggleFijoSesion(sesionId, fecha);
    });
  });

  // Filtro por profesional
  document.getElementById('filtro-prof')?.addEventListener('change', e => {
    filtroProf = e.target.value || null;
    renderVista();
  });

  // Click en celda vacía — colocar de cola, mover, o crear sesión manual
  document.querySelectorAll('.celda-vacia').forEach(celda => {
    celda.addEventListener('click', () => {
      if (modoColocarDeCola !== null) {
        if (celda.classList.contains('celda-mover-target')) {
          ejecutarColocarDeCola(celda.dataset.slotId, celda.dataset.fecha);
        }
        return;
      }
      if (modoMover) {
        if (celda.classList.contains('celda-mover-target')) {
          ejecutarMover(celda.dataset.slotId, celda.dataset.fecha);
        }
        return;
      }
      if (modoSwap || modoRotacion) return;
      abrirModalCrearSesion(celda.dataset.pacId, celda.dataset.slotId, celda.dataset.fecha);
    });
  });

  // Click en celda con sesión — mover, swap, rotación o modal de detalle
  document.querySelectorAll('.celda-sesion').forEach(celda => {
    celda.addEventListener('click', e => {
      if (e.target.classList.contains('lock-icon')) return;
      const sesionId = celda.dataset.sesionId;
      const fecha    = celda.dataset.fecha;
      if (modoMover) {
        // Click en la misma sesión que se está moviendo → cancelar
        if (sesionId === modoMover.sesionId) { cancelarModoMover(); return; }
        return; // ignorar otras sesiones mientras se mueve
      }
      if (modoRotacion) {
        agregarARotacion(sesionId, fecha);
      } else if (modoSwap) {
        if (sesionId === modoSwap.sesionId) { cancelarModoSwap(); return; }
        confirmarSwap(sesionId, fecha);
      } else {
        abrirModalSesion(sesionId, fecha);
      }
    });
  });

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  function _clearDragClasses() {
    document.querySelectorAll('.drag-ok, .drag-bad').forEach(el =>
      el.classList.remove('drag-ok', 'drag-bad')
    );
  }

  // Drag START — desde una celda con sesión
  document.querySelectorAll('.celda-sesion[draggable]').forEach(td => {
    td.addEventListener('dragstart', e => {
      _dragSesionId = td.dataset.sesionId;
      td.classList.add('celda-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragSesionId);
    });
    td.addEventListener('dragend', () => {
      td.classList.remove('celda-dragging');
      _clearDragClasses();
      _dragSesionId = null;
    });
  });

  // Drag sobre celda VACÍA — solo mismo paciente
  document.querySelectorAll('.celda-vacia').forEach(td => {
    td.addEventListener('dragover', e => {
      if (!_dragSesionId) return;
      const sesion = Asignaciones.delDia(fechaActiva).find(s => s.id === _dragSesionId);
      if (!sesion || td.dataset.pacId !== sesion.pacienteId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!td.classList.contains('drag-ok')) {
        _clearDragClasses();
        const { ok } = _dragValidarMover(fechaActiva, _dragSesionId, td.dataset.slotId);
        td.classList.add(ok ? 'drag-ok' : 'drag-bad');
      }
    });
    td.addEventListener('dragleave', () => td.classList.remove('drag-ok', 'drag-bad'));
    td.addEventListener('drop', e => {
      e.preventDefault();
      if (!_dragSesionId) return;
      const sesion = Asignaciones.delDia(fechaActiva).find(s => s.id === _dragSesionId);
      if (!sesion || td.dataset.pacId !== sesion.pacienteId) return;
      const capSesionId = _dragSesionId;
      const capSlotId   = td.dataset.slotId;
      const capFecha    = fechaActiva;
      _dragSesionId = null;
      const { ok, razones } = _dragValidarMover(capFecha, capSesionId, capSlotId);
      if (ok) _dragEjecutarMover(capFecha, capSesionId, capSlotId);
      else if (razones?.length) _dragModalConflicto(razones, () => _dragForzarMover(capFecha, capSesionId, capSlotId));
    });
  });

  // Drag sobre otra sesión — swap de slots
  document.querySelectorAll('.celda-sesion[draggable]').forEach(td => {
    td.addEventListener('dragover', e => {
      if (!_dragSesionId || td.dataset.sesionId === _dragSesionId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!td.classList.contains('drag-ok') && !td.classList.contains('drag-bad')) {
        _clearDragClasses();
        const { ok } = _dragValidarSwap(fechaActiva, _dragSesionId, td.dataset.sesionId);
        td.classList.add(ok ? 'drag-ok' : 'drag-bad');
      }
    });
    td.addEventListener('dragleave', () => td.classList.remove('drag-ok', 'drag-bad'));
    td.addEventListener('drop', e => {
      e.preventDefault();
      if (!_dragSesionId || td.dataset.sesionId === _dragSesionId) return;
      const capSesionIdA = _dragSesionId;
      const capSesionIdB = td.dataset.sesionId;
      const capFecha     = fechaActiva;
      _dragSesionId = null;
      const { ok, razones } = _dragValidarSwap(capFecha, capSesionIdA, capSesionIdB);
      if (ok) _dragEjecutarSwap(capFecha, capSesionIdA, capSesionIdB);
      else if (razones?.length) _dragModalConflicto(razones, () => _dragForzarSwap(capFecha, capSesionIdA, capSesionIdB));
    });
  });

  _initDispSync();
  requestAnimationFrame(function() { _syncDispPanelWidths(); _initSidebarSticky(); });
}

function agregarProfAdicional(fecha, sesionId) {
  const sel = document.getElementById('prof-adicional-sel');
  const profId = sel?.value;
  if (!profId) { mostrarToast('Elegí un profesional', 'warning'); return; }

  const sesion = Asignaciones.delDia(fecha).find(s => s.id === sesionId);
  if (!sesion) return;

  const sesiones = Asignaciones.delDia(fecha);
  const ocupado = sesiones.some(s =>
    s.id !== sesionId && s.slotId === sesion.slotId &&
    (s.profesionalId === profId || (s.profesionalesAdicionales || []).includes(profId))
  );

  const adicionales = [...(sesion.profesionalesAdicionales || []), profId];

  if (ocupado) {
    const prof = Profesionales.porId(profId);
    const sesConflicto = sesiones.find(s =>
      s.id !== sesionId && s.slotId === sesion.slotId && s.profesionalId === profId
    );
    const pacConflicto = sesConflicto ? Pacientes.porId(sesConflicto.pacienteId) : null;
    const conQuien = pacConflicto
      ? 'con <strong>' + esc(pacConflicto.apellido) + ', ' + esc(pacConflicto.nombre) + '</strong>'
      : '';
    const conflictoId = sesConflicto ? sesConflicto.id : '';
    abrirModal(
      '<div class="modal-header">' +
        '<h3>Conflicto de horario</h3>' +
        '<button class="modal-close" onclick="cerrarModal()">✕</button>' +
      '</div>' +
      '<div class="modal-body"><div class="aviso-restricciones">' +
        '<div class="aviso-icono">⚠</div>' +
        '<div>' +
          '<strong>' + esc(Profesionales.nombreCompleto(prof)) + '</strong> ya tiene una sesión en este horario ' + conQuien + '.' +
          '<p class="aviso-pregunta">¿Agregarlo igual? La sesión en conflicto se moverá a la cola de reasignación.</p>' +
        '</div>' +
      '</div></div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>' +
        '<button class="btn btn-danger" onclick="_forzarProfAdicional(\'' + fecha + '\',\'' + sesionId + '\',\'' + profId + '\',\'' + conflictoId + '\')">Forzar</button>' +
      '</div>'
    );
    return;
  }

  Asignaciones.actualizarSesion(fecha, sesionId, { profesionalesAdicionales: adicionales });
  cerrarModal();
  renderVista();
  mostrarToast('Profesional adicional agregado', 'success');
}

function _forzarProfAdicional(fecha, sesionId, profId, conflictoId) {
  const sesion = Asignaciones.delDia(fecha).find(s => s.id === sesionId);
  if (!sesion) return;
  if (conflictoId) {
    const sesConflicto = Asignaciones.delDia(fecha).find(s => s.id === conflictoId);
    if (sesConflicto) _desplazarACola(sesConflicto, fecha);
    Asignaciones.actualizarSesion(fecha, conflictoId, { desplazado: true });
  }
  const adicionales = [...(sesion.profesionalesAdicionales || []), profId];
  Asignaciones.actualizarSesion(fecha, sesionId, { profesionalesAdicionales: adicionales });
  cerrarModal();
  renderVista();
  mostrarToast('Profesional adicional forzado', 'info');
}

function quitarProfAdicional(fecha, sesionId, idx) {
  const sesion = Asignaciones.delDia(fecha).find(s => s.id === sesionId);
  if (!sesion) return;
  const adicionales = [...(sesion.profesionalesAdicionales || [])];
  adicionales.splice(idx, 1);
  Asignaciones.actualizarSesion(fecha, sesionId, { profesionalesAdicionales: adicionales });
  cerrarModal();
  renderVista();
  mostrarToast('Profesional adicional removido', 'info');
}

function abrirModalSesion(sesionId, fecha) {
  const sesiones = Asignaciones.delDia(fecha);
  const sesion = sesiones.find(s => s.id === sesionId);
  if (!sesion) return;

  const paciente = Pacientes.porId(sesion.pacienteId);
  const prof     = Profesionales.porId(sesion.profesionalId);
  const slot     = SLOTS.find(s => s.id === sesion.slotId);

  // Profesionales libres en este slot (para cambio directo)
  const estadoDia = DiasState.delDia(fecha);
  const idsPresentes = new Set(_idsProfsPresentes(estadoDia, fecha));
  const ocupadosEnSlot = new Set(
    sesiones.filter(s => s.slotId === sesion.slotId && s.id !== sesionId)
            .map(s => s.profesionalId)
  );
  const profsCompatibles = Profesionales.activos().filter(p => {
    if (!idsPresentes.has(p.id)) return false;
    if (ocupadosEnSlot.has(p.id)) return false;
    return sesion.esAlmuerzo
      ? (paciente.disciplinasAlmuerzo?.length
          ? paciente.disciplinasAlmuerzo.some(d => (p.disciplinas||[]).includes(d))
          : DISCIPLINAS_ALMUERZO_DEFAULT.some(d => (p.disciplinas||[]).includes(d)))
      : (p.disciplinas||[]).includes(sesion.disciplina);
  });
  // El profesional actual siempre disponible (ya está asignado aquí)
  if (prof && !profsCompatibles.find(p => p.id === prof.id)) profsCompatibles.unshift(prof);

  const html = `
  <div class="modal-header">
    <h3>${esc(slot?.label)} — ${esc(paciente?.apellido)}, ${esc(paciente?.nombre)}</h3>
    <button class="modal-close" onclick="cerrarModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="info-grid">
      <div><strong>Disciplina:</strong> ${discLabel(sesion.disciplina)}</div>
      <div><strong>Profesional:</strong> ${esc(Profesionales.nombreCompleto(prof))}</div>
      <div><strong>Origen:</strong> ${sesion.origen === 'manual' || sesion.origen === 'automatico_mejora'
        ? '✏️ Modificado' : '⚡ Generado automáticamente'}</div>
    </div>
    <div class="motivo-box">
      <span class="motivo-text">${esc(sesion.motivo || 'Sin criterios registrados')}</span>
    </div>
    ${sesion.urgente ? `<div class="badge badge-danger" style="margin-top:8px">🚨 Prescripción urgente</div>` : ''}

    <div class="sesion-acciones">
      <div class="sesion-accion-bloque">
        <h4>Cambiar profesional</h4>
        <div class="text-muted" style="font-size:11px;margin-bottom:6px">Solo profesionales presentes y libres en este horario</div>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="nuevo-prof" class="select-field" style="flex:1">
            ${profsCompatibles.map(p =>
              `<option value="${p.id}" ${p.id === sesion.profesionalId ? 'selected' : ''}>${esc(Profesionales.nombreCompleto(p))}</option>`
            ).join('')}
          </select>
          <button class="btn btn-primary" onclick="guardarCambioSesion('${fecha}','${sesionId}')">Guardar</button>
        </div>
      </div>

      <div class="sesion-accion-sep">o</div>

      <div class="sesion-accion-bloque">
        <h4>Profesionales adicionales</h4>
        <div class="text-muted" style="font-size:11px;margin-bottom:8px">Participan como 2do o 3er profesional en esta sesión</div>
        <div id="profs-adicionales-lista">
          ${(() => {
            const adicionales = (sesion.profesionalesAdicionales || []);
            if (adicionales.length === 0) return '<em class="text-muted" style="font-size:12px">Ninguno</em>';
            return adicionales.map((profId, i) => {
              const pa = Profesionales.porId(profId);
              return `<div class="prof-adicional-chip">
                <span>${esc(Profesionales.nombreCompleto(pa))}</span>
                <button class="btn btn-sm btn-danger" onclick="quitarProfAdicional('${fecha}','${sesionId}',${i})">✕</button>
              </div>`;
            }).join('');
          })()}
        </div>
        ${(sesion.profesionalesAdicionales || []).length < 2 ? `
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <select id="prof-adicional-sel" class="select-field" style="flex:1">
            <option value="">— Elegir profesional —</option>
            ${Profesionales.activos().filter(p =>
              p.id !== sesion.profesionalId &&
              !(sesion.profesionalesAdicionales||[]).includes(p.id)
            ).map(p =>
              `<option value="${p.id}">${esc(Profesionales.nombreCompleto(p))}</option>`
            ).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="agregarProfAdicional('${fecha}','${sesionId}')">+ Agregar</button>
        </div>` : ''}
      </div>

      <div class="sesion-accion-sep">o</div>

      <div class="sesion-accion-bloque sesion-accion-eliminar">
        <button class="btn btn-danger btn-sm" onclick="eliminarSesion('${sesionId}','${fecha}')">🗑 Eliminar esta sesión</button>
      </div>

      <div class="sesion-accion-sep">o</div>

      <div class="sesion-accion-bloque">
        <h4>Mover a otro horario</h4>
        <div class="text-muted" style="font-size:11px;margin-bottom:8px">
          Mueve esta sesión a un slot vacío del mismo paciente, manteniendo el mismo profesional y disciplina.
        </div>
        <button class="btn btn-mover" onclick="iniciarModoMover('${sesionId}','${fecha}')">
          ↕ Mover a slot vacío
        </button>
      </div>

      <div class="sesion-accion-sep">o</div>

      <div class="sesion-accion-bloque">
        <h4>Intercambiar con otra sesión</h4>
        <div class="text-muted" style="font-size:11px;margin-bottom:8px">
          Seleccioná esta sesión y luego otra para intercambiar sus horarios.<br>
          Los pares profesional-paciente se mantienen, solo cambia cuándo ocurren.
        </div>
        <button class="btn btn-swap" onclick="iniciarModoSwap('${sesionId}','${fecha}')">
          ↔ Intercambiar (2 sesiones)
        </button>
        <button class="btn btn-swap btn-rotacion" onclick="iniciarModoRotacion('${sesionId}','${fecha}')" style="margin-top:6px">
          ↻ Rotar en cadena (3+)
        </button>
      </div>
    </div>
  </div>`;

  abrirModal(html);
}

function _verificarViolacionesSesion(fecha, sesion) {
  const avisos = [];
  const estado  = DiasState.delDia(fecha);
  const bloqueos = (estado.bloquesPacientes || {})[sesion.pacienteId] || [];

  // Horario bloqueado para el paciente
  const bloqEnSlot = bloqueos.find(b => b.slotId === sesion.slotId);
  if (bloqEnSlot) {
    const slot = SLOTS.find(s => s.id === sesion.slotId);
    avisos.push(`Horario bloqueado: ${slot?.label}${bloqEnSlot.motivo ? ' — "' + bloqEnSlot.motivo + '"' : ''}.`);
  }

  // Límite diario de disciplina superado
  const pac    = Pacientes.porId(sesion.pacienteId);
  const limite = pac?.limitesDiarios?.[sesion.disciplina];
  if (limite > 0) {
    const total = Asignaciones.delDia(fecha)
      .filter(s => s.pacienteId === sesion.pacienteId && s.disciplina === sesion.disciplina).length;
    if (total > limite) {
      avisos.push(`Límite diario de ${discLabel(sesion.disciplina)}: ${total} sesiones programadas, máximo permitido: ${limite}.`);
    }
  }

  return avisos;
}

function guardarCambioSesion(fecha, sesionId) {
  const nuevoId = document.getElementById('nuevo-prof').value;
  const sesion  = Asignaciones.delDia(fecha).find(s => s.id === sesionId);
  if (!sesion) return;

  const avisos = _verificarViolacionesSesion(fecha, sesion);
  if (avisos.length === 0) {
    _aplicarCambioSesion(fecha, sesionId, nuevoId);
    return;
  }

  const paciente  = Pacientes.porId(sesion.pacienteId);
  const nuevoProf = Profesionales.porId(nuevoId);
  abrirModal(`
    <div class="modal-header">
      <h3>Confirmar modificación</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="aviso-restricciones">
        <div class="aviso-icono">⚠</div>
        <div>
          <strong>${esc(paciente?.apellido)}, ${esc(paciente?.nombre)} — limitaciones activas:</strong>
          <ul class="aviso-lista">
            ${avisos.map(a => `<li>${esc(a)}</li>`).join('')}
          </ul>
          <p class="aviso-pregunta">¿Confirmar el cambio de todas formas?</p>
          ${nuevoProf ? `<p class="aviso-detalle">Nuevo profesional: <strong>${esc(Profesionales.nombreCompleto(nuevoProf))}</strong></p>` : ''}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="_aplicarCambioSesion('${fecha}','${sesionId}','${nuevoId}')">Guardar de todas formas</button>
    </div>`);
}

function _aplicarCambioSesion(fecha, sesionId, nuevoId) {
  Asignaciones.actualizarSesion(fecha, sesionId, { profesionalId: nuevoId });
  cerrarModal();
  renderVista();
  mostrarToast('Sesión modificada', 'info');
}

// ─── Modo swap ────────────────────────────────────────────────────────────────

// ─── Cola de sesiones desplazadas ────────────────────────────────────────────

function _desplazarACola(sesion, fecha) {
  sesionesCola.push({
    pacienteId:    sesion.pacienteId,
    profesionalId: sesion.profesionalId,
    disciplina:    sesion.disciplina,
    slotOriginal:  sesion.slotId,
    esAlmuerzo:    sesion.esAlmuerzo || false,
    motivo:        sesion.motivo     || '',
    urgente:       sesion.urgente    || false,
  });
  const sesiones = Asignaciones.delDia(fecha).filter(s => s.id !== sesion.id);
  Asignaciones.guardarDia(fecha, sesiones);
}

function abrirModalConflicto(sesionConflicto, descripcion, cbForzar) {
  const pac  = Pacientes.porId(sesionConflicto.pacienteId);
  const prof = Profesionales.porId(sesionConflicto.profesionalId);
  const slot = SLOTS.find(s => s.id === sesionConflicto.slotId);
  window._cbForzarConflicto = () => { cbForzar(sesionConflicto); };
  abrirModal(`
    <div class="modal-header">
      <h3>Conflicto de horario</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <p class="text-muted" style="margin-bottom:12px">${esc(descripcion)}</p>
      <div class="conflicto-sesion-card">
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Paciente</span>
          <span>${esc(pac?.apellido || '—')}${pac?.nombre ? ', ' + esc(pac.nombre) : ''}</span>
        </div>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Disciplina</span>
          ${discChip(sesionConflicto.disciplina, true)}
        </div>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Profesional</span>
          <span>${esc(Profesionales.nombreCompleto(prof))}</span>
        </div>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Horario</span>
          <span>${esc(slot?.label || sesionConflicto.slotId)}</span>
        </div>
      </div>
      <div class="conflicto-advertencia">
        ⚠ Esta sesión se retirará de la grilla y quedará en la cola de pendientes para que la reasignes.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-warning" onclick="window._cbForzarConflicto()">Desplazar y continuar →</button>
    </div>`);
}

function iniciarColocarDeCola(idx) {
  modoColocarDeCola = { idx };
  modoMover = null;
  renderVista();
}

function cancelarColocarDeCola() {
  modoColocarDeCola = null;
  renderVista();
}

function descartarDeCola(idx) {
  sesionesCola.splice(idx, 1);
  if (modoColocarDeCola?.idx === idx) modoColocarDeCola = null;
  else if (modoColocarDeCola?.idx > idx) modoColocarDeCola.idx--;
  renderVista();
}

function ejecutarColocarDeCola(slotId, fecha) {
  if (modoColocarDeCola === null) return;
  const item = sesionesCola[modoColocarDeCola.idx];
  if (!item) { modoColocarDeCola = null; renderVista(); return; }

  const sesiones = Asignaciones.delDia(fecha);

  // Conflicto de paciente en el slot destino
  const conflictoPac = sesiones.find(s => s.pacienteId === item.pacienteId && s.slotId === slotId);
  if (conflictoPac) {
    abrirModalConflicto(conflictoPac,
      `${Pacientes.porId(item.pacienteId)?.apellido} ya tiene una sesión en ese horario.`,
      (sc) => {
        _desplazarACola(sc, fecha);
        cerrarModal();
        _colocarItemDeCola(modoColocarDeCola.idx, slotId, fecha);
      }
    );
    return;
  }

  // Conflicto de profesional en el slot destino
  const conflictoProf = sesiones.find(s => s.profesionalId === item.profesionalId && s.slotId === slotId);
  if (conflictoProf) {
    const esKtrDual = item.disciplina === 'kinesiologiaRespiratoria'
      && conflictoProf.disciplina === 'kinesiologiaRespiratoria';
    const pacNuevo     = Pacientes.porId(item.pacienteId);
    const pacExistente = Pacientes.porId(conflictoProf.pacienteId);
    const mismoEdif    = pacNuevo?.edificio && pacNuevo.edificio === pacExistente?.edificio;
    const ningBloquea  = !pacNuevo?.bloqueaKTR && !pacExistente?.bloqueaKTR;
    if (!esKtrDual || !mismoEdif || !ningBloquea) {
      const profNombre = Profesionales.porId(item.profesionalId)?.apellido || 'El profesional';
      abrirModalConflicto(conflictoProf,
        `${profNombre} ya tiene una sesión en ese horario.`,
        (sc) => {
          _desplazarACola(sc, fecha);
          cerrarModal();
          _colocarItemDeCola(modoColocarDeCola.idx, slotId, fecha);
        }
      );
      return;
    }
  }

  _colocarItemDeCola(modoColocarDeCola.idx, slotId, fecha);
}

function _colocarItemDeCola(idx, slotId, fecha) {
  const item = sesionesCola[idx];
  Asignaciones.crearSesionManual(fecha, item.pacienteId, item.profesionalId, item.disciplina, slotId);
  sesionesCola.splice(idx, 1);
  modoColocarDeCola = null;
  mostrarToast('Sesión colocada', 'success');
  renderVista();
}

function iniciarModoMover(sesionId, fecha) {
  const sesion = Asignaciones.delDia(fecha).find(s => s.id === sesionId);
  if (!sesion) return;
  modoMover = { sesionId, fecha, pacienteId: sesion.pacienteId };
  cerrarModal();
  renderVista();
}

function cancelarModoMover() {
  modoMover = null;
  renderVista();
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

function _dragValidarMover(fecha, sesionId, nuevoSlotId) {
  const sesiones = Asignaciones.delDia(fecha);
  const sesion   = sesiones.find(s => s.id === sesionId);
  if (!sesion || sesion.slotId === nuevoSlotId) return { ok: false, razones: [] };
  const estado  = DiasState.delDia(fecha);
  const pac     = Pacientes.porId(sesion.pacienteId);
  const razones = [];
  if ((estado.bloquesPacientes?.[sesion.pacienteId] || []).some(b => b.slotId === nuevoSlotId))
    razones.push('Ese horario está bloqueado para el paciente (bloqueo del día)');
  if ((pac?.bloqueosPermanentes || []).some(b => b.slotId === nuevoSlotId))
    razones.push('Ese horario tiene un bloqueo permanente del paciente');
  if (sesiones.some(s => s.id !== sesionId && s.pacienteId === sesion.pacienteId && s.slotId === nuevoSlotId))
    razones.push('El paciente ya tiene otra sesión asignada en ese horario — se desplazará a la cola');
  if (sesiones.some(s => s.id !== sesionId && s.profesionalId === sesion.profesionalId && s.slotId === nuevoSlotId))
    razones.push('El profesional ya tiene otra sesión en ese horario — se desplazará a la cola');
  return razones.length ? { ok: false, razones } : { ok: true, razones: [] };
}

function _dragValidarSwap(fecha, sesionIdA, sesionIdB) {
  const sesiones = Asignaciones.delDia(fecha);
  const A = sesiones.find(s => s.id === sesionIdA);
  const B = sesiones.find(s => s.id === sesionIdB);
  if (!A || !B || A.slotId === B.slotId) return { ok: false, razones: [] };
  const estado  = DiasState.delDia(fecha);
  const pacA    = Pacientes.porId(A.pacienteId);
  const pacB    = Pacientes.porId(B.pacienteId);
  const razones = [];
  if ((estado.bloquesPacientes?.[A.pacienteId] || []).some(b => b.slotId === B.slotId)
    || (pacA?.bloqueosPermanentes || []).some(b => b.slotId === B.slotId))
    razones.push(`${pacA?.apellido || 'Paciente A'} tiene bloqueado el horario destino`);
  if ((estado.bloquesPacientes?.[B.pacienteId] || []).some(b => b.slotId === A.slotId)
    || (pacB?.bloqueosPermanentes || []).some(b => b.slotId === A.slotId))
    razones.push(`${pacB?.apellido || 'Paciente B'} tiene bloqueado el horario destino`);
  if (sesiones.some(s => s.id !== sesionIdA && s.id !== sesionIdB
    && s.profesionalId === A.profesionalId && s.slotId === B.slotId))
    razones.push('El profesional de la sesión arrastrada ya tiene otra sesión en ese horario — se desplazará a la cola');
  if (sesiones.some(s => s.id !== sesionIdA && s.id !== sesionIdB
    && s.profesionalId === B.profesionalId && s.slotId === A.slotId))
    razones.push('El profesional de la sesión destino ya tiene otra sesión en ese horario — se desplazará a la cola');
  return razones.length ? { ok: false, razones } : { ok: true, razones: [] };
}

function _dragEjecutarMover(fecha, sesionId, nuevoSlotId) {
  const nuevoSlot = SLOTS.find(s => s.id === nuevoSlotId);
  if (!nuevoSlot) return;
  Asignaciones.actualizarSesion(fecha, sesionId, {
    slotId: nuevoSlotId, inicio: nuevoSlot.inicio, fin: nuevoSlot.fin,
    esAlmuerzo: nuevoSlot.esAlmuerzo, fijo: true
  });
  renderVista();
  mostrarToast('Sesión movida', 'success');
}

function _dragForzarMover(fecha, sesionId, nuevoSlotId) {
  const sesiones = Asignaciones.delDia(fecha);
  const sesion   = sesiones.find(s => s.id === sesionId);
  if (!sesion) return;
  const conflictos = sesiones.filter(s =>
    s.id !== sesionId && s.slotId === nuevoSlotId &&
    (s.pacienteId === sesion.pacienteId || s.profesionalId === sesion.profesionalId)
  );
  conflictos.forEach(c => _desplazarACola(c, fecha));
  const nuevoSlot = SLOTS.find(s => s.id === nuevoSlotId);
  if (!nuevoSlot) return;
  Asignaciones.actualizarSesion(fecha, sesionId, {
    slotId: nuevoSlotId, inicio: nuevoSlot.inicio, fin: nuevoSlot.fin,
    esAlmuerzo: nuevoSlot.esAlmuerzo, fijo: true
  });
  renderVista();
  mostrarToast(conflictos.length ? 'Sesión movida — las desplazadas quedaron en la cola' : 'Sesión movida (forzado)', 'success');
}

function _dragEjecutarSwap(fecha, sesionIdA, sesionIdB) {
  const sesiones = Asignaciones.delDia(fecha);
  const A = sesiones.find(s => s.id === sesionIdA);
  const B = sesiones.find(s => s.id === sesionIdB);
  if (!A || !B) return;
  const slotA = SLOTS.find(s => s.id === A.slotId);
  const slotB = SLOTS.find(s => s.id === B.slotId);
  const idxA  = sesiones.findIndex(s => s.id === sesionIdA);
  const idxB  = sesiones.findIndex(s => s.id === sesionIdB);
  const now   = new Date().toISOString();
  sesiones[idxA] = { ...A, slotId: B.slotId, inicio: slotB?.inicio||'', fin: slotB?.fin||'', esAlmuerzo: slotB?.esAlmuerzo||false, origen: 'manual', fijo: true, modificadoEn: now };
  sesiones[idxB] = { ...B, slotId: A.slotId, inicio: slotA?.inicio||'', fin: slotA?.fin||'', esAlmuerzo: slotA?.esAlmuerzo||false, origen: 'manual', fijo: true, modificadoEn: now };
  Asignaciones.guardarDia(fecha, sesiones);
  renderVista();
  mostrarToast('Sesiones intercambiadas', 'success');
}

function _dragForzarSwap(fecha, sesionIdA, sesionIdB) {
  // Desplazar sesiones de otros pacientes que ocupen el slot destino del prof correspondiente
  const sesiones = Asignaciones.delDia(fecha);
  const A = sesiones.find(s => s.id === sesionIdA);
  const B = sesiones.find(s => s.id === sesionIdB);
  if (!A || !B) return;
  const conflA = sesiones.find(s => s.id !== sesionIdA && s.id !== sesionIdB && s.profesionalId === A.profesionalId && s.slotId === B.slotId);
  const conflB = sesiones.find(s => s.id !== sesionIdA && s.id !== sesionIdB && s.profesionalId === B.profesionalId && s.slotId === A.slotId);
  if (conflA) _desplazarACola(conflA, fecha);
  if (conflB) _desplazarACola(conflB, fecha);
  _dragEjecutarSwap(fecha, sesionIdA, sesionIdB);
}

function _dragModalConflicto(razones, onForzar) {
  const items = razones.map(r => `<li style="margin-bottom:6px">${r}</li>`).join('');
  abrirModal(`
    <div class="modal-header">
      <h3>Conflicto detectado</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <ul style="margin:0 0 12px 16px;padding:0;line-height:1.6">${items}</ul>
      <p style="color:var(--text-muted);font-size:13px">¿Querés forzar el cambio? Las sesiones afectadas pasarán a la cola de reasignación.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-drag-forzar">Forzar cambio</button>
    </div>
  `);
  document.getElementById('btn-drag-forzar').onclick = () => { cerrarModal(); onForzar(); };
}

// ─────────────────────────────────────────────────────────────────────────────

function ejecutarMover(nuevoSlotId, fecha) {
  if (!modoMover) return;
  const { sesionId, fecha: fechaSrc } = modoMover;
  const sesiones = Asignaciones.delDia(fechaSrc);
  const sesion   = sesiones.find(s => s.id === sesionId);
  if (!sesion) { modoMover = null; renderVista(); return; }

  // Conflicto de paciente en slot destino
  const conflictoPac = sesiones.find(s =>
    s.pacienteId === sesion.pacienteId && s.slotId === nuevoSlotId && s.id !== sesionId
  );
  if (conflictoPac) {
    abrirModalConflicto(conflictoPac, 'El paciente ya tiene una sesión en ese horario.', (sc) => {
      _desplazarACola(sc, fechaSrc);
      Asignaciones.actualizarSesion(fechaSrc, sesionId, { slotId: nuevoSlotId });
      modoMover = null;
      cerrarModal();
      renderVista();
      mostrarToast('Sesión movida — la desplazada está en la cola', 'success');
    });
    return;
  }

  // Conflicto de profesional en slot destino
  const conflictoProf = sesiones.find(s =>
    s.slotId === nuevoSlotId && s.profesionalId === sesion.profesionalId && s.id !== sesionId
  );
  if (conflictoProf) {
    const profNombre = Profesionales.porId(sesion.profesionalId)?.apellido || 'El profesional';
    abrirModalConflicto(conflictoProf, `${profNombre} ya tiene una sesión en ese horario.`, (sc) => {
      _desplazarACola(sc, fechaSrc);
      Asignaciones.actualizarSesion(fechaSrc, sesionId, { slotId: nuevoSlotId });
      modoMover = null;
      cerrarModal();
      renderVista();
      mostrarToast('Sesión movida — la desplazada está en la cola', 'success');
    });
    return;
  }

  Asignaciones.actualizarSesion(fechaSrc, sesionId, { slotId: nuevoSlotId });
  mostrarToast('Sesión movida', 'success');
  modoMover = null;
  renderVista();
}

function iniciarModoSwap(sesionId, fecha) {
  modoSwap = { sesionId, fecha };
  cerrarModal();
  _mostrarBannerSwap();
  // Marcar celdas de la sesión seleccionada
  document.querySelectorAll(`.celda-sesion[data-sesion-id="${sesionId}"]`)
          .forEach(c => c.classList.add('swap-origen'));
}

function cancelarModoSwap() {
  modoSwap = null;
  document.getElementById('banner-swap')?.remove();
  document.querySelectorAll('.swap-origen, .swap-candidata')
          .forEach(c => c.classList.remove('swap-origen', 'swap-candidata'));
}

function _mostrarBannerSwap() {
  document.getElementById('banner-swap')?.remove();
  const s = Asignaciones.delDia(modoSwap.fecha).find(s => s.id === modoSwap.sesionId);
  const pac = Pacientes.porId(s?.pacienteId);
  const prof = Profesionales.porId(s?.profesionalId);
  const slot = SLOTS.find(sl => sl.id === s?.slotId);

  const banner = document.createElement('div');
  banner.id = 'banner-swap';
  banner.innerHTML = `
    <span class="banner-swap-icono">↔</span>
    <span>Intercambiando: <strong>${esc(pac?.apellido)}, ${esc(pac?.nombre)}</strong>
      con <strong>${esc(Profesionales.nombreCompleto(prof))}</strong> a las <strong>${esc(slot?.label)}</strong>
      — Clickeá la segunda sesión en la grilla</span>
    <button class="btn btn-sm btn-secondary" onclick="cancelarModoSwap()">Cancelar</button>`;
  document.querySelector('.main-content')?.prepend(banner);

  // Resaltar celdas candidatas (sesiones distintas a la seleccionada)
  document.querySelectorAll('.celda-sesion').forEach(c => {
    if (c.dataset.sesionId !== modoSwap.sesionId) c.classList.add('swap-candidata');
  });
}

function _validarSwap(s1, s2) {
  // ── Bloqueos duros (no se pueden sortear) ──
  if (s1.slotId === s2.slotId && s1.profesionalId === s2.profesionalId)
    return { valido: false, duro: true, razon: 'Son la misma sesión.' };
  if (s1.slotId === s2.slotId)
    return { valido: false, duro: true, razon: 'Ambas sesiones están en el mismo horario. Para intercambiar pacientes en el mismo slot usá "Cambiar profesional" en cada una.' };

  const sesiones = Asignaciones.delDia(s1.fecha || fechaActiva);
  const estado   = DiasState.delDia(s1.fecha || fechaActiva);
  const bloqueos = estado.bloquesPacientes || {};

  const bloqPac1 = (bloqueos[s1.pacienteId] || []).map(b => b.slotId);
  const bloqPac2 = (bloqueos[s2.pacienteId] || []).map(b => b.slotId);

  if (bloqPac1.includes(s2.slotId)) {
    const p = Pacientes.porId(s1.pacienteId);
    return { valido: false, duro: true, razon: `${p?.apellido} tiene el horario ${SLOTS.find(sl=>sl.id===s2.slotId)?.label} bloqueado.` };
  }
  if (bloqPac2.includes(s1.slotId)) {
    const p = Pacientes.porId(s2.pacienteId);
    return { valido: false, duro: true, razon: `${p?.apellido} tiene el horario ${SLOTS.find(sl=>sl.id===s1.slotId)?.label} bloqueado.` };
  }

  // ── Conflictos desplazables (terceras sesiones que ocupan el slot destino) ──
  const conflictos = [];

  const cProf1 = sesiones.find(s =>
    s.id !== s1.id && s.id !== s2.id &&
    s.profesionalId === s1.profesionalId && s.slotId === s2.slotId
  );
  if (cProf1) {
    const p = Profesionales.porId(s1.profesionalId);
    conflictos.push({ sesion: cProf1, desc: `${Profesionales.nombreCompleto(p)} ya tiene otra sesión a las ${SLOTS.find(sl=>sl.id===s2.slotId)?.label}.` });
  }

  const cProf2 = sesiones.find(s =>
    s.id !== s1.id && s.id !== s2.id &&
    s.profesionalId === s2.profesionalId && s.slotId === s1.slotId
  );
  if (cProf2) {
    const p = Profesionales.porId(s2.profesionalId);
    conflictos.push({ sesion: cProf2, desc: `${Profesionales.nombreCompleto(p)} ya tiene otra sesión a las ${SLOTS.find(sl=>sl.id===s1.slotId)?.label}.` });
  }

  const cPac1 = sesiones.find(s =>
    s.id !== s1.id && s.pacienteId === s1.pacienteId && s.slotId === s2.slotId
  );
  if (cPac1) {
    const p = Pacientes.porId(s1.pacienteId);
    conflictos.push({ sesion: cPac1, desc: `${p?.apellido} ya tiene otra sesión a las ${SLOTS.find(sl=>sl.id===s2.slotId)?.label}.` });
  }

  const cPac2 = sesiones.find(s =>
    s.id !== s2.id && s.pacienteId === s2.pacienteId && s.slotId === s1.slotId
  );
  if (cPac2) {
    const p = Pacientes.porId(s2.pacienteId);
    conflictos.push({ sesion: cPac2, desc: `${p?.apellido} ya tiene otra sesión a las ${SLOTS.find(sl=>sl.id===s1.slotId)?.label}.` });
  }

  if (conflictos.length > 0) {
    return { valido: false, duro: false, conflictos };
  }

  // ── Advertencias (no bloquean): límites diarios superados ──
  const avisos = [];
  [[s1, s2.slotId], [s2, s1.slotId]].forEach(([s, nuevoSlot]) => {
    const pac    = Pacientes.porId(s.pacienteId);
    const limite = pac?.limitesDiarios?.[s.disciplina];
    if (limite > 0) {
      const total = sesiones.filter(x => x.pacienteId === s.pacienteId && x.disciplina === s.disciplina).length;
      if (total > limite) {
        avisos.push(`${pac?.apellido}, ${pac?.nombre}: ${discLabel(s.disciplina)} tiene ${total} sesiones hoy (máx. ${limite}).`);
      }
    }
  });

  return { valido: true, avisos };
}

function confirmarSwap(sesion2Id, fecha2) {
  if (!modoSwap) return;

  const sesiones1 = Asignaciones.delDia(modoSwap.fecha);
  const sesiones2 = Asignaciones.delDia(fecha2);
  const s1 = sesiones1.find(s => s.id === modoSwap.sesionId);
  const s2 = sesiones2.find(s => s.id === sesion2Id);
  if (!s1 || !s2) return;

  if (modoSwap.fecha !== fecha2) {
    mostrarToast('Solo se pueden intercambiar sesiones del mismo día.', 'warning');
    return;
  }

  const pac1  = Pacientes.porId(s1.pacienteId);
  const prof1 = Profesionales.porId(s1.profesionalId);
  const slot1 = SLOTS.find(sl => sl.id === s1.slotId);
  const pac2  = Pacientes.porId(s2.pacienteId);
  const prof2 = Profesionales.porId(s2.profesionalId);
  const slot2 = SLOTS.find(sl => sl.id === s2.slotId);

  const validacion = _validarSwap(s1, s2);
  const { valido, avisos = [], conflictos = [], duro = false, razon = '' } = validacion;

  const d  = DISCIPLINAS[s1.disciplina];
  const d2 = DISCIPLINAS[s2.disciplina];

  const previewHtml = `
    <div class="swap-preview">
      <div class="swap-card swap-card-a">
        <div class="swap-slot-lbl">${esc(slot1?.label)}</div>
        <div class="swap-disc" style="background:${d?.bg||'#f0f0f0'};color:${d?.color||'#333'};border-color:${d?.border||'#ccc'}">${discLabel(s1.disciplina)}</div>
        <div class="swap-pac"><strong>${esc(pac1?.apellido)}, ${esc(pac1?.nombre)}</strong></div>
        <div class="swap-prof text-muted">${esc(Profesionales.nombreCompleto(prof1))}</div>
      </div>
      <div class="swap-arrow">↔</div>
      <div class="swap-card swap-card-b">
        <div class="swap-slot-lbl">${esc(slot2?.label)}</div>
        <div class="swap-disc" style="background:${d2?.bg||'#f0f0f0'};color:${d2?.color||'#333'};border-color:${d2?.border||'#ccc'}">${discLabel(s2.disciplina)}</div>
        <div class="swap-pac"><strong>${esc(pac2?.apellido)}, ${esc(pac2?.nombre)}</strong></div>
        <div class="swap-prof text-muted">${esc(Profesionales.nombreCompleto(prof2))}</div>
      </div>
    </div>
    <div class="swap-resultado-lbl">Resultado del intercambio:</div>
    <div class="swap-preview swap-preview-resultado">
      <div class="swap-card">
        <div class="swap-slot-lbl">${esc(slot2?.label)}</div>
        <div class="swap-pac"><strong>${esc(pac1?.apellido)}, ${esc(pac1?.nombre)}</strong></div>
        <div class="swap-prof text-muted">${esc(Profesionales.nombreCompleto(prof1))}</div>
      </div>
      <div class="swap-arrow">+</div>
      <div class="swap-card">
        <div class="swap-slot-lbl">${esc(slot1?.label)}</div>
        <div class="swap-pac"><strong>${esc(pac2?.apellido)}, ${esc(pac2?.nombre)}</strong></div>
        <div class="swap-prof text-muted">${esc(Profesionales.nombreCompleto(prof2))}</div>
      </div>
    </div>`;

  // Caso: bloqueo duro — no hay forma de proceder
  if (!valido && duro) {
    abrirModal(`
      <div class="modal-header">
        <h3>Confirmar intercambio</h3>
        <button class="modal-close" onclick="cerrarModal();cancelarModoSwap()">✕</button>
      </div>
      <div class="modal-body">
        ${previewHtml}
        <div class="swap-error">⚠ ${esc(razon)}</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="cerrarModal();cancelarModoSwap()">Cancelar</button>
      </div>`);
    return;
  }

  // Caso: hay sesiones de terceros que entran en conflicto — se pueden desplazar
  if (!valido && conflictos.length > 0) {
    const conflictIds = conflictos.map(c => c.sesion.id).join(',');
    const conflictosHtml = conflictos.map(c => {
      const cpac  = Pacientes.porId(c.sesion.pacienteId);
      const cprof = Profesionales.porId(c.sesion.profesionalId);
      const cslot = SLOTS.find(sl => sl.id === c.sesion.slotId);
      return `<div class="conflicto-sesion-card" style="margin-top:8px">
        <p class="text-muted" style="margin:0 0 6px;font-size:12px">${esc(c.desc)}</p>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Paciente</span>
          <span>${esc(cpac?.apellido || '—')}</span>
        </div>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Disciplina</span>
          ${discChip(c.sesion.disciplina, true)}
        </div>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Profesional</span>
          <span>${esc(Profesionales.nombreCompleto(cprof))}</span>
        </div>
        <div class="conflicto-sesion-fila">
          <span class="conflicto-lbl">Horario</span>
          <span>${esc(cslot?.label || c.sesion.slotId)}</span>
        </div>
      </div>`;
    }).join('');
    abrirModal(`
      <div class="modal-header">
        <h3>Confirmar intercambio</h3>
        <button class="modal-close" onclick="cerrarModal();cancelarModoSwap()">✕</button>
      </div>
      <div class="modal-body">
        ${previewHtml}
        <div class="conflicto-advertencia" style="margin-top:14px">
          ⚠ El intercambio requiere desplazar ${conflictos.length === 1 ? 'esta sesión' : 'estas sesiones'} a la cola de pendientes:
        </div>
        ${conflictosHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="cerrarModal();cancelarModoSwap()">Cancelar</button>
        <button class="btn btn-warning" onclick="ejecutarSwapConDesplazamiento('${s1.id}','${s2.id}','${fecha2}','${conflictIds}')">Desplazar y continuar →</button>
      </div>`);
    return;
  }

  // Caso normal: válido (con posibles advertencias)
  abrirModal(`
    <div class="modal-header">
      <h3>Confirmar intercambio</h3>
      <button class="modal-close" onclick="cerrarModal();cancelarModoSwap()">✕</button>
    </div>
    <div class="modal-body">
      ${previewHtml}
      ${avisos.length > 0 ? `
        <div class="aviso-restricciones" style="margin-top:12px">
          <div class="aviso-icono">⚠</div>
          <div>
            <strong>Advertencia — limitaciones activas en estas sesiones:</strong>
            <ul class="aviso-lista">${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
            <p class="aviso-pregunta">El intercambio es válido pero hay límites superados.</p>
          </div>
        </div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal();cancelarModoSwap()">Cancelar</button>
      <button class="btn btn-primary" onclick="ejecutarSwap('${s1.id}','${s2.id}','${fecha2}')">Confirmar intercambio</button>
    </div>`);
}

function ejecutarSwap(id1, id2, fecha, toastMsg = 'Intercambio realizado') {
  const sesiones = [...Asignaciones.delDia(fecha)];
  const i1 = sesiones.findIndex(s => s.id === id1);
  const i2 = sesiones.findIndex(s => s.id === id2);
  if (i1 < 0 || i2 < 0) return;

  const slot1 = { slotId: sesiones[i1].slotId, inicio: sesiones[i1].inicio, fin: sesiones[i1].fin };
  const slot2 = { slotId: sesiones[i2].slotId, inicio: sesiones[i2].inicio, fin: sesiones[i2].fin };

  sesiones[i1] = { ...sesiones[i1], ...slot2, origen: 'manual', modificadoEn: new Date().toISOString() };
  sesiones[i2] = { ...sesiones[i2], ...slot1, origen: 'manual', modificadoEn: new Date().toISOString() };

  Asignaciones.guardarDia(fecha, sesiones);

  const pac1 = Pacientes.porId(sesiones[i1].pacienteId);
  const pac2 = Pacientes.porId(sesiones[i2].pacienteId);
  Auditoria.registrar({
    tipo: 'modificacion_manual',
    fecha,
    descripcion: `Intercambio: ${pac1?.apellido} (${slot1.slotId}→${slot2.slotId}) ↔ ${pac2?.apellido} (${slot2.slotId}→${slot1.slotId})`
  });

  cancelarModoSwap();
  cerrarModal();
  renderVista();
  mostrarToast(toastMsg, 'success');
}

function ejecutarSwapConDesplazamiento(id1, id2, fecha, conflictIdsStr) {
  const conflictIds = conflictIdsStr.split(',').filter(Boolean);
  for (const cId of conflictIds) {
    const sesConf = Asignaciones.delDia(fecha).find(s => s.id === cId);
    if (sesConf) _desplazarACola(sesConf, fecha);
  }
  const n = conflictIds.length;
  ejecutarSwap(id1, id2, fecha,
    `Intercambio realizado — ${n} sesión${n > 1 ? 'es' : ''} desplazada${n > 1 ? 's' : ''} a la cola`);
}

function abrirModalLimpiarSesiones(fecha) {
  const sesiones = Asignaciones.delDia(fecha);
  if (!sesiones.length) return;

  // Profesionales con sesiones ese día
  const profIds = [...new Set(sesiones.map(s => s.profesionalId))];
  const profsOpts = profIds.map(id => {
    const p = Profesionales.porId(id);
    return `<option value="${id}">${esc(p ? `${p.apellido}, ${p.nombre}` : id)}</option>`;
  }).join('');

  abrirModal(`
    <div class="modal-header">
      <h3>Eliminar sesiones del día</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom:16px">Elegí qué sesiones del <strong>${formatFecha(fecha)}</strong> querés eliminar:</p>
      <div class="limpiar-opciones">
        <label class="limpiar-opcion">
          <input type="radio" name="limpiar_modo" value="todas" checked>
          <div>
            <strong>Todas las sesiones</strong>
            <div class="text-muted">${sesiones.length} sesión${sesiones.length !== 1 ? 'es' : ''} en total</div>
          </div>
        </label>
        <label class="limpiar-opcion">
          <input type="radio" name="limpiar_modo" value="prof">
          <div>
            <strong>Solo de un profesional</strong>
            <select id="limpiar-prof-sel" class="select-field" style="margin-top:6px;width:100%"
              onclick="document.querySelector('input[name=limpiar_modo][value=prof]').checked=true">
              ${profsOpts}
            </select>
          </div>
        </label>
      </div>
      <div class="aviso-restricciones" style="margin-top:16px">
        <div class="aviso-icono">⚠</div>
        <div>Las sesiones marcadas como <strong>fijas 🔒</strong> también serán eliminadas.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="ejecutarLimpiezaSesiones('${fecha}')">Eliminar</button>
    </div>`);
}

function ejecutarLimpiezaSesiones(fecha) {
  const modo   = document.querySelector('input[name="limpiar_modo"]:checked')?.value;
  const profId = document.getElementById('limpiar-prof-sel')?.value;
  const sesiones = Asignaciones.delDia(fecha);

  let eliminadas, restantes;
  if (modo === 'prof' && profId) {
    eliminadas = sesiones.filter(s => s.profesionalId === profId);
    restantes  = sesiones.filter(s => s.profesionalId !== profId);
  } else {
    eliminadas = sesiones;
    restantes  = [];
  }

  if (!eliminadas.length) { cerrarModal(); return; }

  Asignaciones.guardarDia(fecha, restantes);
  const prof = modo === 'prof' ? Profesionales.porId(profId) : null;
  Auditoria.registrar({
    tipo: 'eliminacion_manual',
    fecha,
    descripcion: prof
      ? `Eliminadas ${eliminadas.length} sesiones de ${prof.apellido}, ${prof.nombre}`
      : `Eliminadas todas las sesiones del día (${eliminadas.length})`
  });

  cerrarModal();
  renderVista();
  mostrarToast(
    prof ? `${eliminadas.length} sesión${eliminadas.length !== 1 ? 'es' : ''} de ${prof.apellido} eliminada${eliminadas.length !== 1 ? 's' : ''}` : 'Agenda del día borrada',
    'info'
  );
}

function eliminarSesion(sesionId, fecha) {
  const sesiones = Asignaciones.delDia(fecha);
  const sesion = sesiones.find(s => s.id === sesionId);
  if (!sesion) return;
  const pac  = Pacientes.porId(sesion.pacienteId);
  const slot = SLOTS.find(s => s.id === sesion.slotId);
  if (!confirm(`¿Eliminar la sesión de ${pac?.apellido}, ${pac?.nombre} a las ${slot?.label}?`)) return;
  const nuevas = sesiones.filter(s => s.id !== sesionId);
  Asignaciones.guardarDia(fecha, nuevas);
  Auditoria.registrar({
    tipo: 'eliminacion_manual',
    fecha,
    descripcion: `Eliminada sesión de ${pac?.apellido} (${discLabel(sesion.disciplina)}, ${slot?.label})`
  });
  cerrarModal();
  renderVista();
  mostrarToast('Sesión eliminada', 'info');
}

// ─── Modal de comparación de agendas empatadas ───────────────────────────────

function abrirModalComparacionAgendas(candidatos, fecha) {
  const pacientes = Pacientes.activos()
    .sort((a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a));

  function renderGrillaMini(sesiones) {
    let g = `<div class="comp-grid-wrapper"><table class="comp-grid">
      <thead><tr>
        <th class="comp-th-pac">Paciente</th>
        ${SLOTS.filter(s => !s.esAlmuerzo).map(s => `<th>${esc(s.label)}</th>`).join('')}
        <th>T</th>
      </tr></thead><tbody>`;

    pacientes.forEach(pac => {
      const misSes = sesiones.filter(s => s.pacienteId === pac.id && !s.esAlmuerzo);
      if (misSes.length === 0 && sesiones.every(s => s.pacienteId !== pac.id)) return;
      g += `<tr><td class="comp-pac-cell">${esc(pac.apellido)}, ${esc(pac.nombre)}</td>`;
      SLOTS.filter(s => !s.esAlmuerzo).forEach(slot => {
        const ses = misSes.find(s => s.slotId === slot.id);
        if (ses) {
          const disc = DISCIPLINAS[ses.disciplina];
          const prof = Profesionales.porId(ses.profesionalId);
          g += `<td class="comp-celda" style="background:${disc?.bg || '#eee'};color:${disc?.color || '#333'}">
            <span class="comp-disc">${esc(disc?.corto || ses.disciplina)}</span>
            <span class="comp-prof">${esc(Profesionales.iniciales(prof))}</span>
          </td>`;
        } else {
          const bloqueado = (pac.bloqueosPermanentes || []).some(b => b.slotId === slot.id)
            || (DiasState.delDia(fecha).bloquesPacientes?.[pac.id] || []).some(b => b.slotId === slot.id);
          g += bloqueado ? `<td class="comp-celda-bloq">🚫</td>` : `<td class="comp-celda-vacia"></td>`;
        }
      });
      g += `<td class="comp-total">${misSes.length}</td></tr>`;
    });

    g += `</tbody></table></div>`;
    return g;
  }

  function renderDetallePacientes(indice) {
    return indice.detallesPacientes.map(d => {
      const color = d.pct >= 90 ? 'var(--color-success)' : d.pct >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';
      return `<span class="comp-detalle-pac" style="color:${color}" title="${esc(d.nombre)}: ${d.cubiertas}/${d.necesitadas} sesiones">
        ${esc(d.nombre.split(' ')[0])}: ${d.pct}%
      </span>`;
    }).join('');
  }

  const tabsHtml = candidatos.map((c, i) =>
    `<button class="comp-tab-btn${i === 0 ? ' active' : ''}" data-tab="${i}" onclick="compCambiarTab(${i})">
      Opción ${i + 1}
    </button>`
  ).join('');

  const panelsHtml = candidatos.map((c, i) => {
    const deficits = c.alertas.filter(a => a.tipo === 'deficit_horas').length;
    const deficitHtml = deficits > 0
      ? `<div class="comp-deficit">⚠ ${deficits} paciente(s) con déficit de horas</div>` : '';
    return `<div class="comp-panel${i === 0 ? '' : ' hidden'}" id="comp-panel-${i}">
      <div class="comp-panel-header">
        <div class="comp-score-bloque">
          <span class="comp-score-num">${c.indice.score}%</span>
          <span class="comp-score-label">índice de calidad</span>
        </div>
        <div class="comp-detalle-wrap">${renderDetallePacientes(c.indice)}</div>
        ${deficitHtml}
      </div>
      <div class="comp-orden-info">
        Orden de priorización: <strong>${c.primerPaciente ? esc(c.primerPaciente.apellido + ', ' + c.primerPaciente.nombre) : '—'}</strong> primero
      </div>
      ${renderGrillaMini(c.sesiones)}
      <div class="comp-footer">
        <button class="btn btn-secondary" onclick="exportarOpcionPDF(${i})">📄 PDF</button>
        <button class="btn btn-primary" onclick="aplicarAgendaCandidato(${i})">
          ✓ Usar esta agenda
        </button>
      </div>
    </div>`;
  }).join('');

  // Guardar candidatos en variable global para que aplicarAgendaCandidato los acceda
  window._compCandidatos = candidatos;
  window._compFecha      = fecha;

  abrirModal(`
    <div class="modal-header">
      <h3>Agendas equivalentes — elegí la mejor opción</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body modal-body-comp">
      <div class="comp-info-banner">
        Se generaron <strong>${candidatos.length} agendas con el mismo índice de calidad</strong>.
        Revisá cada opción y elegí la que mejor se adapte al criterio del equipo.
        La Opción 1 ya está activa y se usará si cerrás sin elegir.
      </div>
      <div class="comp-tabs">${tabsHtml}</div>
      ${panelsHtml}
    </div>
  `, 'wide');
}

function compCambiarTab(idx) {
  document.querySelectorAll('.comp-tab-btn').forEach((b, i) =>
    b.classList.toggle('active', i === idx));
  document.querySelectorAll('.comp-panel').forEach((p, i) =>
    p.classList.toggle('hidden', i !== idx));
}

function aplicarAgendaCandidato(idx) {
  const candidatos = window._compCandidatos;
  const fecha      = window._compFecha;
  if (!candidatos || !fecha) return;

  const elegida = candidatos[idx];
  Asignaciones.guardarDia(fecha, elegida.sesiones);
  Historial.registrarBulk(fecha, elegida.sesiones);
  Auditoria.registrar({
    tipo: 'eleccion_agenda',
    fecha,
    descripcion: `Usuario eligió Opción ${idx + 1} entre ${candidatos.length} agendas equivalentes (índice ${elegida.indice.score}%)`
  });

  cerrarModal();
  renderVista();
  const deficits = elegida.alertas.filter(a => a.tipo === 'deficit_horas').length;
  if (deficits === 0) {
    mostrarToast(`Opción ${idx + 1} aplicada · ${elegida.sesiones.length} sesiones ✓`, 'success');
  } else {
    mostrarToast(`Opción ${idx + 1} aplicada · ${deficits} paciente(s) con déficit`, 'warning');
  }
}

// ─── Toggle fijo ──────────────────────────────────────────────────────────────

function toggleFijoSesion(sesionId, fecha) {
  const sesiones = Asignaciones.delDia(fecha);
  const sesion = sesiones.find(s => s.id === sesionId);
  if (!sesion) return;
  const nuevoFijo = !sesion.fijo;
  Asignaciones.toggleFijo(fecha, sesionId, nuevoFijo);
  mostrarToast(nuevoFijo ? 'Sesión fijada — no será movida al regenerar' : 'Sesión desbloqueada', 'info');
  renderVista();
}

// ─── Modal creación manual ────────────────────────────────────────────────────

function abrirModalCrearSesion(pacienteId, slotId, fecha) {
  const pac  = Pacientes.porId(pacienteId);
  const slot = SLOTS.find(s => s.id === slotId);
  if (!pac || !slot) return;

  const profesionales = Profesionales.activos();
  const optsDisc = Object.entries(DISCIPLINAS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  abrirModal(`
    <div class="modal-header">
      <h3>Nueva sesión manual</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <p><strong>Paciente:</strong> ${esc(pac.apellido)}, ${esc(pac.nombre)}</p>
      <p><strong>Horario:</strong> ${esc(slot.label)}</p>
      <div class="form-group">
        <label>Disciplina</label>
        <select id="mc-disciplina" onchange="_mcFiltrarProfs()">${optsDisc}</select>
      </div>
      <div class="form-group">
        <label>Profesional</label>
        <select id="mc-profesional">
          <option value="">— seleccionar —</option>
          ${profesionales.map(p => `<option value="${p.id}">${esc(p.apellido)}, ${esc(p.nombre)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="_confirmarCrearSesion('${pacienteId}','${slotId}','${fecha}')">Crear sesión</button>
    </div>`);

  _mcFiltrarProfs();
}

function _mcFiltrarProfs() {
  const disc = document.getElementById('mc-disciplina')?.value;
  const sel  = document.getElementById('mc-profesional');
  if (!sel) return;
  const valorActual = sel.value;
  // Solo profesionales presentes hoy con la disciplina seleccionada
  const estadoDia = DiasState.delDia(fechaActiva);
  const idsPresentes = new Set(_idsProfsPresentes(estadoDia, fechaActiva));
  const profs = Profesionales.activos().filter(p =>
    idsPresentes.has(p.id) &&
    (!disc || (p.disciplinas || []).includes(disc))
  );
  sel.innerHTML = '<option value="">— seleccionar —</option>' +
    profs.map(p => `<option value="${p.id}"${p.id === valorActual ? ' selected' : ''}>${esc(p.apellido)}, ${esc(p.nombre)}</option>`).join('');
}

function _confirmarCrearSesion(pacienteId, slotId, fecha) {
  const disc  = document.getElementById('mc-disciplina')?.value;
  const profId = document.getElementById('mc-profesional')?.value;
  if (!disc || !profId) { mostrarToast('Seleccioná disciplina y profesional.', 'warning'); return; }

  const sesiones = Asignaciones.delDia(fecha);

  const conflictoProf = sesiones.find(s => s.profesionalId === profId && s.slotId === slotId);
  if (conflictoProf) {
    const esKtrDual    = disc === 'kinesiologiaRespiratoria' && conflictoProf.disciplina === 'kinesiologiaRespiratoria';
    const pacNuevo     = Pacientes.porId(pacienteId);
    const pacExistente = Pacientes.porId(conflictoProf.pacienteId);
    const mismoEdif    = pacNuevo?.edificio && pacNuevo.edificio === pacExistente?.edificio;
    const ningBloquea  = !pacNuevo?.bloqueaKTR && !pacExistente?.bloqueaKTR;
    if (!esKtrDual || !mismoEdif || !ningBloquea) {
      const p = Profesionales.porId(profId);
      let desc = `${Profesionales.nombreCompleto(p)} ya tiene una sesión en ese horario.`;
      if (esKtrDual && !mismoEdif)  desc += ' KTR dual requiere mismo edificio.';
      if (esKtrDual && !ningBloquea) desc += ' Un paciente bloquea KTR compartido.';
      abrirModalConflicto(conflictoProf, desc, (sc) => {
        _desplazarACola(sc, fecha);
        Asignaciones.crearSesionManual(fecha, pacienteId, profId, disc, slotId);
        cerrarModal();
        renderVista();
        mostrarToast('Sesión creada — la desplazada está en la cola', 'success');
      });
      return;
    }
  }

  const conflictoPac = sesiones.find(s => s.pacienteId === pacienteId && s.slotId === slotId);
  if (conflictoPac) {
    abrirModalConflicto(conflictoPac, 'El paciente ya tiene una sesión en ese horario.', (sc) => {
      _desplazarACola(sc, fecha);
      Asignaciones.crearSesionManual(fecha, pacienteId, profId, disc, slotId);
      cerrarModal();
      renderVista();
      mostrarToast('Sesión creada — la desplazada está en la cola', 'success');
    });
    return;
  }

  Asignaciones.crearSesionManual(fecha, pacienteId, profId, disc, slotId);
  cerrarModal();
  renderVista();
  mostrarToast('Sesión creada', 'success');
}

// ─── Modo rotación ────────────────────────────────────────────────────────────

function iniciarModoRotacion(sesionId, fecha) {
  modoRotacion = { cola: [{ sesionId, fecha }] };
  cerrarModal();
  _mostrarBannerRotacion();
  _marcarCeldasRotacion();
}

function cancelarModoRotacion() {
  modoRotacion = null;
  document.getElementById('banner-rotacion')?.remove();
  document.querySelectorAll('.rot-origen, .rot-en-cola, .rot-candidata')
    .forEach(c => c.classList.remove('rot-origen', 'rot-en-cola', 'rot-candidata'));
}

function agregarARotacion(sesionId, fecha) {
  if (!modoRotacion) return;
  // Click en la primera sesión = cancelar
  if (sesionId === modoRotacion.cola[0].sesionId) { cancelarModoRotacion(); return; }
  // Ya en la cola = ignorar
  if (modoRotacion.cola.some(c => c.sesionId === sesionId)) return;
  // Sólo mismo día
  if (fecha !== modoRotacion.cola[0].fecha) {
    mostrarToast('La rotación sólo funciona entre sesiones del mismo día.', 'warning');
    return;
  }
  modoRotacion.cola.push({ sesionId, fecha });
  _mostrarBannerRotacion();
  _marcarCeldasRotacion();
}

function _mostrarBannerRotacion() {
  document.getElementById('banner-rotacion')?.remove();
  const banner = document.createElement('div');
  banner.id = 'banner-rotacion';
  banner.className = 'banner-swap banner-rotacion';

  const nodos = modoRotacion.cola.map((c, i) => {
    const sesiones = Asignaciones.delDia(c.fecha);
    const s = sesiones.find(x => x.id === c.sesionId);
    const pac = Pacientes.porId(s?.pacienteId);
    const slot = SLOTS.find(sl => sl.id === s?.slotId);
    return `<span class="rot-nodo">${i > 0 ? '<span class="rot-flecha">→</span>' : ''}${esc(pac?.apellido)} <em>${esc(slot?.label)}</em></span>`;
  }).join('');

  banner.innerHTML = `
    <span class="banner-swap-icono">↻</span>
    <span class="rot-cadena">${nodos} — Clickeá más sesiones para extender la cadena</span>
    <button class="btn btn-sm btn-primary" onclick="confirmarRotacion()" ${modoRotacion.cola.length < 2 ? 'disabled' : ''}>Ejecutar rotación</button>
    <button class="btn btn-sm btn-secondary" onclick="cancelarModoRotacion()">Cancelar</button>`;
  document.querySelector('.main-content')?.prepend(banner);
}

function _marcarCeldasRotacion() {
  document.querySelectorAll('.rot-origen, .rot-en-cola, .rot-candidata')
    .forEach(c => c.classList.remove('rot-origen', 'rot-en-cola', 'rot-candidata'));
  document.querySelectorAll('.celda-sesion').forEach(c => {
    const idx = modoRotacion.cola.findIndex(x => x.sesionId === c.dataset.sesionId);
    if (idx === 0) c.classList.add('rot-origen');
    else if (idx > 0) c.classList.add('rot-en-cola');
    else c.classList.add('rot-candidata');
  });
}

function confirmarRotacion() {
  if (!modoRotacion || modoRotacion.cola.length < 2) return;
  const fecha = modoRotacion.cola[0].fecha;
  const sesiones = [...Asignaciones.delDia(fecha)];
  const items = modoRotacion.cola.map(c => sesiones.find(s => s.id === c.sesionId));
  if (items.some(s => !s)) return;

  // Validar: ningún paciente termina con un slot bloqueado
  const estado = DiasState.delDia(fecha);
  const bloqs  = estado.bloquesPacientes || {};
  const errores = [];
  items.forEach((s, i) => {
    const sDestino = items[(i + 1) % items.length]; // slot al que va esta sesión
    const slotDestino = sDestino.slotId;
    const pac = Pacientes.porId(s.pacienteId);
    const bloqPac = (bloqs[s.pacienteId] || []).map(b => b.slotId)
      .concat((pac?.bloqueosPermanentes || []).map(b => b.slotId));
    if (bloqPac.includes(slotDestino)) {
      errores.push(`${pac?.apellido}, ${pac?.nombre}: horario ${SLOTS.find(sl=>sl.id===slotDestino)?.label} bloqueado.`);
    }
  });
  if (errores.length > 0) {
    mostrarToast('No se puede rotar: ' + errores.join(' / '), 'error');
    return;
  }

  // Rotar slots en cadena: s[0]→slot de s[1], s[1]→slot de s[2], ..., s[N-1]→slot de s[0]
  const slots = items.map(s => ({ slotId: s.slotId, inicio: s.inicio, fin: s.fin }));
  items.forEach((s, i) => {
    const idxReal = sesiones.findIndex(x => x.id === s.id);
    const slotNuevo = slots[(i + 1) % slots.length];
    sesiones[idxReal] = { ...sesiones[idxReal], ...slotNuevo, origen: 'manual', modificadoEn: new Date().toISOString() };
  });

  Asignaciones.guardarDia(fecha, sesiones);
  Auditoria.registrar({
    tipo: 'modificacion_manual',
    fecha,
    descripcion: `Rotación de ${items.length} sesiones: ` +
      items.map(s => Pacientes.porId(s.pacienteId)?.apellido).join(' → ')
  });

  cancelarModoRotacion();
  renderVista();
  mostrarToast(`Rotación de ${items.length} sesiones aplicada`, 'success');
}

// ─── Vista: Pacientes ────────────────────────────────────────────────────────

function _sortPacientes(lista) {
  if (pacientesOrden === 'grupo') {
    const grupoKeys = Object.keys(GRUPOS_DIAGNOSTICOS);
    return [...lista].sort((a, b) => {
      const ga = grupoKeys.indexOf(a.grupo ?? '');
      const gb = grupoKeys.indexOf(b.grupo ?? '');
      const ia = ga === -1 ? 999 : ga;
      const ib = gb === -1 ? 999 : gb;
      return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
    });
  }
  return [...lista].sort((a, b) => a.apellido.localeCompare(b.apellido));
}

function _pacienteCard(p) {
  const grupo = GRUPOS_DIAGNOSTICOS[p.grupo];
  const transf = TRANSFERENCIAS[p.transferencias];
  return `<div class="card">
    <div class="card-head">
      <div>
        <strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong>
        <div class="text-muted" style="font-size:11px">
          ${p.edificio ? esc(p.edificio.charAt(0).toUpperCase() + p.edificio.slice(1)) + ' · ' : ''}Ingreso: ${formatFecha(p.fechaIngreso)}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end">
        ${grupo ? `<span class="badge" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border}">${grupo.label}</span>` : '<span class="badge" style="background:#f1f5f9;color:#94a3b8">Sin grupo</span>'}
        ${p.esAmbulatorio ? '<span class="badge" style="background:#d1fae5;color:#059669;border:1px solid #6ee7b7">Ambulatorio</span>' : ''}
        ${p.bloqueaKTR ? '<span class="badge-ktr">⚠ KTR</span>' : ''}
      </div>
    </div>
    <div class="card-body">
      ${transf ? `<div class="label-row" style="margin-bottom:6px">Transferencias: <strong>${transf.label}</strong></div>` : ''}
      <div class="label-row">Disciplinas:</div>
      <div>${(_discsDelPlan(p.id)).map(d => discChip(d, true)).join(' ') || '<em class="text-muted">Sin plan cargado</em>'}</div>
      ${p.requiereAlmuerzoTerapeutico ? `<div class="mt-4">${discChip('_almuerzo', true)}</div>` : ''}
      ${p.requiereHigiene ? `<div class="mt-4" style="font-size:11px;color:#0891b2">🧼 Higiene: ${discLabel(p.disciplinaHigiene)}</div>` : ''}
    </div>
    <div class="card-footer">
      <button class="btn btn-sm btn-secondary" onclick="editarPaciente('${p.id}')">✏ Editar</button>
      <button class="btn btn-sm btn-secondary" onclick="egresarPaciente('${p.id}')" title="Marcar como egresado">🎓</button>
      <button class="btn btn-sm btn-danger" onclick="eliminarPaciente('${p.id}')">🗑</button>
    </div>
  </div>`;
}

function _pacienteRow(p) {
  const grupo = GRUPOS_DIAGNOSTICOS[p.grupo];
  const transf = TRANSFERENCIAS[p.transferencias];
  return `<tr>
    <td><strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong>${p.bloqueaKTR ? ' <span class="badge-ktr">KTR</span>' : ''}</td>
    <td>${esc(p.edificio ? p.edificio.charAt(0).toUpperCase()+p.edificio.slice(1) : '—')}</td>
    <td>${formatFecha(p.fechaIngreso)}</td>
    <td>${grupo ? `<span class="badge badge-sm" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border}">${grupo.label}</span>` : '<span class="text-muted">—</span>'}${p.esAmbulatorio ? ' <span class="badge badge-sm" style="background:#d1fae5;color:#059669;border:1px solid #6ee7b7">Ambu.</span>' : ''}</td>
    <td><span class="text-muted" style="font-size:12px">${transf ? transf.label : '—'}</span></td>
    <td>${_discsDelPlan(p.id).map(d => discChip(d,true)).join(' ')||'<em class="text-muted">—</em>'}${p.requiereAlmuerzoTerapeutico?' '+discChip('_almuerzo',true):''}</td>
    <td class="lista-acciones">
      <button class="btn btn-sm btn-secondary" onclick="editarPaciente('${p.id}')">✏</button>
      <button class="btn btn-sm btn-secondary" onclick="egresarPaciente('${p.id}')" title="Egresar">🎓</button>
      <button class="btn btn-sm btn-danger" onclick="eliminarPaciente('${p.id}')">🗑</button>
    </td>
  </tr>`;
}

// ─── Vista: Horarios de Baño ─────────────────────────────────────────────────

const _BANO_HORAS = Array.from({length: 12}, (_, i) => {
  const h = i + 7;
  return { h, id: `slot_${String(h).padStart(2,'0')}`, label: `${String(h).padStart(2,'0')}:00` };
});
const _BANO_DIAS = [
  { dia: 1, label: 'Lunes',     weekend: false },
  { dia: 2, label: 'Martes',    weekend: false },
  { dia: 3, label: 'Miércoles', weekend: false },
  { dia: 4, label: 'Jueves',    weekend: false },
  { dia: 5, label: 'Viernes',   weekend: false },
  { dia: 6, label: 'Sábado',    weekend: true  },
  { dia: 0, label: 'Domingo',   weekend: true  },
];
// slotIds que corresponden a un slot real del sistema terapéutico
const _SLOT_IDS_SET = new Set(SLOTS.map(s => s.id));

// ─── Vista: Lista por profesional ────────────────────────────────────────────

function vistaListaProf() {
  const sesionesDelDia = Asignaciones.delDia(fechaActiva);
  const idsConSesion   = new Set(sesionesDelDia.map(s => s.profesionalId));
  const profs = Profesionales.activos()
    .filter(p => idsConSesion.has(p.id))
    .sort((a, b) => a.apellido.localeCompare(b.apellido));

  if (!profs.some(p => p.id === profSeleccionadoLista)) profSeleccionadoLista = profs[0]?.id || null;

  const prof     = Profesionales.porId(profSeleccionadoLista);
  const sesiones = sesionesDelDia.filter(s => s.profesionalId === profSeleccionadoLista);
  const dw       = _weekday(fechaActiva);
  const horarios = (prof?.horariosPorDia || {})[dw] || [];
  const enHorario = s => horarios.length === 0 || horarios.includes(s.id);

  const profSelect = `<select id="lista-prof-sel" class="select-field">
    ${profs.map(p =>
      `<option value="${p.id}" ${p.id === profSeleccionadoLista ? 'selected' : ''}>
         ${esc(p.apellido)}, ${esc(p.nombre)}
       </option>`
    ).join('')}
  </select>`;

  let html = `<div class="vista-header">
    <div class="vista-header-left">
      <h2>Lista por profesional</h2>
      <input type="date" id="lista-prof-fecha" value="${fechaActiva}" class="date-input">
      ${profSelect}
    </div>
    <div class="vista-header-right">
      <button class="btn btn-secondary" onclick="exportarListaProfPDF()">📄 PDF</button>
    </div>
  </div>`;

  if (!prof) return html + `<p class="text-muted">No hay sesiones asignadas para este día.</p>`;

  const discsLabel = (prof.disciplinas || []).map(d => DISCIPLINAS[d]?.label || d).join(', ');

  html += `<div class="card lista-prof-header-card">
    <div style="font-size:16px;font-weight:700">${esc(prof.apellido)}, ${esc(prof.nombre)}</div>
    <div class="text-muted" style="font-size:12px;margin-top:3px">${esc(discsLabel)}</div>
    <div class="text-muted" style="font-size:12px;margin-top:3px">
      ${formatFecha(fechaActiva)} &nbsp;·&nbsp;
      <strong>${sesiones.length}</strong> sesión${sesiones.length !== 1 ? 'es' : ''} asignada${sesiones.length !== 1 ? 's' : ''}
    </div>
  </div>

  <div class="lista-prof-lista">`;

  SLOTS.forEach(slot => {
    const ses = sesiones.find(s => s.slotId === slot.id);

    if (ses) {
      const pac  = Pacientes.porId(ses.pacienteId);
      const disc = DISCIPLINAS[ses.disciplina];
      const grupo = GRUPOS_DIAGNOSTICOS[pac?.grupo];
      const chipStyle = disc
        ? `background:${disc.bg};color:${disc.color};border-color:${disc.border}`
        : 'background:#f0f0f0;color:#333;border-color:#ccc';
      const grupoBadge = grupo
        ? `<span class="badge" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border}">${grupo.label}</span>`
        : '';
      html += `<div class="lista-prof-item">
        <span class="lista-prof-hora">${esc(slot.label)}</span>
        <span class="lista-prof-chip" style="${chipStyle}">${esc(disc?.corto || ses.disciplina)}</span>
        <span class="lista-prof-pac">${ses.esAlmuerzo ? '🍽 ' : ''}${esc(pac?.apellido || '?')}, ${esc(pac?.nombre || '')}</span>
        ${grupoBadge}
      </div>`;
    } else if (slot.esAlmuerzo) {
      html += `<div class="lista-prof-item lista-prof-almuerzo">
        <span class="lista-prof-hora">${esc(slot.label)}</span>
        <span style="color:var(--text-muted);font-size:13px">🍽 Almuerzo</span>
      </div>`;
    } else if (enHorario(slot)) {
      html += `<div class="lista-prof-item lista-prof-libre">
        <span class="lista-prof-hora">${esc(slot.label)}</span>
        <span style="color:#cbd5e1;font-size:13px">libre</span>
      </div>`;
    }
    // fuera de horario sin sesión: no se muestra
  });

  html += `</div>`;
  return html;
}

function bindListaProf() {
  document.getElementById('lista-prof-fecha')?.addEventListener('change', e => {
    fechaActiva = e.target.value;
    renderVista();
  });
  document.getElementById('lista-prof-sel')?.addEventListener('change', e => {
    profSeleccionadoLista = e.target.value;
    renderVista();
  });
}

// ─── Vista: Horarios de Baño ─────────────────────────────────────────────────

// ─── Vista: Pacientes Egresados ───────────────────────────────────────────────

function vistaEgresados() {
  const lista = Pacientes.egresados().sort((a,b) => a.apellido.localeCompare(b.apellido));
  let html = `<div class="vista-header">
    <h2>Pacientes Egresados</h2>
  </div>`;
  if (lista.length === 0) {
    return html + `<div class="empty-state"><div class="empty-icon">🎓</div><p>No hay pacientes egresados.</p></div>`;
  }
  html += `<table class="lista-tabla"><thead><tr>
    <th>Paciente</th><th>Fecha de ingreso</th><th>Grupo</th><th></th>
  </tr></thead><tbody>`;
  lista.forEach(p => {
    const grupo = GRUPOS_DIAGNOSTICOS[p.grupo];
    html += `<tr>
      <td><strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong>${p.esAmbulatorio ? ' <span class="badge badge-sm" style="background:#d1fae5;color:#059669;border:1px solid #6ee7b7">Ambu.</span>' : ''}</td>
      <td>${formatFecha(p.fechaIngreso)}</td>
      <td>${grupo ? `<span class="badge badge-sm" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border}">${grupo.label}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="lista-acciones">
        <button class="btn btn-sm btn-secondary" onclick="reactivarPaciente('${p.id}')">↩ Reactivar</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarPaciente('${p.id}')">🗑</button>
      </td>
    </tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function bindEgresados() {}

function reactivarPaciente(id) {
  Pacientes.actualizar(id, { egresado: false, activo: true });
  renderVista();
  mostrarToast('Paciente reactivado', 'success');
}

// ─── Vista: Practicantes ──────────────────────────────────────────────────────

function vistaPracticantes() {
  const lista = Profesionales.todos()
    .filter(p => p.esPracticante && p.activo !== false)
    .sort((a,b) => a.apellido.localeCompare(b.apellido));
  const dwHoy = _weekday(new Date().toISOString().split('T')[0]);

  let html = `<div class="vista-header">
    <div class="vista-header-left"><h2>Practicantes</h2></div>
    <div class="vista-header-right">
      <button class="btn btn-primary" id="btn-nuevo-practicante">+ Nuevo practicante</button>
    </div>
  </div>`;

  if (lista.length === 0) {
    return html + `<div class="empty-state"><div class="empty-icon">🎓</div><p>No hay practicantes cargados.</p></div>`;
  }

  html += `<div class="card-grid">`;
  lista.forEach(p => {
    const diasChips = _profDiasChips(p, dwHoy);
    html += `<div class="card" style="border-left:4px solid #f59e0b">
      <div class="card-head">
        <div class="prof-avatar" style="background:#fef3c7;color:#d97706">${esc(Profesionales.iniciales(p))}</div>
        <div style="flex:1">
          <strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong>
          <div style="margin-top:2px"><span class="badge" style="background:#fef3c7;color:#d97706;border:1px solid #fcd34d">Practicante</span></div>
          ${diasChips ? `<div class="dia-chips-row mt-1">${diasChips}</div>` : ''}
        </div>
      </div>
      <div class="card-body">
        <div class="label-row">Disciplinas:</div>
        <div>${(p.disciplinas||[]).map(d => discChip(d,true)).join(' ') || '<em>Ninguna</em>'}</div>
      </div>
      <div class="card-footer">
        <button class="btn btn-sm btn-secondary" onclick="editarProf('${p.id}')">✏ Editar</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarProf('${p.id}')">🗑</button>
      </div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

function bindPracticantes() {
  document.getElementById('btn-nuevo-practicante')?.addEventListener('click', () => {
    abrirFormProf(null);
    // Auto-marcar el checkbox de practicante al abrir desde esta vista
    setTimeout(() => {
      const chk = document.getElementById('prof-es-practicante');
      if (chk) chk.checked = true;
    }, 0);
  });
}

// ─── Vista: Horarios de Baño ──────────────────────────────────────────────────

function vistaBanos() {
  const pacientes = Pacientes.activos().sort((a,b) => a.apellido.localeCompare(b.apellido));

  if (pacientes.length === 0) {
    return `<div class="vista-header"><h2>Horarios de Baño</h2></div>
            <p class="text-muted" style="padding:24px">No hay pacientes activos.</p>`;
  }

  // Calcular lunes de la semana actual
  const _hoy = new Date();
  const _diffLun = _hoy.getDay() === 0 ? 6 : _hoy.getDay() - 1;
  const _lunes = new Date(_hoy); _lunes.setDate(_hoy.getDate() - _diffLun);
  const _domingo = new Date(_lunes); _domingo.setDate(_lunes.getDate() + 6);
  const _fmt = d => `${d.getDate()}/${d.getMonth() + 1}`;
  const _fmtFull = d => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  // Mapa dia→fecha de la semana (dia: 1=Lun…6=Sáb, 0=Dom)
  const _diaFecha = {};
  _BANO_DIAS.forEach(d => {
    const offset = d.dia === 0 ? 6 : d.dia - 1;
    const fecha = new Date(_lunes); fecha.setDate(_lunes.getDate() + offset);
    _diaFecha[d.dia] = fecha;
  });
  const semanaLabel = `Semana del lunes ${_fmt(_lunes)} al domingo ${_fmt(_domingo)}`;

  const thHoras = _BANO_HORAS.map(h => {
    const fuera = !_SLOT_IDS_SET.has(h.id) ? ' bano-slot-fuera' : '';
    return `<th class="bano-th-hora${fuera}" title="${_SLOT_IDS_SET.has(h.id) ? '' : 'Fuera del horario terapéutico'}">${h.label}</th>`;
  }).join('');

  let html = `<div class="vista-header">
    <div class="vista-header-left">
      <h2>Horarios de Baño</h2>
      <span class="text-muted" style="font-size:13px">${semanaLabel}</span>
    </div>
    <div class="vista-header-right">
      <span class="text-muted" style="font-size:12px">Bloqueos estructurales recurrentes por paciente</span>
    </div>
  </div>`;

  pacientes.forEach(pac => {
    const banoSet = new Set((pac.bañosSemana || []).map(b => `${b.dia}:${b.slotId}`));

    const filas = _BANO_DIAS.map(d => {
      const celdas = _BANO_HORAS.map(h => {
        const fuera = !_SLOT_IDS_SET.has(h.id) ? ' bano-slot-fuera' : '';
        const checked = banoSet.has(`${d.dia}:${h.id}`) ? 'checked' : '';
        return `<td class="bano-td-slot${fuera}"><input type="checkbox" class="bano-chk"
          data-pac="${pac.id}" data-dia="${d.dia}" data-slot="${h.id}" ${checked}></td>`;
      }).join('');
      const wkCls = d.weekend ? ' bano-weekend' : '';
      const fechaDia = _diaFecha[d.dia];
      return `<tr><td class="bano-td-dia${wkCls}">${d.label}<span class="bano-td-fecha"> ${_fmtFull(fechaDia)}</span></td>${celdas}</tr>`;
    }).join('');

    let ultimaActLabel = '';
    if (pac.bañosSemanaFecha) {
      const d = new Date(pac.bañosSemanaFecha);
      ultimaActLabel = `Actualizado: ${DIAS_SEMANA[d.getDay()]} ${d.toLocaleDateString('es-AR')}`;
    }

    html += `<div class="card bano-pac-card colapsado" id="bano-pac-${pac.id}">
      <div class="card-head bano-card-head" onclick="toggleBanoPac('${pac.id}')">
        <span class="bano-toggle">▾</span>
        <strong>${esc(pac.apellido)}, ${esc(pac.nombre)}</strong>
        <span class="text-muted" id="bano-fecha-${pac.id}" style="font-size:11px;font-weight:normal">${ultimaActLabel}</span>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();limpiarBanoPac('${pac.id}')">Limpiar</button>
          <button class="btn btn-sm btn-primary"   onclick="event.stopPropagation();guardarBanosPac('${pac.id}')">Guardar</button>
        </div>
      </div>
      <div class="bano-body">
        <div class="bano-scroll">
          <table class="bano-tabla">
            <thead><tr><th class="bano-th-dia">Día</th>${thHoras}</tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  });

  return html;
}

function guardarBanosPac(pacId) {
  const pac = Pacientes.porId(pacId);
  if (!pac) return;
  const banos = [];
  document.querySelectorAll(`.bano-chk[data-pac="${pacId}"]`).forEach(chk => {
    if (chk.checked) banos.push({ dia: Number(chk.dataset.dia), slotId: chk.dataset.slot });
  });
  const ahora = new Date();
  Pacientes.actualizar(pacId, { bañosSemana: banos, bañosSemanaFecha: ahora.toISOString() });
  const label = `Actualizado: ${DIAS_SEMANA[ahora.getDay()]} ${ahora.toLocaleDateString('es-AR')}`;
  const el = document.getElementById(`bano-fecha-${pacId}`);
  if (el) el.textContent = label;
  mostrarToast(`Baños de ${pac.nombre} guardados`, 'success');
}

function guardarBanos() {
  const banosPorPac = {};
  document.querySelectorAll('.bano-chk').forEach(chk => {
    const id = chk.dataset.pac;
    if (!banosPorPac[id]) banosPorPac[id] = [];
    if (chk.checked) banosPorPac[id].push({ dia: Number(chk.dataset.dia), slotId: chk.dataset.slot });
  });
  const ahora = new Date().toISOString();
  Pacientes.activos().forEach(pac => {
    Pacientes.actualizar(pac.id, { bañosSemana: banosPorPac[pac.id] || [], bañosSemanaFecha: ahora });
  });
  mostrarToast('Horarios de baño guardados', 'success');
}

function limpiarBanoPac(pacId) {
  document.querySelectorAll(`.bano-chk[data-pac="${pacId}"]`).forEach(chk => { chk.checked = false; });
}

function toggleBanoPac(pacId) {
  document.getElementById(`bano-pac-${pacId}`).classList.toggle('colapsado');
}

// ─── Vista: Pacientes ─────────────────────────────────────────────────────────

function vistaPacientes() {
  const pacientes = _sortPacientes(Pacientes.activos());

  const ordenBtns = `
    <div class="orden-toggle">
      <span class="orden-label">Ordenar:</span>
      <button class="orden-btn${pacientesOrden==='apellido'?' active':''}" onclick="setOrden('pacientes','apellido')">Apellido</button>
      <button class="orden-btn${pacientesOrden==='grupo'?' active':''}" onclick="setOrden('pacientes','grupo')">Grupo diagnóstico</button>
    </div>`;

  let html = `<div class="vista-header">
    <div class="vista-header-left"><h2>Pacientes</h2></div>
    <div class="vista-header-right">
      ${ordenBtns}
      <div class="layout-toggle">
        <button class="layout-btn${pacientesLayout==='cards'?' active':''}" onclick="setLayout('pacientes','cards')" title="Vista cards">▦</button>
        <button class="layout-btn${pacientesLayout==='lista'?' active':''}" onclick="setLayout('pacientes','lista')" title="Vista lista">☰</button>
      </div>
      <button class="btn btn-primary" id="btn-nuevo-pac">+ Nuevo paciente</button>
    </div>
  </div>`;

  if (pacientes.length === 0) {
    html += `<div class="empty-state"><div class="empty-icon">👥</div><p>No hay pacientes cargados.</p></div>`;
    return html;
  }

  if (pacientesOrden === 'grupo') {
    // Renderizar con separadores de grupo
    const grupoKeys = Object.keys(GRUPOS_DIAGNOSTICOS);
    const grupos = [...new Set(pacientes.map(p => p.grupo ?? ''))].sort((a, b) => {
      const ia = grupoKeys.indexOf(a); const ib = grupoKeys.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    if (pacientesLayout === 'cards') {
      grupos.forEach(gk => {
        const g = GRUPOS_DIAGNOSTICOS[gk];
        const misPac = pacientes.filter(p => (p.grupo ?? '') === gk);
        html += `<div class="lista-grupo-header" style="border-left-color:${g?.color||'#94a3b8'}">
          <span style="color:${g?.color||'#94a3b8'}">${g?.label || 'Sin grupo'}</span>
          <span class="lista-grupo-count">${misPac.length} paciente${misPac.length!==1?'s':''}</span>
        </div>
        <div class="card-grid card-grid-tight">
          ${misPac.map(_pacienteCard).join('')}
        </div>`;
      });
    } else {
      html += `<table class="lista-tabla"><thead><tr>
        <th>Paciente</th><th>Edificio</th><th>Ingreso</th><th>Grupo</th><th>Transferencias</th><th>Disciplinas</th><th></th>
      </tr></thead><tbody>`;
      grupos.forEach(gk => {
        const g = GRUPOS_DIAGNOSTICOS[gk];
        const misPac = pacientes.filter(p => (p.grupo ?? '') === gk);
        html += `<tr class="lista-grupo-row">
          <td colspan="7" style="border-left:3px solid ${g?.color||'#94a3b8'}">
            <span style="color:${g?.color||'#94a3b8'};font-weight:600">${g?.label||'Sin grupo'}</span>
            <span class="lista-grupo-count">${misPac.length} paciente${misPac.length!==1?'s':''}</span>
          </td></tr>`;
        html += misPac.map(_pacienteRow).join('');
      });
      html += `</tbody></table>`;
    }
  } else {
    // Orden por apellido — sin separadores
    if (pacientesLayout === 'cards') {
      html += `<div class="card-grid">${pacientes.map(_pacienteCard).join('')}</div>`;
    } else {
      html += `<table class="lista-tabla"><thead><tr>
        <th>Paciente</th><th>Edificio</th><th>Ingreso</th><th>Grupo</th><th>Transferencias</th><th>Disciplinas</th><th></th>
      </tr></thead><tbody>`;
      html += pacientes.map(_pacienteRow).join('');
      html += `</tbody></table>`;
    }
  }

  return html;
}

function setLayout(entidad, modo) {
  if (entidad === 'pacientes') pacientesLayout = modo;
  else profesionalesLayout = modo;
  renderVista();
}

function setOrden(entidad, orden) {
  if (entidad === 'pacientes') pacientesOrden = orden;
  else profesionalesOrden = orden;
  renderVista();
}

function bindPacientes() {
  document.getElementById('btn-nuevo-pac')?.addEventListener('click', () => abrirFormPaciente(null));
}

function editarPaciente(id) { abrirFormPaciente(Pacientes.porId(id)); }

function egresarPaciente(id) {
  const p = Pacientes.porId(id);
  if (confirm(`¿Marcar a ${p?.nombre} ${p?.apellido} como egresado? Quedará fuera de la agenda diaria pero se puede reactivar desde "Pacientes Egresados".`)) {
    Pacientes.actualizar(id, { egresado: true });
    renderVista();
    mostrarToast('Paciente marcado como egresado', 'info');
  }
}

function eliminarPaciente(id) {
  const p = Pacientes.porId(id);
  if (confirm(`¿Eliminar a ${p?.nombre} ${p?.apellido}? Esta acción no se puede deshacer.`)) {
    Pacientes.eliminar(id);
    renderVista();
    mostrarToast('Paciente eliminado', 'info');
  }
}

function abrirFormPaciente(pac) {
  const esNuevo = !pac;
  const todos = Object.keys(DISCIPLINAS);
  const profs = Profesionales.activos();
  _bloqPermForm = (pac?.bloqueosPermanentes || []).map(b => ({ ...b }));

  const discsDelPlan = pac ? _discsDelPlan(pac.id) : [];
  const discsPlanHtml = discsDelPlan.length > 0
    ? discsDelPlan.map(d => discChip(d, true)).join(' ')
    : '<em class="text-muted">Sin plan cargado — configurá el plan terapéutico para ver las disciplinas</em>';

  const discAlmuerzoCheckboxes = todos.map(disc => {
    const checked = (pac?.disciplinasAlmuerzo || DISCIPLINAS_ALMUERZO_DEFAULT).includes(disc) ? 'checked' : '';
    return `<label class="check-label">
      <input type="checkbox" name="disc_almuerzo" value="${disc}" ${checked}>
      ${discChip(disc, true)}
    </label>`;
  }).join('');

  const refSelects = todos.map(disc => {
    const refId = pac?.referentes?.[disc] || '';
    return `<div class="ref-row">
      <label>${esc(DISCIPLINAS[disc]?.label)}</label>
      <select name="ref_${disc}" class="select-field">
        <option value="">— Sin referente —</option>
        ${profs.filter(p => (p.disciplinas||[]).includes(disc)).map(p =>
          `<option value="${p.id}" ${refId === p.id ? 'selected' : ''}>${esc(Profesionales.nombreCompleto(p))}</option>`
        ).join('')}
      </select>
    </div>`;
  }).join('');

  // Bloqueos permanentes actuales
  const bloqPerm = pac?.bloqueosPermanentes || [];
  const bloqPermHtml = bloqPerm.map((b, i) => {
    const slot = SLOTS.find(s => s.id === b.slotId);
    return `<div class="bloq-perm-item" data-idx="${i}">
      <span class="bloq-perm-slot">${esc(slot?.label || b.slotId)}</span>
      <span class="bloq-perm-motivo">${esc(b.motivo || '—')}</span>
      <button type="button" class="btn btn-sm btn-danger" onclick="quitarBloqPerm(${i})">✕</button>
    </div>`;
  }).join('');

  const slotOptsHtml = SLOTS.map(s =>
    '<option value="' + s.id + '">' + esc(s.label) + '</option>'
  ).join('');
  const slotsNoAlmuerzo = SLOTS.filter(s => !s.esAlmuerzo);
  const slotIngOpts = slotsNoAlmuerzo.map(s =>
    '<option value="' + s.id + '"' + (pac?.slotIngreso === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>'
  ).join('');
  const slotEgrOpts = slotsNoAlmuerzo.map(s =>
    '<option value="' + s.id + '"' + (pac?.slotEgreso === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>'
  ).join('');

  const html = `
  <div class="modal-header">
    <h3>${esNuevo ? 'Nuevo paciente' : 'Editar paciente'}</h3>
    <button class="modal-close" onclick="cerrarModal()">✕</button>
  </div>
  <div class="modal-body modal-form">
    <div class="form-row-2">
      <div class="form-group">
        <label>Nombre *</label>
        <input id="pac-nombre" class="input-field" value="${esc(pac?.nombre||'')}" placeholder="Nombre">
      </div>
      <div class="form-group">
        <label>Apellido *</label>
        <input id="pac-apellido" class="input-field" value="${esc(pac?.apellido||'')}" placeholder="Apellido">
      </div>
    </div>
    <div class="form-row-2">
      <div class="form-group">
        <label>Edificio</label>
        <select id="pac-edificio" class="select-field">
          <option value="">— Sin asignar —</option>
          <option value="arriba" ${(pac?.edificio||pac?.habitacion?.toString()||'') === 'arriba' ? 'selected' : ''}>Arriba</option>
          <option value="abajo"  ${(pac?.edificio||'') === 'abajo'  ? 'selected' : ''}>Abajo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Fecha de ingreso</label>
        <input id="pac-ingreso" type="date" class="input-field" value="${pac?.fechaIngreso||hoy()}">
      </div>
    </div>

    <div class="form-row-2">
      <div class="form-group">
        <label>Grupo diagnóstico</label>
        <select id="pac-grupo" class="select-field">
          <option value="">— Sin asignar —</option>
          ${Object.entries(GRUPOS_DIAGNOSTICOS).map(([key, g]) =>
            `<option value="${key}" ${pac?.grupo === key ? 'selected' : ''}>${esc(g.label)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Transferencias</label>
        <select id="pac-transferencias" class="select-field">
          <option value="">— Sin asignar —</option>
          ${Object.entries(TRANSFERENCIAS).map(([key, t]) =>
            `<option value="${key}" ${pac?.transferencias === key ? 'selected' : ''}>${esc(t.label)}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    <fieldset class="fieldset">
      <legend>Flags de scheduling</legend>
      <label class="check-label" style="margin-bottom:8px">
        <input type="checkbox" id="pac-bloquea-ktr" ${pac?.bloqueaKTR ? 'checked' : ''}>
        Bloquea KTR simultáneo — no puede ser atendido al mismo tiempo que otro paciente por el mismo kinesiólogo respiratorio
      </label>
      <label class="check-label">
        <input type="checkbox" id="pac-es-ambulatorio" ${pac?.esAmbulatorio ? 'checked' : ''}>
        <strong>Paciente ambulatorio</strong> — viene solo ciertas horas; sus sesiones tienen prioridad garantizada
      </label>
    </fieldset>

    <fieldset class="fieldset" id="fieldset-ambulatorio" style="display:${pac?.esAmbulatorio ? '' : 'none'}">
      <legend>Horario ambulatorio</legend>
      <div class="text-muted" style="margin-bottom:8px;font-size:12px">Días de asistencia y ventana horaria — se bloquean los slots fuera del rango</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        ${[1,2,3,4,5,6].map(d =>
          '<label class="check-label-sm">' +
            '<input type="checkbox" name="amb_dia" value="' + d + '"' + ((pac?.diasAsistencia||[]).includes(d) ? ' checked' : '') + '> ' +
            DIAS_SEMANA[d] +
          '</label>'
        ).join('')}
      </div>
      <div class="form-row-2">
        <div class="form-group">
          <label>Ingresa</label>
          <select id="pac-slot-ingreso" class="select-field">
            <option value="">— Sin definir —</option>
            ${slotIngOpts}
          </select>
        </div>
        <div class="form-group">
          <label>Egresa</label>
          <select id="pac-slot-egreso" class="select-field">
            <option value="">— Sin definir —</option>
            ${slotEgrOpts}
          </select>
        </div>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend>Disciplinas requeridas</legend>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">${discsPlanHtml}</div>
      <p class="text-muted" style="font-size:11px;margin-top:6px">
        Las disciplinas se derivan automáticamente del plan terapéutico. Para modificarlas, editá el plan desde la vista Planes.
      </p>
    </fieldset>

    <fieldset class="fieldset">
      <legend>Rutina de higiene matutina</legend>
      <label class="check-label" style="margin-bottom:8px">
        <input type="checkbox" id="pac-higiene" ${pac?.requiereHigiene ? 'checked' : ''}>
        Requiere rutina de higiene con terapista (reserva el slot 09:00)
      </label>
      <div id="higiene-disc" style="display:${pac?.requiereHigiene ? '' : 'none'}">
        <label style="font-size:13px">Disciplina responsable:</label>
        <select id="pac-disc-higiene" class="select-field" style="margin-top:4px">
          <option value="">— Elegir —</option>
          ${Object.keys(DISCIPLINAS).map(disc =>
            `<option value="${disc}" ${pac?.disciplinaHigiene === disc ? 'selected' : ''}>${esc(DISCIPLINAS[disc]?.label)}</option>`
          ).join('')}
        </select>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend>Almuerzo</legend>
      <label class="check-label" style="margin-bottom:8px">
        <input type="checkbox" id="pac-almuerza" ${(pac?.almuerza ?? (pac?.requiereAlmuerzoTerapeutico || false)) ? 'checked' : ''}>
        El paciente almuerza en la institución
      </label>
      <div id="almuerzo-detalle" style="display:${(pac?.almuerza ?? (pac?.requiereAlmuerzoTerapeutico || false)) ? '' : 'none'};padding-left:16px">
        <label class="check-label" style="margin-bottom:8px">
          <input type="checkbox" id="pac-almuerzo" ${pac?.requiereAlmuerzoTerapeutico ? 'checked' : ''}>
          Requiere acompañamiento terapéutico
        </label>
        <div id="almuerzo-discs" style="display:${pac?.requiereAlmuerzoTerapeutico ? '' : 'none'}">
          <div class="text-muted" style="margin-bottom:4px">Disciplinas que pueden cubrir el almuerzo:</div>
          <div class="check-grid">${discAlmuerzoCheckboxes}</div>
        </div>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend>Referentes por disciplina</legend>
      ${refSelects}
    </fieldset>

    <fieldset class="fieldset">
      <legend>Horarios bloqueados</legend>
      <div id="bloq-perm-lista" class="bloq-perm-lista">${bloqPermHtml || '<span class="text-muted" style="font-size:12px">Sin bloqueos permanentes.</span>'}</div>
      <div class="bloq-perm-agregar" style="margin-top:10px">
        <select id="bloq-slot" class="select-field" style="flex:1">${slotOptsHtml}</select>
        <input id="bloq-motivo" class="input-field" placeholder="Motivo (opcional)" style="flex:2">
        <button type="button" class="btn btn-sm btn-secondary" onclick="agregarBloqPerm()">+ Agregar</button>
      </div>
    </fieldset>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="guardarPaciente('${pac?.id||''}')">
        ${esNuevo ? 'Crear paciente' : 'Guardar cambios'}
      </button>
    </div>
  </div>`;

  abrirModal(html);

  document.getElementById('pac-almuerza').addEventListener('change', e => {
    document.getElementById('almuerzo-detalle').style.display = e.target.checked ? '' : 'none';
    if (!e.target.checked) {
      document.getElementById('pac-almuerzo').checked = false;
      document.getElementById('almuerzo-discs').style.display = 'none';
    }
  });
  document.getElementById('pac-almuerzo').addEventListener('change', e => {
    document.getElementById('almuerzo-discs').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('pac-higiene').addEventListener('change', e => {
    document.getElementById('higiene-disc').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('pac-es-ambulatorio').addEventListener('change', e => {
    document.getElementById('fieldset-ambulatorio').style.display = e.target.checked ? '' : 'none';
  });
}

// Estado temporal de bloqueos permanentes en el formulario
let _bloqPermForm = [];

function _initBloqPermForm(pac) {
  _bloqPermForm = (pac?.bloqueosPermanentes || []).map(b => ({ ...b }));
}

function _renderBloqPermLista() {
  const el = document.getElementById('bloq-perm-lista');
  if (!el) return;
  if (_bloqPermForm.length === 0) {
    el.innerHTML = '<span class="text-muted" style="font-size:12px">Sin bloqueos permanentes.</span>';
    return;
  }
  el.innerHTML = _bloqPermForm.map((b, i) => {
    const slot = SLOTS.find(s => s.id === b.slotId);
    return `<div class="bloq-perm-item">
      <span class="bloq-perm-slot">${esc(slot?.label || b.slotId)}</span>
      <span class="bloq-perm-motivo">${esc(b.motivo || '—')}</span>
      <button type="button" class="btn btn-sm btn-danger" onclick="quitarBloqPerm(${i})">✕</button>
    </div>`;
  }).join('');
}

function agregarBloqPerm() {
  const slotId = document.getElementById('bloq-slot')?.value;
  const motivo = document.getElementById('bloq-motivo')?.value.trim();
  if (!slotId) return;
  if (_bloqPermForm.some(b => b.slotId === slotId)) {
    mostrarToast('Ese horario ya está bloqueado', 'warning'); return;
  }
  _bloqPermForm.push({ slotId, motivo });
  document.getElementById('bloq-motivo').value = '';
  _renderBloqPermLista();
}

function quitarBloqPerm(idx) {
  _bloqPermForm.splice(idx, 1);
  _renderBloqPermLista();
}

function guardarPaciente(id) {
  const nombre = document.getElementById('pac-nombre').value.trim();
  const apellido = document.getElementById('pac-apellido').value.trim();
  if (!nombre || !apellido) { alert('Nombre y apellido son obligatorios.'); return; }

  const almuerza = document.getElementById('pac-almuerza').checked;
  const disciplinasAlmuerzo = [...document.querySelectorAll('input[name="disc_almuerzo"]:checked')].map(e => e.value);
  const requiereAlmuerzoTerapeutico = document.getElementById('pac-almuerzo').checked;

  const referentes = {};
  Object.keys(DISCIPLINAS).forEach(disc => {
    const sel = document.querySelector(`select[name="ref_${disc}"]`);
    if (sel?.value) referentes[disc] = sel.value;
  });

  const grupo = document.getElementById('pac-grupo').value || null;
  const esAmbulatorio = document.getElementById('pac-es-ambulatorio').checked;
  const diasAsistencia = esAmbulatorio
    ? [...document.querySelectorAll('input[name="amb_dia"]:checked')].map(e => Number(e.value))
    : [];
  const slotIngreso = esAmbulatorio ? (document.getElementById('pac-slot-ingreso')?.value || null) : null;
  const slotEgreso  = esAmbulatorio ? (document.getElementById('pac-slot-egreso')?.value  || null) : null;

  const datos = {
    nombre,
    apellido,
    edificio: document.getElementById('pac-edificio').value || null,
    fechaIngreso: document.getElementById('pac-ingreso').value,
    grupo,
    esAmbulatorio,
    diasAsistencia,
    slotIngreso,
    slotEgreso,
    transferencias: document.getElementById('pac-transferencias').value || null,
    almuerza,
    disciplinasAlmuerzo,
    requiereAlmuerzoTerapeutico,
    referentes,
    bloqueaKTR: document.getElementById('pac-bloquea-ktr').checked,
    bloqueosPermanentes: [..._bloqPermForm],
    requiereHigiene: document.getElementById('pac-higiene').checked,
    disciplinaHigiene: document.getElementById('pac-disc-higiene')?.value || null
  };

  if (id) Pacientes.actualizar(id, datos);
  else Pacientes.crear(datos);

  cerrarModal();
  renderVista();
  mostrarToast(id ? 'Paciente actualizado' : 'Paciente creado', 'success');
}

// ─── Vista: Profesionales ─────────────────────────────────────────────────────

function _profDiasChips(p, dwHoy) {
  const dias = p.diasLaborales || [];
  if (!dias.length) return '';
  return [1,2,3,4,5,6].filter(d => dias.includes(d)).map(d =>
    `<span class="dia-chip dia-chip-on${d===dwHoy?' dia-chip-hoy':''}">${DIAS_SEMANA[d]}</span>`
  ).join('');
}

function _profGruposBadges(p) {
  const prefs = Array.isArray(p.gruposPreferencia) ? p.gruposPreferencia
    : (p.grupoPreferencia ? [p.grupoPreferencia] : []);
  if (!prefs.length) return '';
  return prefs.map((key, i) => {
    const g = GRUPOS_DIAGNOSTICOS[key];
    if (!g) return '';
    return `<span class="badge badge-pref" style="background:${g.bg};color:${g.color};border:1px solid ${g.border}">
      <span class="pref-rank">P${i+1}</span>${g.label}
    </span>`;
  }).join('');
}

function _sortProfs(lista) {
  const discKeys = Object.keys(DISCIPLINAS);
  if (profesionalesOrden === 'disciplina') {
    return [...lista].sort((a, b) => {
      const da = (a.disciplinas||[]).map(d => discKeys.indexOf(d)).filter(i => i>=0);
      const db = (b.disciplinas||[]).map(d => discKeys.indexOf(d)).filter(i => i>=0);
      const ia = da.length ? Math.min(...da) : 999;
      const ib = db.length ? Math.min(...db) : 999;
      return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
    });
  }
  return [...lista].sort((a, b) => a.apellido.localeCompare(b.apellido));
}

function _profCard(p, dwHoy) {
  const diasChips = _profDiasChips(p, dwHoy);
  return `<div class="card">
    <div class="card-head">
      <div class="prof-avatar">${esc(Profesionales.iniciales(p))}</div>
      <div style="flex:1">
        <strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px">
          ${p.esCoordinador ? '<span class="badge-coordinador">Coordinador</span>' : ''}
          ${p.esPracticante ? '<span class="badge" style="background:#fef3c7;color:#d97706;border:1px solid #fcd34d">Practicante</span>' : ''}
          ${p.grupoExclusivo ? `<span class="badge badge-sm" style="background:${GRUPOS_DIAGNOSTICOS[p.grupoExclusivo]?.bg||'#f1f5f9'};color:${GRUPOS_DIAGNOSTICOS[p.grupoExclusivo]?.color||'#64748b'};border:1px solid ${GRUPOS_DIAGNOSTICOS[p.grupoExclusivo]?.border||'#cbd5e1'}">Solo ${GRUPOS_DIAGNOSTICOS[p.grupoExclusivo]?.label||p.grupoExclusivo}</span>` : ''}
        </div>
        ${diasChips ? `<div class="dia-chips-row mt-1">${diasChips}</div>` : ''}
      </div>
    </div>
    <div class="card-body">
      <div class="label-row">Disciplinas:</div>
      <div>${(p.disciplinas||[]).map(d => discChip(d,true)).join(' ') || '<em>Ninguna</em>'}</div>
      ${(() => { const b = _profGruposBadges(p); return b ? `<div class="mt-4 label-row">Grupos preferidos: ${b}</div>` : ''; })()}
    </div>
    <div class="card-footer">
      <button class="btn btn-sm btn-secondary" onclick="editarProf('${p.id}')">✏ Editar</button>
      <button class="btn btn-sm btn-danger" onclick="eliminarProf('${p.id}')">🗑</button>
    </div>
  </div>`;
}

function _profRow(p, dwHoy) {
  return `<tr>
    <td><strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong>${p.esCoordinador ? ' <span class="badge-coordinador">Coord.</span>' : ''}${p.esPracticante ? ' <span class="badge badge-sm" style="background:#fef3c7;color:#d97706;border:1px solid #fcd34d">Pract.</span>' : ''}</td>
    <td><span class="dia-chips-row">${_profDiasChips(p, dwHoy)||'<span class="text-muted">—</span>'}</span></td>
    <td>${(p.disciplinas||[]).map(d => discChip(d,true)).join(' ')||'<em>—</em>'}</td>
    <td>${_profGruposBadges(p)||'<span class="text-muted">—</span>'}</td>
    <td class="lista-acciones">
      <button class="btn btn-sm btn-secondary" onclick="editarProf('${p.id}')">✏</button>
      <button class="btn btn-sm btn-danger" onclick="eliminarProf('${p.id}')">🗑</button>
    </td>
  </tr>`;
}

function vistaProfesionales() {
  const profs  = _sortProfs(Profesionales.activos());
  const dwHoy  = _weekday(new Date().toISOString().split('T')[0]);
  const discKeys = Object.keys(DISCIPLINAS);

  const ordenBtns = `
    <div class="orden-toggle">
      <span class="orden-label">Ordenar:</span>
      <button class="orden-btn${profesionalesOrden==='apellido'?' active':''}" onclick="setOrden('profesionales','apellido')">Apellido</button>
      <button class="orden-btn${profesionalesOrden==='disciplina'?' active':''}" onclick="setOrden('profesionales','disciplina')">Disciplina</button>
    </div>`;

  let html = `<div class="vista-header">
    <div class="vista-header-left"><h2>Profesionales</h2></div>
    <div class="vista-header-right">
      ${ordenBtns}
      <div class="layout-toggle">
        <button class="layout-btn${profesionalesLayout==='cards'?' active':''}" onclick="setLayout('profesionales','cards')" title="Vista cards">▦</button>
        <button class="layout-btn${profesionalesLayout==='lista'?' active':''}" onclick="setLayout('profesionales','lista')" title="Vista lista">☰</button>
      </div>
      <button class="btn btn-primary" id="btn-nuevo-prof">+ Nuevo profesional</button>
    </div>
  </div>`;

  if (profs.length === 0) {
    html += `<div class="empty-state"><div class="empty-icon">👨‍⚕️</div><p>No hay profesionales cargados.</p></div>`;
    return html;
  }

  if (profesionalesOrden === 'disciplina') {
    // Agrupar por disciplina principal (la de menor índice en discKeys)
    const discPrincipal = p => {
      const idxs = (p.disciplinas||[]).map(d => discKeys.indexOf(d)).filter(i => i>=0);
      return idxs.length ? discKeys[Math.min(...idxs)] : null;
    };
    const gruposDisc = [...new Set(profs.map(discPrincipal))];

    if (profesionalesLayout === 'cards') {
      gruposDisc.forEach(dk => {
        const d  = dk ? DISCIPLINAS[dk] : null;
        const label = d?.label || 'Sin disciplina asignada';
        const color = d?.color || '#94a3b8';
        const misProfs = profs.filter(p => discPrincipal(p) === dk);
        html += `<div class="lista-grupo-header" style="border-left-color:${color}">
          <span style="color:${color}">${label}</span>
          <span class="lista-grupo-count">${misProfs.length} profesional${misProfs.length!==1?'es':''}</span>
        </div>
        <div class="card-grid card-grid-tight">
          ${misProfs.map(p => _profCard(p, dwHoy)).join('')}
        </div>`;
      });
    } else {
      html += `<table class="lista-tabla"><thead><tr>
        <th>Profesional</th><th>Días</th><th>Disciplinas</th><th>Grupos preferidos</th><th></th>
      </tr></thead><tbody>`;
      gruposDisc.forEach(dk => {
        const d  = dk ? DISCIPLINAS[dk] : null;
        const label = d?.label || 'Sin disciplina asignada';
        const color = d?.color || '#94a3b8';
        const misProfs = profs.filter(p => discPrincipal(p) === dk);
        html += `<tr class="lista-grupo-row">
          <td colspan="5" style="border-left:3px solid ${color}">
            <span style="color:${color};font-weight:600">${label}</span>
            <span class="lista-grupo-count">${misProfs.length} profesional${misProfs.length!==1?'es':''}</span>
          </td></tr>`;
        html += misProfs.map(p => _profRow(p, dwHoy)).join('');
      });
      html += `</tbody></table>`;
    }
  } else {
    if (profesionalesLayout === 'cards') {
      html += `<div class="card-grid">${profs.map(p => _profCard(p, dwHoy)).join('')}</div>`;
    } else {
      html += `<table class="lista-tabla"><thead><tr>
        <th>Profesional</th><th>Días</th><th>Disciplinas</th><th>Grupos preferidos</th><th></th>
      </tr></thead><tbody>`;
      html += profs.map(p => _profRow(p, dwHoy)).join('');
      html += `</tbody></table>`;
    }
  }

  return html;
}

function bindProfesionales() {
  document.getElementById('btn-nuevo-prof')?.addEventListener('click', () => abrirFormProf(null));
}

function editarProf(id) { abrirFormProf(Profesionales.porId(id)); }

function eliminarProf(id) {
  const p = Profesionales.porId(id);
  if (confirm(`¿Eliminar a ${p?.nombre} ${p?.apellido}?`)) {
    Profesionales.eliminar(id);
    renderVista();
  }
}

// Estado temporal del formulario de grupos de preferencia
let _profGruposForm = [];

function abrirFormProf(prof) {
  const esNuevo = !prof;
  // Migración: si el profesional tiene el campo viejo, convertirlo
  _profGruposForm = Array.isArray(prof?.gruposPreferencia)
    ? [...prof.gruposPreferencia]
    : (prof?.grupoPreferencia ? [prof.grupoPreferencia] : []);

  const discCheckboxes = Object.keys(DISCIPLINAS).map(disc => {
    const checked = (prof?.disciplinas||[]).includes(disc) ? 'checked' : '';
    return `<label class="check-label">
      <input type="checkbox" name="prof_disc" value="${disc}" ${checked}>
      ${discChip(disc, true)}
    </label>`;
  }).join('');

  const html = `
  <div class="modal-header">
    <h3>${esNuevo ? 'Nuevo profesional' : 'Editar profesional'}</h3>
    <button class="modal-close" onclick="cerrarModal()">✕</button>
  </div>
  <div class="modal-body modal-form">
    <div class="form-row-2">
      <div class="form-group">
        <label>Nombre *</label>
        <input id="prof-nombre" class="input-field" value="${esc(prof?.nombre||'')}" placeholder="Nombre">
      </div>
      <div class="form-group">
        <label>Apellido *</label>
        <input id="prof-apellido" class="input-field" value="${esc(prof?.apellido||'')}" placeholder="Apellido">
      </div>
    </div>
    <fieldset class="fieldset">
      <legend>Disciplinas</legend>
      <div class="check-grid">${discCheckboxes}</div>
    </fieldset>
    <div class="form-row-2">
      <div class="form-group">
        <label>Grupos de preferencia <span class="text-muted" style="font-weight:400;font-size:11px">(el orden determina la prioridad)</span></label>
        <div id="grupos-pref-editor" class="grupos-pref-editor">${_renderGruposPrefEditor()}</div>
        <span class="text-muted" style="font-size:11px;margin-top:4px;display:block">
          Los grupos elegidos reciben bonus de puntaje: P1 +20 pts, P2 +14 pts, P3 +8 pts
        </span>
      </div>
      <div class="form-group">
        <label>Grupo exclusivo</label>
        <select id="prof-grupo-exclusivo" class="select-field">
          <option value="">— Ninguno (atiende a todos) —</option>
          ${Object.entries(GRUPOS_DIAGNOSTICOS).map(([key, g]) =>
            `<option value="${key}" ${prof?.grupoExclusivo === key ? 'selected' : ''}>${esc(g.label)}</option>`
          ).join('')}
        </select>
        <span class="text-muted" style="font-size:11px;margin-top:4px;display:block">
          Si seleccionás un grupo, el profesional solo será asignado a pacientes de ese grupo.
        </span>
      </div>
    </div>
    <div class="form-group">
      <label>Días laborales y horario de asistencia</label>
      <div class="asist-grid" id="prof-horarios-grid">
        <div class="asist-header-row">
          <div class="asist-dia-col"></div>
          ${[8,9,10,11,12,14,15,16,17,18].map(h =>
            `<div class="asist-h-label">${String(h).padStart(2,'0')}</div>`
          ).join('')}
        </div>
        ${[['1','Lun'],['2','Mar'],['3','Mié'],['4','Jue'],['5','Vie'],['6','Sáb']].map(([v, lbl]) => {
          const diaNum   = Number(v);
          const activo   = (prof?.diasLaborales||[]).includes(diaNum);
          const guardados = ((prof?.horariosPorDia || {})[diaNum] || []).filter(sid => sid !== 'slot_13');
          return `<div class="asist-row">
            <label class="asist-dia-label">
              <input type="checkbox" class="asist-dia-chk" name="prof_dia" value="${v}" ${activo ? 'checked' : ''}>
              <span class="asist-dia-name">${lbl}</span>
            </label>
            ${[8,9,10,11,12,14,15,16,17,18].map(h => {
              const sid = `slot_${String(h).padStart(2,'0')}`;
              const chk = activo && (guardados.length === 0 || guardados.includes(sid));
              return `<label class="asist-hora-cell${activo ? '' : ' asist-off'}">
                <input type="checkbox" name="phg_slot_${v}" value="${sid}"
                  ${chk ? 'checked' : ''} ${activo ? '' : 'disabled'}>
                <span class="asist-hora-lbl">${String(h).padStart(2,'0')}</span>
              </label>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
      <span class="text-muted" style="font-size:11px;margin-top:4px;display:block">
        Marcá el día para activarlo; luego seleccioná las horas exactas en que el profesional está presente.
        Si marcás el día sin seleccionar horas, se considera disponible en todos los turnos de terapia.
      </span>
    </div>
    <fieldset class="fieldset">
      <legend>Flags de scheduling</legend>
      <label class="check-label" style="margin-bottom:8px">
        <input type="checkbox" id="prof-coordinador" ${prof?.esCoordinador ? 'checked' : ''}>
        Profesional coordinador — el algoritmo reserva al menos 1 slot libre por semana
      </label>
      <label class="check-label">
        <input type="checkbox" id="prof-es-practicante" ${prof?.esPracticante ? 'checked' : ''}>
        <strong>Practicante</strong> — se muestra como disponible en la agenda pero no recibe asignaciones automáticas
      </label>
    </fieldset>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="guardarProf('${prof?.id||''}')">
        ${esNuevo ? 'Crear' : 'Guardar'}
      </button>
    </div>
  </div>`;
  abrirModal(html);

  // Día activado/desactivado → habilitar o deshabilitar sus celdas de hora
  document.querySelectorAll('.asist-dia-chk').forEach(chk => {
    chk.addEventListener('change', e => {
      const v      = e.target.value;
      const activo = e.target.checked;
      const row    = e.target.closest('.asist-row');
      row.querySelectorAll('.asist-hora-cell').forEach(cell => {
        const input = cell.querySelector('input');
        cell.classList.toggle('asist-off', !activo);
        input.disabled = !activo;
        if (activo) input.checked = true;  // marcar todo el día por defecto
      });
    });
  });

  // Hora marcada/desmarcada → sincronizar estado del día automáticamente
  document.getElementById('prof-horarios-grid').addEventListener('change', e => {
    const input = e.target;
    if (!input.name?.startsWith('phg_slot_')) return;
    const v      = input.name.replace('phg_slot_', '');
    const diaChk = document.querySelector(`.asist-dia-chk[value="${v}"]`);
    const row    = input.closest('.asist-row');
    if (!diaChk || !row) return;
    const alguno = [...row.querySelectorAll(`input[name="phg_slot_${v}"]`)].some(i => i.checked);
    if (alguno && !diaChk.checked) {
      diaChk.checked = true;
      row.querySelectorAll('.asist-hora-cell').forEach(c => {
        c.classList.remove('asist-off');
        c.querySelector('input').disabled = false;
      });
    } else if (!alguno && diaChk.checked) {
      diaChk.checked = false;
    }
  });
}

function _renderGruposPrefEditor() {
  const grupos = Object.entries(GRUPOS_DIAGNOSTICOS);
  let html = '';

  // Lista ordenada de grupos seleccionados
  if (_profGruposForm.length > 0) {
    html += `<div class="gpref-lista">`;
    _profGruposForm.forEach((key, i) => {
      const g = GRUPOS_DIAGNOSTICOS[key];
      if (!g) return;
      html += `<div class="gpref-item">
        <span class="gpref-rank">P${i+1}</span>
        <span class="badge" style="background:${g.bg};color:${g.color};border:1px solid ${g.border}">${g.label}</span>
        <div class="gpref-btns">
          ${i > 0 ? `<button class="gpref-btn" onclick="moverGrupoPref(${i}, -1)" title="Subir prioridad">↑</button>` : '<span class="gpref-btn-ph"></span>'}
          ${i < _profGruposForm.length - 1 ? `<button class="gpref-btn" onclick="moverGrupoPref(${i}, 1)" title="Bajar prioridad">↓</button>` : '<span class="gpref-btn-ph"></span>'}
          <button class="gpref-btn gpref-btn-del" onclick="quitarGrupoPref('${key}')" title="Quitar">✕</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // Grupos disponibles para agregar
  const disponibles = grupos.filter(([key]) => !_profGruposForm.includes(key));
  if (disponibles.length > 0) {
    html += `<div class="gpref-agregar">`;
    disponibles.forEach(([key, g]) => {
      html += `<button class="gpref-add-btn" onclick="agregarGrupoPref('${key}')"
        style="background:${g.bg};color:${g.color};border:1px solid ${g.border}">
        + ${g.label}
      </button>`;
    });
    html += `</div>`;
  } else if (_profGruposForm.length > 0) {
    html += `<div class="text-muted" style="font-size:11px;margin-top:6px">Todos los grupos están seleccionados.</div>`;
  }

  return html;
}

function _refreshGruposPrefEditor() {
  const el = document.getElementById('grupos-pref-editor');
  if (el) el.innerHTML = _renderGruposPrefEditor();
}

function agregarGrupoPref(key) {
  if (!_profGruposForm.includes(key)) _profGruposForm.push(key);
  _refreshGruposPrefEditor();
}

function quitarGrupoPref(key) {
  _profGruposForm = _profGruposForm.filter(k => k !== key);
  _refreshGruposPrefEditor();
}

function moverGrupoPref(idx, dir) {
  const arr = _profGruposForm;
  const nuevo = idx + dir;
  if (nuevo < 0 || nuevo >= arr.length) return;
  [arr[idx], arr[nuevo]] = [arr[nuevo], arr[idx]];
  _refreshGruposPrefEditor();
}

function guardarProf(id) {
  const nombre = document.getElementById('prof-nombre').value.trim();
  const apellido = document.getElementById('prof-apellido').value.trim();
  if (!nombre || !apellido) { alert('Nombre y apellido son obligatorios.'); return; }
  const disciplinas = [...document.querySelectorAll('input[name="prof_disc"]:checked')].map(e => e.value);
  const diasLaborales = [...document.querySelectorAll('input[name="prof_dia"]:checked')].map(e => Number(e.value));

  // Horarios por día
  const horariosPorDia = {};
  diasLaborales.forEach(d => {
    const slots = [...document.querySelectorAll(`input[name="phg_slot_${d}"]:checked`)].map(e => e.value);
    if (slots.length) horariosPorDia[d] = slots;
  });

  const esCoordinador = document.getElementById('prof-coordinador')?.checked || false;
  const esPracticante = document.getElementById('prof-es-practicante')?.checked || false;
  const grupoExclusivo = document.getElementById('prof-grupo-exclusivo')?.value || null;
  const datos = { nombre, apellido, disciplinas, gruposPreferencia: [..._profGruposForm], grupoExclusivo, esPracticante, diasLaborales, horariosPorDia, esCoordinador };
  if (id) Profesionales.actualizar(id, datos);
  else Profesionales.crear(datos);
  cerrarModal();
  renderVista();
  mostrarToast(id ? 'Profesional actualizado' : 'Profesional creado', 'success');
}

// ─── Vista: Planes semanales ──────────────────────────────────────────────────

let pacSeleccionadoPlan = null;

function vistaPlanes() {
  const pacientes = Pacientes.activos().sort((a, b) => a.apellido.localeCompare(b.apellido));
  if (pacientes.length === 0) {
    return `<div class="vista-header"><h2>Planes semanales</h2></div>
      <div class="empty-state"><p>Primero cargá pacientes.</p></div>`;
  }

  if (!pacSeleccionadoPlan || !Pacientes.porId(pacSeleccionadoPlan)) {
    pacSeleccionadoPlan = pacientes[0].id;
  }

  // ── columna izquierda: lista de pacientes ──────────────────────────────────
  let listaHtml = '';
  pacientes.forEach(p => {
    const tienePlan = Planes.tienePlan(p.id);
    const meta      = Planes.metaDelPaciente(p.id);
    const activo    = p.id === pacSeleccionadoPlan;
    const grupo     = GRUPOS_DIAGNOSTICOS[p.grupo];

    let metaHtml = '';
    if (tienePlan && meta?.modificadoEn) {
      const fecha = new Date(meta.modificadoEn).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });
      metaHtml = `<div class="plan-lista-meta">
        ${fecha}${meta.modificadoPor ? ` · <em>${esc(meta.modificadoPor)}</em>` : ''}
      </div>`;
    }

    listaHtml += `<div class="plan-lista-item${activo ? ' plan-lista-activo' : ''}" data-pac-id="${p.id}">
      <div class="plan-lista-estado ${tienePlan ? 'plan-estado-ok' : 'plan-estado-vacio'}"
           title="${tienePlan ? 'Con plan' : 'Sin plan'}"></div>
      <div class="plan-lista-info">
        <div class="plan-lista-nombre">${esc(p.apellido)}, ${esc(p.nombre)}</div>
        ${grupo ? `<span class="badge badge-sm" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border};font-size:9px">${grupo.label}</span>` : ''}
        ${metaHtml}
      </div>
      ${tienePlan ? '<div class="plan-lista-check">✓</div>' : '<div class="plan-lista-check plan-lista-check-vacio">—</div>'}
    </div>`;
  });

  // ── columna derecha: editor ────────────────────────────────────────────────
  const pac            = Pacientes.porId(pacSeleccionadoPlan);
  const plan           = Planes.delPaciente(pacSeleccionadoPlan);
  const meta           = Planes.metaDelPaciente(pacSeleccionadoPlan);
  const limitesDiarios = pac?.limitesDiarios || {};
  const totalSesiones  = Object.values(plan).reduce((s, v) => s + (v || 0), 0);
  const grupo          = GRUPOS_DIAGNOSTICOS[pac?.grupo];

  let editorHtml = `
    <div class="plan-editor-header">
      <div>
        <div class="plan-editor-nombre">${esc(pac?.apellido)}, ${esc(pac?.nombre)}</div>
        ${grupo ? `<span class="badge" style="background:${grupo.bg};color:${grupo.color};border:1px solid ${grupo.border}">${grupo.label}</span>` : ''}
      </div>
      ${totalSesiones > 0
        ? `<span class="badge badge-ok" style="font-size:13px;padding:4px 10px">${totalSesiones} ses./semana</span>`
        : `<span class="badge badge-warning" style="font-size:13px;padding:4px 10px">Sin plan</span>`}
    </div>`;

  if (meta?.modificadoEn) {
    const fecha = new Date(meta.modificadoEn).toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const hora  = new Date(meta.modificadoEn).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    editorHtml += `<div class="plan-meta-banner">
      Última modificación: <strong>${fecha}</strong> a las <strong>${hora}</strong>
      ${meta.modificadoPor ? `· por <strong>${esc(meta.modificadoPor)}</strong>` : ''}
    </div>`;
  }

  editorHtml += `
    <div class="text-muted" style="font-size:12px;margin-bottom:14px">
      <strong>Ses./semana:</strong> el algoritmo las distribuye entre los días disponibles.
      <strong>Máx/día:</strong> techo opcional para evitar concentración en un solo día.
    </div>
    <div class="tabla-plan-wrap">
    <table class="tabla-plan">
      <thead><tr>
        <th>Disciplina</th>
        <th style="text-align:center">Ses./semana</th>
        <th style="text-align:center">Promedio/día</th>
        <th style="text-align:center">Máx/día</th>
        <th style="text-align:center">Estado</th>
      </tr></thead>
      <tbody>`;

  Object.keys(DISCIPLINAS).forEach(disc => {
    const val      = plan[disc] || 0;
    const activa   = val > 0;
    const limite   = limitesDiarios[disc] || '';
    editorHtml += `<tr class="${activa ? '' : 'plan-row-inactiva'}">
      <td>${discChip(disc, true)}</td>
      <td style="text-align:center">
        <input type="number" class="input-plan" data-disc="${disc}"
          value="${val}" min="0" max="10" style="${activa ? '' : 'opacity:0.5'}">
      </td>
      <td class="plan-promedio" style="text-align:center;color:var(--text-muted)">
        ${activa ? (val / 5).toFixed(1) + '/día' : '—'}
      </td>
      <td style="text-align:center">
        <input type="number" class="input-limite" data-disc="${disc}"
          value="${limite}" min="1" max="6" placeholder="—"
          ${activa ? '' : 'disabled style="opacity:0.3"'}>
      </td>
      <td style="text-align:center">
        ${activa
          ? `<span class="badge badge-ok">Activa</span>`
          : `<span class="badge" style="background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0">Inactiva</span>`}
      </td>
    </tr>`;
  });

  editorHtml += `</tbody></table></div>
    <div class="plan-editor-footer">
      <div class="plan-guardado-por">
        <label style="font-size:12px;color:var(--text-muted)">Guardado por</label>
        <input type="text" id="plan-modificado-por" class="input-field"
          placeholder="Tu nombre (opcional)"
          value="${esc(meta?.modificadoPor || '')}"
          style="width:200px;font-size:13px;padding:5px 10px">
      </div>
      <button class="btn btn-primary" id="btn-guardar-plan">Guardar plan</button>
    </div>`;

  return `<div class="vista-header"><div class="vista-header-left"><h2>Planes semanales</h2></div></div>
    <div class="planes-layout">
      <div class="planes-lista">
        <div class="planes-lista-header">
          <span>Pacientes</span>
          <span class="planes-resumen">${pacientes.filter(p => Planes.tienePlan(p.id)).length}/${pacientes.length} con plan</span>
        </div>
        ${listaHtml}
      </div>
      <div class="planes-editor">${editorHtml}</div>
    </div>`;
}

function bindPlanes() {
  document.querySelectorAll('.plan-lista-item').forEach(item => {
    item.addEventListener('click', () => {
      pacSeleccionadoPlan = item.dataset.pacId;
      renderVista();
    });
  });

  document.querySelectorAll('.input-plan').forEach(inp => {
    inp.addEventListener('input', () => {
      const val      = parseInt(inp.value) || 0;
      const row      = inp.closest('tr');
      const badge    = row.querySelector('.badge');
      const promCell = row.querySelector('.plan-promedio');
      const limInp   = row.querySelector('.input-limite');
      if (val > 0) {
        row.classList.remove('plan-row-inactiva');
        inp.style.opacity = '1';
        if (promCell) promCell.textContent = (val / 5).toFixed(1) + '/día';
        if (limInp)  { limInp.disabled = false; limInp.style.opacity = '1'; }
        if (badge)   { badge.className = 'badge badge-ok'; badge.textContent = 'Activa'; badge.removeAttribute('style'); }
      } else {
        row.classList.add('plan-row-inactiva');
        inp.style.opacity = '0.5';
        if (promCell) promCell.textContent = '—';
        if (limInp)  { limInp.disabled = true; limInp.style.opacity = '0.3'; limInp.value = ''; }
        if (badge)   { badge.className = 'badge'; badge.style = 'background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0'; badge.textContent = 'Inactiva'; }
      }
    });
  });

  document.getElementById('btn-guardar-plan')?.addEventListener('click', () => {
    const sesiones         = {};
    const limitesDiarios   = {};
    const disciplinasActivas = [];

    document.querySelectorAll('.input-plan').forEach(inp => {
      const val = parseInt(inp.value) || 0;
      sesiones[inp.dataset.disc] = val;
      if (val > 0) disciplinasActivas.push(inp.dataset.disc);
    });
    document.querySelectorAll('.input-limite').forEach(inp => {
      const val = parseInt(inp.value) || 0;
      if (val > 0) limitesDiarios[inp.dataset.disc] = val;
    });

    const modificadoPor = document.getElementById('plan-modificado-por')?.value.trim() || null;
    Planes.guardar(pacSeleccionadoPlan, sesiones, { modificadoPor });
    Pacientes.actualizar(pacSeleccionadoPlan, { limitesDiarios });

    mostrarToast('Plan guardado', 'success');
    renderVista();
  });
}

// ─── Vista: Disponibilidad del día ───────────────────────────────────────────

let pacSeleccionadoDisp  = null;
let profSeleccionadoBloqDisp = null;

function vistaDisponibilidad() {
  const _dw = _weekday(fechaActiva);
  const profs = Profesionales.activos().sort((a,b) => {
    const aHoy = (a.diasLaborales||[]).includes(_dw) ? 0 : 1;
    const bHoy = (b.diasLaborales||[]).includes(_dw) ? 0 : 1;
    return aHoy - bHoy || a.apellido.localeCompare(b.apellido);
  });
  const pacientes = Pacientes.activos();

  // Auto-populate: si este día nunca fue guardado, usar horario habitual
  const estadoGuardado = DiasState.todos()[fechaActiva];
  const idsExcluidos  = (estadoGuardado?.profesionalesExcluidos || []);

  // Construir mapa de presencias (nuevo modelo) con fallback al legacy.
  // Se distingue "explícitamente vacío" (clave existe, {}  → desmarcar todos funcionó)
  // de "nunca configurado" (clave ausente → aplicar horario habitual del día).
  let presencias;
  if (estadoGuardado && 'presenciaProfesionales' in estadoGuardado) {
    presencias = estadoGuardado.presenciaProfesionales || {};
  } else if (estadoGuardado?.profesionalesPresentes?.length) {
    presencias = {};
    estadoGuardado.profesionalesPresentes.forEach(id => { presencias[id] = 'dia'; });
  } else {
    presencias = {};
    _profsDelHorario(profs, fechaActiva).forEach(id => { presencias[id] = 'dia'; });
  }
  const cantPresentes = Object.values(presencias).filter(Boolean).length;

  if (!pacSeleccionadoDisp && pacientes.length > 0) pacSeleccionadoDisp = pacientes[0].id;
  if (!profSeleccionadoBloqDisp && profs.length > 0) profSeleccionadoBloqDisp = profs[0].id;

  const bloqueosPac = (estadoGuardado||DiasState.delDia(fechaActiva)).bloquesPacientes?.[pacSeleccionadoDisp] || [];
  const prescripciones = (estadoGuardado||DiasState.delDia(fechaActiva)).prescripcionesUrgentes?.[pacSeleccionadoDisp] || [];
  const pac = Pacientes.porId(pacSeleccionadoDisp);

  const dw = _weekday(fechaActiva);
  const diaLabel = DIAS_SEMANA[dw];
  const tieneHorarios = profs.some(p => (p.diasLaborales||[]).length > 0);

  let html = `<div class="vista-header">
    <div class="vista-header-left">
      <h2>Disponibilidad</h2>
      <input type="date" id="disp-fecha" value="${fechaActiva}" class="date-input">
    </div>
  </div>

  <div class="disp-grid">
    <!-- Columna izquierda: profesionales presentes -->
    <div class="card">
      <div class="card-head">
        <strong>Profesionales presentes</strong>
        <span class="text-muted" style="font-size:12px">${diaLabel} · ${cantPresentes} de ${profs.length}</span>
        <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btn-marcar-todos">Marcar todos</button>
          <button class="btn btn-secondary btn-sm" id="btn-desmarcar-todos">Desmarcar todos</button>
          ${tieneHorarios ? `<button class="btn btn-secondary btn-sm" id="btn-restaurar-horario">↺ ${diaLabel}</button>` : ''}
        </div>
      </div>
      ${!estadoGuardado && tieneHorarios ? `
      <div class="disp-autofill-banner">
        ✦ Pre-seleccionados según horario habitual del ${diaLabel}
      </div>` : ''}
      ${idsExcluidos.length > 0 ? `
      <div class="disp-excluidos-banner">
        ⚠ ${idsExcluidos.length} profesional${idsExcluidos.length!==1?'es':''} presente${idsExcluidos.length!==1?'s':''} excluido${idsExcluidos.length!==1?'s':''} del armado automático
      </div>` : ''}
      <div class="card-body">
        ${profs.length === 0 ? '<em>No hay profesionales cargados</em>' :
          profs.map(p => {
            const pres     = presencias[p.id] || null;
            const excluido = idsExcluidos.includes(p.id);
            const chkPres = `<input type="checkbox" class="chk-presente" data-id="${p.id}" ${pres ? 'checked' : ''}>`;
            const chkMan  = `<input type="checkbox" class="chk-manana"  data-id="${p.id}" ${pres==='dia'||pres==='manana' ? 'checked' : ''}>`;
            const chkTar  = `<input type="checkbox" class="chk-tarde"   data-id="${p.id}" ${pres==='dia'||pres==='tarde'  ? 'checked' : ''}>`;
            const chkExcl = `<input type="checkbox" class="chk-excluir" data-id="${p.id}" ${excluido ? 'checked' : ''}>`;
            const discsText = (p.disciplinas||[]).map(d => DISCIPLINAS[d]?.corto||d).join(', ');
            return `<div class="disp-prof-row${excluido ? ' disp-prof-excluido' : ''}${!pres ? ' disp-prof-ausente' : ''}">
              <span class="disp-prof-info">
                <span class="disp-prof-nombre">${esc(p.apellido)}, ${esc(p.nombre)}</span>${discsText ? `<span class="disp-prof-discs"> · ${esc(discsText)}</span>` : ''}
              </span>
              <div class="disp-turno-checks">
                <label class="disp-turno-lbl">${chkPres} Presente</label>
                <label class="disp-turno-lbl disp-turno-sub">${chkMan} Mañana</label>
                <label class="disp-turno-lbl disp-turno-sub">${chkTar} Tarde</label>
                ${pres ? `<label class="disp-turno-lbl disp-turno-excluir" title="Excluir del armado automático">${chkExcl} Excluir</label>` : ''}
              </div>
            </div>`;
          }).join('')
        }
      </div>
    </div>

    <!-- Columna derecha: bloqueos paciente + bloqueos profesional + prescripciones -->
    <div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Card bloqueos de paciente -->
        <div class="card">
          <div class="card-head" style="flex-wrap:wrap;gap:4px">
            <strong>Bloqueos del paciente</strong>
            <select id="disp-pac-sel" class="select-field" style="margin-left:auto;max-width:180px">
              ${pacientes.sort((a,b)=>a.apellido.localeCompare(b.apellido)).map(p =>
                `<option value="${p.id}" ${p.id===pacSeleccionadoDisp?'selected':''}>${esc(p.apellido)}, ${esc(p.nombre)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="card-body">
            <div class="text-muted" style="margin-bottom:10px;font-size:12px">Horarios bloqueados para ${esc(pac?.nombre||'')}:</div>
            ${(pac?.bloqueosPermanentes||[]).length > 0 ? `
            <div class="bloq-tipo-legend" style="font-size:11px;margin-bottom:8px">
              <span class="bloq-tipo-badge bloq-perm-badge">🔒 Perfil</span> permanente &nbsp;·&nbsp;
              <span class="bloq-tipo-badge bloq-dia-badge">📅 Hoy</span> puntual
            </div>` : ''}
            <div class="slot-check-grid">
              ${SLOTS.map(slot => {
                const bloqPerm = (pac?.bloqueosPermanentes||[]).find(b => b.slotId === slot.id);
                const bloqDia  = bloqueosPac.find(b => b.slotId === slot.id);
                if (bloqPerm) {
                  return `<div class="slot-check-item slot-check-perm">
                    <label class="check-label check-label-perm">
                      <input type="checkbox" checked disabled>
                      <span class="slot-perm-label">${esc(slot.label)}</span>
                      <span class="bloq-tipo-badge bloq-perm-badge">🔒 Perfil</span>
                    </label>
                    ${bloqPerm.motivo ? `<div class="slot-perm-motivo">${esc(bloqPerm.motivo)}</div>` : ''}
                  </div>`;
                }
                return `<div class="slot-check-item">
                  <label class="check-label">
                    <input type="checkbox" class="chk-bloqueo" data-slot="${slot.id}" ${bloqDia ? 'checked' : ''}>
                    ${esc(slot.label)}
                    ${bloqDia ? '<span class="bloq-tipo-badge bloq-dia-badge">📅 Hoy</span>' : ''}
                  </label>
                  ${bloqDia ? `<input class="input-motivo" data-slot="${slot.id}"
                    placeholder="Motivo" value="${esc(bloqDia.motivo||'')}">` : ''}
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="card-footer">
            <button class="btn btn-primary btn-sm" id="btn-guardar-bloqueos">Guardar bloqueos</button>
          </div>
        </div>

        <!-- Card bloqueos de profesional -->
        <div class="card">
          <div class="card-head" style="flex-wrap:wrap;gap:4px">
            <strong>Bloqueos del profesional</strong>
            <select id="disp-prof-bloq-sel" class="select-field" style="margin-left:auto;max-width:180px">
              ${profs.sort((a,b)=>a.apellido.localeCompare(b.apellido)).map(p =>
                `<option value="${p.id}" ${p.id===profSeleccionadoBloqDisp?'selected':''}>${esc(p.apellido)}, ${esc(p.nombre)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="card-body">
            <div class="text-muted" style="margin-bottom:10px;font-size:12px">Horarios bloqueados puntualmente para ${esc(Profesionales.porId(profSeleccionadoBloqDisp)?.apellido||'')}:</div>
            <div class="slot-check-grid">
              ${(() => {
                const bloqsProf = (estadoGuardado||DiasState.delDia(fechaActiva)).bloqueosProfesionales?.[profSeleccionadoBloqDisp] || [];
                return SLOTS.map(slot => {
                  const bloq = bloqsProf.find(b => b.slotId === slot.id);
                  return `<div class="slot-check-item">
                    <label class="check-label">
                      <input type="checkbox" class="chk-bloq-prof" data-slot="${slot.id}" ${bloq ? 'checked' : ''}>
                      ${esc(slot.label)}
                    </label>
                    ${bloq ? `<input class="input-motivo-prof" data-slot="${slot.id}"
                      placeholder="Motivo" value="${esc(bloq.motivo||'')}">` : ''}
                  </div>`;
                }).join('');
              })()}
            </div>
          </div>
          <div class="card-footer">
            <button class="btn btn-primary btn-sm" id="btn-guardar-bloq-prof">Guardar bloqueos</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><strong>Prescripciones urgentes del día</strong> — ${esc(pac?.nombre||'')} ${esc(pac?.apellido||'')}</div>
        <div class="card-body">
          <div class="text-muted" style="margin-bottom:8px">Sesiones indicadas por el médico que deben asignarse hoy:</div>
          <div id="lista-prescripciones">
            ${prescripciones.length === 0 ? '<em>Sin prescripciones urgentes</em>' :
              prescripciones.map((pr, i) => `
              <div class="prescripcion-item">
                ${discChip(pr.disciplina, true)} x${pr.veces} — ${esc(pr.motivo)}
                <button class="btn btn-sm btn-danger" onclick="eliminarPrescripcion(${i})">✕</button>
              </div>`).join('')
            }
          </div>
          <button class="btn btn-secondary mt-4" id="btn-add-prescripcion">+ Agregar prescripción</button>
        </div>
      </div>
    </div>
  </div>`;

  return html;
}

function bindDisponibilidad() {
  document.getElementById('disp-fecha')?.addEventListener('change', e => {
    fechaActiva = e.target.value;
    renderVista();
  });

  document.getElementById('disp-pac-sel')?.addEventListener('change', e => {
    pacSeleccionadoDisp = e.target.value;
    renderVista();
  });

  // Presencia de profesionales — checkboxes Presente / Mañana / Tarde (auto-save)
  function _savePres(profId, val) {
    const pres = { ...(DiasState.delDia(fechaActiva).presenciaProfesionales || {}) };
    if (!val) {
      delete pres[profId];
      const excl = (DiasState.delDia(fechaActiva).profesionalesExcluidos || []).filter(id => id !== profId);
      DiasState.setProfesionalesExcluidos(fechaActiva, excl);
    } else {
      pres[profId] = val;
    }
    DiasState.setProfesionalesPresencia(fechaActiva, pres);
    renderVista();
  }

  document.querySelectorAll('.chk-presente').forEach(chk => {
    chk.addEventListener('change', () => {
      _savePres(chk.dataset.id, chk.checked ? 'dia' : null);
    });
  });

  document.querySelectorAll('.chk-manana').forEach(chk => {
    chk.addEventListener('change', () => {
      const profId = chk.dataset.id;
      const tarChecked = document.querySelector(`.chk-tarde[data-id="${profId}"]`)?.checked;
      const val = chk.checked ? (tarChecked ? 'dia' : 'manana') : (tarChecked ? 'tarde' : null);
      _savePres(profId, val);
    });
  });

  document.querySelectorAll('.chk-tarde').forEach(chk => {
    chk.addEventListener('change', () => {
      const profId = chk.dataset.id;
      const manChecked = document.querySelector(`.chk-manana[data-id="${profId}"]`)?.checked;
      const val = chk.checked ? (manChecked ? 'dia' : 'tarde') : (manChecked ? 'manana' : null);
      _savePres(profId, val);
    });
  });

  // Excluir del armado automático (checkbox)
  document.querySelectorAll('.chk-excluir').forEach(chk => {
    chk.addEventListener('change', () => {
      const id   = chk.dataset.id;
      const excl = DiasState.delDia(fechaActiva).profesionalesExcluidos || [];
      const nuevo = chk.checked ? [...excl.filter(x=>x!==id), id] : excl.filter(x=>x!==id);
      DiasState.setProfesionalesExcluidos(fechaActiva, nuevo);
      renderVista();
    });
  });

  document.getElementById('btn-marcar-todos')?.addEventListener('click', () => {
    const pres = {};
    Profesionales.activos().forEach(p => { pres[p.id] = 'dia'; });
    DiasState.setProfesionalesPresencia(fechaActiva, pres);
    renderVista();
  });

  document.getElementById('btn-desmarcar-todos')?.addEventListener('click', () => {
    DiasState.setProfesionalesPresencia(fechaActiva, {});
    renderVista();
  });

  document.getElementById('btn-restaurar-horario')?.addEventListener('click', () => {
    const profs = Profesionales.activos();
    const ids   = _profsDelHorario(profs, fechaActiva);
    const pres  = {};
    ids.forEach(id => { pres[id] = 'dia'; });
    DiasState.setProfesionalesPresencia(fechaActiva, pres);
    mostrarToast(`Horario del ${DIAS_SEMANA[_weekday(fechaActiva)]} aplicado`, 'success');
    renderVista();
  });

  // Bloqueos de horarios: mostrar campo de motivo dinámicamente
  document.querySelectorAll('.chk-bloqueo').forEach(chk => {
    chk.addEventListener('change', e => {
      const parent = e.target.closest('.slot-check-item');
      const slotId = e.target.dataset.slot;
      if (e.target.checked) {
        if (!parent.querySelector('.input-motivo')) {
          const inp = document.createElement('input');
          inp.className = 'input-motivo';
          inp.dataset.slot = slotId;
          inp.placeholder = 'Motivo (ej: baño, enfermería)';
          parent.appendChild(inp);
        }
      } else {
        parent.querySelector('.input-motivo')?.remove();
      }
    });
  });

  document.getElementById('btn-guardar-bloqueos')?.addEventListener('click', () => {
    const bloqueos = [];
    document.querySelectorAll('.chk-bloqueo:checked').forEach(chk => {
      const slotId = chk.dataset.slot;
      const motivo = document.querySelector(`.input-motivo[data-slot="${slotId}"]`)?.value || '';
      bloqueos.push({ slotId, motivo });
    });
    DiasState.setBloqueosPaciente(fechaActiva, pacSeleccionadoDisp, bloqueos);
    mostrarToast('Bloqueos guardados', 'success');
  });

  document.getElementById('btn-add-prescripcion')?.addEventListener('click', () => {
    abrirModalPrescripcion();
  });

  // Bloqueos de profesional
  document.getElementById('disp-prof-bloq-sel')?.addEventListener('change', e => {
    profSeleccionadoBloqDisp = e.target.value;
    renderVista();
  });

  document.querySelectorAll('.chk-bloq-prof').forEach(chk => {
    chk.addEventListener('change', e => {
      const parent = e.target.closest('.slot-check-item');
      const slotId = e.target.dataset.slot;
      if (e.target.checked) {
        if (!parent.querySelector('.input-motivo-prof')) {
          const inp = document.createElement('input');
          inp.className = 'input-motivo-prof input-motivo';
          inp.dataset.slot = slotId;
          inp.placeholder = 'Motivo';
          parent.appendChild(inp);
        }
      } else {
        parent.querySelector('.input-motivo-prof')?.remove();
      }
    });
  });

  document.getElementById('btn-guardar-bloq-prof')?.addEventListener('click', () => {
    const bloqueos = [];
    document.querySelectorAll('.chk-bloq-prof:checked').forEach(chk => {
      const slotId = chk.dataset.slot;
      const motivo = document.querySelector(`.input-motivo-prof[data-slot="${slotId}"]`)?.value || '';
      bloqueos.push({ slotId, motivo });
    });
    DiasState.setBloqueosProfesional(fechaActiva, profSeleccionadoBloqDisp, bloqueos);
    mostrarToast('Bloqueos del profesional guardados', 'success');
  });
}

function eliminarPrescripcion(idx) {
  const presc = DiasState.delDia(fechaActiva).prescripcionesUrgentes?.[pacSeleccionadoDisp] || [];
  presc.splice(idx, 1);
  DiasState.setPrescripcionesUrgentes(fechaActiva, pacSeleccionadoDisp, presc);
  renderVista();
}

function abrirModalPrescripcion() {
  const pac = Pacientes.porId(pacSeleccionadoDisp);
  const discsReq = pac ? _discsDelPlan(pac.id) : Object.keys(DISCIPLINAS);
  const discsOpts = discsReq.length > 0 ? discsReq : Object.keys(DISCIPLINAS);
  const html = `
  <div class="modal-header">
    <h3>Agregar prescripción urgente</h3>
    <button class="modal-close" onclick="cerrarModal()">✕</button>
  </div>
  <div class="modal-body modal-form">
    <div class="form-group">
      <label>Disciplina</label>
      <select id="presc-disc" class="select-field">
        ${discsOpts.map(d => `<option value="${d}">${esc(DISCIPLINAS[d]?.label||d)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Cantidad de sesiones</label>
      <input id="presc-veces" type="number" class="input-field" value="1" min="1" max="4">
    </div>
    <div class="form-group">
      <label>Motivo (indicación médica)</label>
      <input id="presc-motivo" class="input-field" placeholder="Ej: Indicación Dr. García por episodio respiratorio">
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="guardarPrescripcion()">Agregar</button>
    </div>
  </div>`;
  abrirModal(html);
}

function guardarPrescripcion() {
  const disc = document.getElementById('presc-disc').value;
  const veces = parseInt(document.getElementById('presc-veces').value) || 1;
  const motivo = document.getElementById('presc-motivo').value.trim();
  const presc = DiasState.delDia(fechaActiva).prescripcionesUrgentes?.[pacSeleccionadoDisp] || [];
  presc.push({ disciplina: disc, veces, motivo });
  DiasState.setPrescripcionesUrgentes(fechaActiva, pacSeleccionadoDisp, presc);
  cerrarModal();
  renderVista();
  mostrarToast('Prescripción agregada', 'success');
}

// ─── Vista: Métricas ─────────────────────────────────────────────────────────

function vistaMetricas() {
  const sesiones = Asignaciones.delDia(fechaActiva);
  const pacientes = Pacientes.activos();
  const profs = Profesionales.activos();
  const metricas = calcularMetricas(sesiones, pacientes);

  let html = `<div class="vista-header">
    <div class="vista-header-left">
      <h2>Métricas del día</h2>
      <input type="date" id="met-fecha" value="${fechaActiva}" class="date-input">
    </div>
  </div>`;

  if (sesiones.length === 0) {
    html += `<div class="empty-state"><p>No hay agenda generada para el ${formatFecha(fechaActiva)}.</p></div>`;
    return html;
  }

  // Resumen global
  const totalAsignadas = sesiones.length;
  const totalObjetivo = pacientes.length * HORAS_OBJETIVO_DIA;
  const cumplimientoGlobal = Math.round(totalAsignadas / totalObjetivo * 100);
  const pacConDeficit = pacientes.filter(p => (metricas.porPaciente[p.id]?.horasAsignadas || 0) < HORAS_OBJETIVO_DIA).length;

  html += `<div class="metricas-resumen">
    <div class="metrica-card">
      <div class="metrica-num">${totalAsignadas}</div>
      <div class="metrica-label">Sesiones totales</div>
    </div>
    <div class="metrica-card">
      <div class="metrica-num" style="color:${pctColor(cumplimientoGlobal)}">${cumplimientoGlobal}%</div>
      <div class="metrica-label">Cumplimiento global</div>
    </div>
    <div class="metrica-card">
      <div class="metrica-num ${pacConDeficit > 0 ? 'color-danger' : 'color-success'}">${pacConDeficit}</div>
      <div class="metrica-label">Pacientes con déficit</div>
    </div>
    <div class="metrica-card">
      <div class="metrica-num">${profs.filter(p => (metricas.porProfesional[p.id]?.sesiones||0) > 0).length}</div>
      <div class="metrica-label">Profesionales activos hoy</div>
    </div>
  </div>

  <div class="metricas-columnas">
    <div>
      <h3>Cumplimiento por paciente</h3>
      ${pacientes.sort((a,b)=>a.apellido.localeCompare(b.apellido)).map(p => {
        const m = metricas.porPaciente[p.id] || { horasAsignadas: 0, pct: 0 };
        const color = pctColor(m.pct);
        return `<div class="metrica-row">
          <div class="metrica-row-label">${esc(p.apellido)}, ${esc(p.nombre)}</div>
          <div class="metrica-row-bar">
            <div class="bar-fill" style="width:${Math.min(100,m.pct)}%;background:${color}"></div>
          </div>
          <div class="metrica-row-val" style="color:${color}">${m.horasAsignadas}/${HORAS_OBJETIVO_DIA}h</div>
        </div>`;
      }).join('')}
    </div>

    <div>
      <h3>Carga por profesional</h3>
      ${profs.sort((a,b)=>a.apellido.localeCompare(b.apellido)).map(p => {
        const m = metricas.porProfesional[p.id] || { sesiones: 0, pct: 0, pacientesAtendidos: 0 };
        const color = m.pct > 80 ? 'var(--color-danger)' : m.pct > 50 ? 'var(--color-warning)' : 'var(--color-success)';
        return `<div class="metrica-row">
          <div class="metrica-row-label">${esc(p.apellido)}, ${esc(p.nombre)}</div>
          <div class="metrica-row-bar">
            <div class="bar-fill" style="width:${m.pct}%;background:${color}"></div>
          </div>
          <div class="metrica-row-val" style="color:${color}">${m.sesiones}/${SLOTS.length} ses.</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  return html;
}

function bindMetricas() {
  document.getElementById('met-fecha')?.addEventListener('change', e => {
    fechaActiva = e.target.value;
    renderVista();
  });
}

// ─── Vista: Auditoría ─────────────────────────────────────────────────────────

// ─── Vista: Historial ────────────────────────────────────────────────────────

let historialTipo = 'paciente';
let historialSeleccionado = null;

function diaSemana(fecha) {
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const [y, m, d] = fecha.split('-').map(Number);
  return dias[new Date(y, m - 1, d).getDay()];
}

function vistaHistorial() {
  const pacientes     = Pacientes.activos();
  const profesionales = Profesionales.activos();
  const esPac = historialTipo === 'paciente';

  // Lista de selección
  const opciones = esPac
    ? pacientes.map(p => ({ id: p.id, label: `${p.nombre} ${p.apellido}` }))
    : profesionales.map(p => ({ id: p.id, label: Profesionales.nombreCompleto(p) }));

  let html = `
  <div class="vista-header">
    <div class="vista-header-left"><h2>Historial</h2></div>
  </div>
  <div class="hist-layout">
    <div class="hist-sidebar">
      <div class="tab-group">
        <button class="tab-btn${esPac ? ' active' : ''}" onclick="cambiarTipoHistorial('paciente')">Pacientes</button>
        <button class="tab-btn${!esPac ? ' active' : ''}" onclick="cambiarTipoHistorial('profesional')">Profesionales</button>
      </div>
      <div class="hist-lista">`;

  opciones.forEach(op => {
    const activo = op.id === historialSeleccionado ? ' hist-item-activo' : '';
    html += `<div class="hist-item${activo}" onclick="cambiarSelHistorial('${op.id}')">${esc(op.label)}</div>`;
  });

  html += `</div></div>
    <div class="hist-detalle">`;

  if (!historialSeleccionado) {
    html += `<div class="empty-state"><div class="empty-icon">🕐</div>
      <p>Seleccioná un ${esPac ? 'paciente' : 'profesional'} para ver su historial.</p></div>`;
  } else {
    html += esPac
      ? vistaHistorialPaciente(historialSeleccionado)
      : vistaHistorialProfesional(historialSeleccionado);
  }

  html += `</div></div>`;
  return html;
}

function vistaHistorialPaciente(pacienteId) {
  const pac = Pacientes.porId(pacienteId);
  if (!pac) return '<p>Paciente no encontrado.</p>';

  const todasAsignaciones = Asignaciones.todos();
  const fechas = Object.keys(todasAsignaciones)
    .filter(f => todasAsignaciones[f].some(s => s.pacienteId === pacienteId))
    .sort().reverse().slice(0, 20);

  if (fechas.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">📋</div>
      <p>${esc(pac.nombre)} ${esc(pac.apellido)} no tiene sesiones registradas.</p></div>`;
  }

  // Estadísticas globales
  const todasSesiones = fechas.flatMap(f => todasAsignaciones[f].filter(s => s.pacienteId === pacienteId));
  const totalSesiones = todasSesiones.length;
  const diasCompletos = fechas.filter(f => {
    const ss = todasAsignaciones[f].filter(s => s.pacienteId === pacienteId);
    return ss.length >= HORAS_OBJETIVO_DIA;
  }).length;
  const profesUnicos = new Set(todasSesiones.map(s => s.profesionalId)).size;

  let html = `
  <div class="hist-nombre">${esc(pac.nombre)} ${esc(pac.apellido)}</div>
  <div class="hist-stats">
    <div class="hist-stat"><span class="hist-stat-num">${totalSesiones}</span><span class="hist-stat-lbl">Sesiones</span></div>
    <div class="hist-stat"><span class="hist-stat-num">${fechas.length}</span><span class="hist-stat-lbl">Días</span></div>
    <div class="hist-stat"><span class="hist-stat-num">${diasCompletos}</span><span class="hist-stat-lbl">Días completos</span></div>
    <div class="hist-stat"><span class="hist-stat-num">${profesUnicos}</span><span class="hist-stat-lbl">Profesionales</span></div>
  </div>
  <table class="hist-tabla">
    <thead><tr>
      <th>Fecha</th>
      <th>Horas</th>
      <th>Sesiones</th>
    </tr></thead>
    <tbody>`;

  fechas.forEach(fecha => {
    const ss = todasAsignaciones[fecha].filter(s => s.pacienteId === pacienteId);
    const horas = ss.filter(s => s.disciplina !== '_almuerzo').length;
    html += `<tr>
      <td><span class="hist-fecha">${formatFecha(fecha)}</span> <span class="hist-dia">${diaSemana(fecha)}</span></td>
      <td>
        <div class="hist-barra-wrap">
          <div class="hist-barra" style="width:${Math.min(100, horas / HORAS_OBJETIVO_DIA * 100).toFixed(0)}%;background:${pctColor(horas / HORAS_OBJETIVO_DIA * 100)}"></div>
        </div>
        <span class="hist-horas-txt">${horas}/${HORAS_OBJETIVO_DIA}</span>
      </td>
      <td class="hist-chips">`;

    ss.forEach(s => {
      const prof = Profesionales.porId(s.profesionalId);
      const ini  = prof ? Profesionales.iniciales(prof) : '?';
      const esRef = pac.referentes && pac.referentes[s.disciplina] === s.profesionalId;
      const esManual = s.origen === 'manual';
      const d = DISCIPLINAS[s.disciplina];
      const bg = d ? d.bg : '#f0f0f0';
      const col = d ? d.color : '#333';
      const brd = d ? d.border : '#ccc';
      const lbl = s.disciplina === '_almuerzo' ? '🍽' : (d ? d.corto : s.disciplina);
      html += `<span class="hist-chip" style="background:${bg};color:${col};border-color:${brd}" title="${discLabel(s.disciplina)} · ${prof ? Profesionales.nombreCompleto(prof) : 'Sin asignar'}">${esc(lbl)} ${esc(ini)}${esRef ? ' ★' : ''}${esManual ? ' ✏' : ''}</span>`;
    });

    html += `</td></tr>`;
  });

  html += `</tbody></table>`;

  // Distribución por disciplina
  const conteo = {};
  todasSesiones.forEach(s => {
    if (s.disciplina !== '_almuerzo') conteo[s.disciplina] = (conteo[s.disciplina] || 0) + 1;
  });
  const max = Math.max(...Object.values(conteo), 1);

  html += `<div class="hist-distribucion"><h4>Distribución por disciplina</h4>`;
  Object.entries(conteo).sort((a, b) => b[1] - a[1]).forEach(([disc, n]) => {
    const d = DISCIPLINAS[disc];
    html += `<div class="hist-dist-row">
      <span class="hist-dist-lbl">${d ? d.corto : disc}</span>
      <div class="hist-dist-barra-wrap">
        <div class="hist-dist-barra" style="width:${(n/max*100).toFixed(0)}%;background:${d ? d.bg : '#e0e0e0'};border:1px solid ${d ? d.border : '#ccc'}"></div>
      </div>
      <span class="hist-dist-n">${n}</span>
    </div>`;
  });
  html += `</div>`;

  return html;
}

function vistaHistorialProfesional(profesionalId) {
  const prof = Profesionales.porId(profesionalId);
  if (!prof) return '<p>Profesional no encontrado.</p>';

  const todasAsignaciones = Asignaciones.todos();
  const fechas = Object.keys(todasAsignaciones)
    .filter(f => todasAsignaciones[f].some(s => s.profesionalId === profesionalId))
    .sort().reverse().slice(0, 20);

  if (fechas.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">📋</div>
      <p>${esc(Profesionales.nombreCompleto(prof))} no tiene sesiones registradas.</p></div>`;
  }

  const todasSesiones = fechas.flatMap(f => todasAsignaciones[f].filter(s => s.profesionalId === profesionalId));
  const totalSesiones = todasSesiones.length;
  const pacUnicos = new Set(todasSesiones.map(s => s.pacienteId)).size;

  let html = `
  <div class="hist-nombre">${esc(Profesionales.nombreCompleto(prof))}</div>
  <div class="hist-stats">
    <div class="hist-stat"><span class="hist-stat-num">${totalSesiones}</span><span class="hist-stat-lbl">Sesiones</span></div>
    <div class="hist-stat"><span class="hist-stat-num">${fechas.length}</span><span class="hist-stat-lbl">Días</span></div>
    <div class="hist-stat"><span class="hist-stat-num">${pacUnicos}</span><span class="hist-stat-lbl">Pacientes</span></div>
  </div>
  <table class="hist-tabla">
    <thead><tr>
      <th>Fecha</th>
      <th>Sesiones</th>
      <th>Pacientes</th>
    </tr></thead>
    <tbody>`;

  fechas.forEach(fecha => {
    const ss = todasAsignaciones[fecha].filter(s => s.profesionalId === profesionalId);
    html += `<tr>
      <td><span class="hist-fecha">${formatFecha(fecha)}</span> <span class="hist-dia">${diaSemana(fecha)}</span></td>
      <td>${ss.length}</td>
      <td class="hist-chips">`;

    ss.forEach(s => {
      const pac = Pacientes.porId(s.pacienteId);
      const d = DISCIPLINAS[s.disciplina];
      const bg = d ? d.bg : '#f0f0f0';
      const col = d ? d.color : '#333';
      const brd = d ? d.border : '#ccc';
      const lbl = s.disciplina === '_almuerzo' ? '🍽' : (d ? d.corto : s.disciplina);
      const nomPac = pac ? `${pac.nombre} ${pac.apellido}` : 'Sin paciente';
      const slot = SLOTS.find(sl => sl.id === s.slotId);
      html += `<span class="hist-chip" style="background:${bg};color:${col};border-color:${brd}" title="${esc(nomPac)} · ${discLabel(s.disciplina)} · ${slot ? slot.label : s.slotId}">${esc(lbl)} ${pac ? esc(pac.apellido.slice(0, 8)) : '?'}</span>`;
    });

    html += `</td></tr>`;
  });

  html += `</tbody></table>`;

  // Distribución por paciente
  const conteo = {};
  todasSesiones.forEach(s => {
    const pac = Pacientes.porId(s.pacienteId);
    const nombre = pac ? `${pac.nombre} ${pac.apellido}` : s.pacienteId;
    conteo[nombre] = (conteo[nombre] || 0) + 1;
  });
  const max = Math.max(...Object.values(conteo), 1);

  html += `<div class="hist-distribucion"><h4>Distribución por paciente</h4>`;
  Object.entries(conteo).sort((a, b) => b[1] - a[1]).forEach(([nombre, n]) => {
    html += `<div class="hist-dist-row">
      <span class="hist-dist-lbl">${esc(nombre.split(' ')[0])}</span>
      <div class="hist-dist-barra-wrap">
        <div class="hist-dist-barra" style="width:${(n/max*100).toFixed(0)}%;background:#dbeafe;border:1px solid #93c5fd"></div>
      </div>
      <span class="hist-dist-n">${n}</span>
    </div>`;
  });
  html += `</div>`;

  return html;
}

function bindHistorial() {
  // Los eventos se manejan con atributos onclick en el HTML generado
}

function cambiarTipoHistorial(tipo) {
  historialTipo = tipo;
  historialSeleccionado = null;
  renderVista();
}

function cambiarSelHistorial(id) {
  historialSeleccionado = id;
  renderVista();
}

// ─── Vista: Auditoría ─────────────────────────────────────────────────────────

function vistaAuditoria() {
  const entradas = Auditoria.todos();

  const iconos = {
    generacion_automatica: '⚡',
    modificacion_manual:   '✏️',
    eliminacion:           '🗑'
  };

  let html = `<div class="vista-header">
    <div class="vista-header-left"><h2>Registro de auditoría</h2></div>
    <div class="vista-header-right">
      <button class="btn btn-secondary" onclick="limpiarAuditoria()">Limpiar historial</button>
    </div>
  </div>`;

  if (entradas.length === 0) {
    html += `<div class="empty-state"><div class="empty-icon">📝</div><p>Sin entradas de auditoría.</p></div>`;
    return html;
  }

  html += `<div class="audit-lista">`;
  entradas.forEach(e => {
    const tipo = e.tipo || 'desconocido';
    html += `<div class="audit-item">
      <div class="audit-icon">${iconos[tipo] || '📋'}</div>
      <div class="audit-content">
        <div class="audit-desc">${esc(e.descripcion)}</div>
        <div class="audit-meta">
          ${formatTimestamp(e.timestamp)}
          ${e.fecha ? ` · Fecha agenda: ${formatFecha(e.fecha)}` : ''}
          ${e.consensuado !== null && e.consensuado !== undefined
            ? ` · ${e.consensuado ? '✓ Consensuado' : '⚠ Unilateral'}` : ''}
        </div>
      </div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

function limpiarAuditoria() {
  if (confirm('¿Eliminar todo el historial de auditoría?')) {
    escribirStorage(STORAGE_KEYS.auditoria, []);
    renderVista();
  }
}

// ─── Toast de notificaciones ──────────────────────────────────────────────────

function mostrarToast(mensaje, tipo = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-visible'), 50);
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// ─── Inicialización ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Login obligatorio: si no hay sesión válida (o el email no está en la
  //    allowlist), requireAuth() ya redirigió a login.html.
  const usuario = await requireAuth();
  if (!usuario) return;

  // 2. Cargar datos desde Supabase antes de dibujar nada
  document.getElementById('app').classList.add('cargando-datos');
  await cargarDatosRemotos();
  document.getElementById('app').classList.remove('cargando-datos');

  // 3. Suscribirse a cambios remotos (otros usuarios) y re-renderizar
  suscribirCambiosRemotos(() => renderVista());

  // 4. Presencia: avisar quién más está conectado ahora mismo
  if (typeof iniciarPresencia === 'function') iniciarPresencia(usuario);

  // Migración: grupo 'ambulatorio' → esAmbulatorio: true
  migrarDatos();

  // Fecha en sidebar
  document.getElementById('sidebar-fecha').textContent =
    new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Navegación
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.vista));
  });

  // Sidebar en mobile: se abre/cierra por tap (no depende de :hover)
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.toggle('mobile-open');
  });
  document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
  });

  // Modal: cerrar al hacer click fuera
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) cerrarModal();
  });

  // Datos de ejemplo (botón en sidebar)
  document.getElementById('btn-datos-ejemplo')?.addEventListener('click', () => {
    cargarDatosEjemplo();
    renderVista();
  });

  // Cerrar sesión (botón en sidebar)
  document.getElementById('btn-cerrar-sesion')?.addEventListener('click', cerrarSesion);

  // Inicializar capa de persistencia (intenta reconectar archivo vinculado)
  inicializarPersistencia().then(() => renderVista());

  renderVista();
});

// ── Sistema de tooltips ────────────────────────────────────────────────────────
// Muestra un tooltip flotante tras 1 segundo de hover sobre [data-tooltip].
// Usa position:fixed para escapar de contenedores con overflow:hidden (sidebar).
(function () {
  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  document.body.appendChild(tip);

  let timer = null;

  function mostrar(el) {
    const texto = el.dataset.tooltip;
    if (!texto) return;

    const pos   = el.dataset.tooltipPos || 'above';
    const rect  = el.getBoundingClientRect();
    const GAP   = 10;

    tip.textContent = texto;
    tip.className   = 'app-tooltip ' + (pos === 'right' ? 'tip-right' : 'tip-above');

    // Posición provisional para medir tamaño real
    tip.style.left      = '-9999px';
    tip.style.top       = '-9999px';
    tip.style.transform = 'none';

    // Necesitamos el tamaño antes de posicionar
    requestAnimationFrame(() => {
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;

      let left, top;
      if (pos === 'right') {
        left = rect.right + GAP;
        top  = rect.top + rect.height / 2 - th / 2;
      } else {
        left = rect.left + rect.width / 2 - tw / 2;
        top  = rect.top - th - GAP;
        // Si se sale por arriba, aparece debajo
        if (top < 6) {
          top = rect.bottom + GAP;
          tip.className = 'app-tooltip tip-below';
        }
      }
      // Ajuste horizontal para no salirse por los bordes
      left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));

      tip.style.left = left + 'px';
      tip.style.top  = top  + 'px';
      tip.classList.add('tip-show');
    });
  }

  function ocultar() {
    clearTimeout(timer);
    tip.classList.remove('tip-show');
  }

  // Event delegation: captura mouseenter/leave en toda la página
  document.addEventListener('mouseenter', e => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    clearTimeout(timer);
    timer = setTimeout(() => mostrar(el), 950);
  }, true);

  document.addEventListener('mouseleave', e => {
    if (e.target.closest('[data-tooltip]')) ocultar();
  }, true);

  // Ocultar al hacer click o scroll
  document.addEventListener('click',  ocultar, true);
  document.addEventListener('scroll', ocultar, true);
}());
