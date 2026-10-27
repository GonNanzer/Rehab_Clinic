// crear_desde_texto.js — "Crear desde texto": alta masiva de sesiones a partir de texto plano.
//
// Cada renglón es una sesión con la forma:  horario  paciente  disciplina  profesional
//   · horario: hora de INICIO del slot ("9" = 09:00 – 10:00).
//   · paciente: apellido (el sistema guarda las 3 primeras letras) + nombre/inicial opcional
//     ("omatarco", "oviedo paola", "ovi p").
//   · disciplina: nombre o abreviatura ("kine", "fono", "ktr", "to", "psico"…).
//   · profesional: apellido y/o nombre.
// Lo que no se puede resolver con certeza se pregunta en la revisión previa; las reglas
// de validación son las mismas que las de crear una sesión a mano (ver _cdtValidarFila).

const _CDT_ALIAS_DISC = {
  kinesiologia:             ['kinesiologia', 'kinesio', 'kine', 'kin', 'kinesiologo', 'kinesiologa'],
  kinesiologiaRespiratoria: ['kinesiologia respiratoria', 'kinesio respiratoria', 'kine respiratoria',
                             'kinesio resp', 'kine resp', 'ktr', 'respiratoria', 'resp'],
  fonoaudiologia:           ['fonoaudiologia', 'fono', 'fonoaudiologo', 'fonoaudiologa'],
  terapiaOcupacional:       ['terapia ocupacional', 'terapia ocup', 't ocup', 'ocupacional', 'to', 't o'],
  neuropsicologia:          ['neuropsicologia', 'neuropsi', 'neuro'],
  psicologia:               ['psicologia', 'psico'],
  educacionFisica:          ['educacion fisica', 'ed fisica', 'edfisica', 'ef'],
  ingenieriaBiomedica:      ['ingenieria biomedica', 'ing biomedica', 'biomedica', 'ib'],
  odontologia:              ['odontologia', 'odonto'],
  fisiatria:                ['fisiatria', 'fisiatra'],
  trabajoSocial:            ['trabajo social', 'ts'],
  acompananteTerapeutica:   ['acompanante terapeutica', 'acompanante terapeutico', 'acompanante', 'at']
};

let _cdt = null; // { fecha, texto, filas, fase }

function _cdtNorm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
}

function _cdtAliasDisciplinas() {
  const lista = [];
  Object.entries(DISCIPLINAS).forEach(([key, d]) => {
    const aliases = new Set([_cdtNorm(d.label), _cdtNorm(d.corto), ...(_CDT_ALIAS_DISC[key] || [])]);
    aliases.forEach(a => { if (a) lista.push({ key, alias: a, n: a.split(' ').length }); });
  });
  return lista.sort((a, b) => b.n - a.n || b.alias.length - a.alias.length);
}

// ─── Parseo de renglones ──────────────────────────────────────────────────────

function _cdtParsearHora(tokens) {
  const reHora  = /^(\d{1,2})(?:[:.h](\d{2}))?(?:hs?)?$/i;
  const reRango = /^(\d{1,2})[-–](\d{1,2})$/;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let m = t.match(reRango);
    if (m) {
      if (+m[2] !== +m[1] + 1) return { error: `"${t}" no es un slot de una hora` };
      return _cdtSlotDeHora(+m[1], '00', i);
    }
    m = t.match(reHora);
    if (m) return _cdtSlotDeHora(+m[1], m[2] || '00', i);
  }
  return { error: 'No encontré el horario (ej: 9 para 09:00 – 10:00)' };
}

function _cdtSlotDeHora(h, min, idx) {
  if (min !== '00') return { error: 'Los horarios son por hora completa (ej: 9 = 09:00 – 10:00)' };
  const slot = SLOTS.find(s => s.id === `slot_${String(h).padStart(2, '0')}`);
  if (!slot) return { error: `No hay un slot que empiece a las ${h}:00 (de ${SLOTS[0].inicio} a ${SLOTS[SLOTS.length - 1].inicio})` };
  return { slotId: slot.id, idx };
}

// Busca el tramo de tokens que corresponde a la disciplina (alias más largo primero).
function _cdtBuscarDisciplina(tokensNorm) {
  for (const a of _cdtAliasDisciplinas()) {
    for (let i = 1; i + a.n <= tokensNorm.length; i++) { // i>=1: antes va el paciente
      if (tokensNorm.slice(i, i + a.n).join(' ') === a.alias) return { key: a.key, desde: i, hasta: i + a.n };
    }
  }
  return null;
}

// Apellido guardado (3 letras, o completo) vs. lo escrito: compatibles si coinciden en el tramo común (≥3 letras).
function _cdtApellidoCompatible(escrito, guardado) {
  const n = Math.min(escrito.length, guardado.length);
  return n >= 3 && escrito.slice(0, n) === guardado.slice(0, n);
}

function _cdtResolverPaciente(tokens) {
  const pacs = Pacientes.activos();
  const intento = (apTok, nomToks) => {
    const porApe = pacs.filter(p => _cdtApellidoCompatible(apTok, _cdtNorm(p.apellido).replace(/ /g, '')));
    if (nomToks.length === 0) return { cands: porApe, sel: porApe.length === 1 ? porApe[0].id : '' };
    const nomTok = nomToks[0];
    let porIni = porApe.filter(p => _cdtNorm(p.nombre)[0] === nomTok[0]);
    if (porIni.length > 1) {
      const afinado = porIni.filter(p => _cdtNorm(p.nombre).startsWith(nomTok));
      if (afinado.length >= 1) porIni = afinado;
    }
    if (porIni.length === 1) return { cands: porIni, sel: porIni[0].id };
    if (porIni.length > 1)   return { cands: porIni, sel: '' };
    return { cands: porApe, sel: '', inicialNoCoincide: porApe.length > 0 }; // apellido sin esa inicial: confirmar
  };
  const norm = tokens.map(_cdtNorm).filter(Boolean);
  if (norm.length === 0) return { cands: [], sel: '' };
  let r = intento(norm[0], norm.slice(1));
  if (r.cands.length === 0 && norm.length >= 2) r = intento(norm[norm.length - 1], norm.slice(0, -1)); // "paola oviedo"
  return r;
}

function _cdtResolverProfesional(tokens, disc, slotId, fecha) {
  const norm = tokens.map(_cdtNorm).filter(Boolean);
  const activos = Profesionales.activos();
  const tieneDisc = p => (p.disciplinas || []).includes(disc);
  if (norm.length === 0) {
    // Sin profesional escrito: ofrecer los que pueden atender esa disciplina en ese día y horario
    const cands = profesionalesDisponiblesParaSlot(fecha, slotId, disc);
    return { cands, sel: '', faltante: true };
  }
  let cands = activos.filter(p => {
    const ape = _cdtNorm(p.apellido).replace(/ /g, '');
    const nom = _cdtNorm(p.nombre);
    let hitApe = false;
    const ok = norm.every(t => {
      if (t.length >= 3 && (ape.startsWith(t) || t.startsWith(ape) && ape.length >= 3)) { hitApe = true; return true; }
      if (t.length >= 1 && nom.split(' ').some(w => w.startsWith(t))) return true;
      return false;
    });
    return ok && (hitApe || norm.some(t => t.length >= 3 && nom.split(' ').some(w => w.startsWith(t))));
  });
  const exactos = cands.filter(p => norm.includes(_cdtNorm(p.apellido).replace(/ /g, '')));
  if (exactos.length) cands = exactos;
  const conDisc = cands.filter(tieneDisc);
  if (conDisc.length) cands = conDisc;
  if (cands.length === 0) {
    // No lo encontró: ofrecer los de esa disciplina disponibles en el horario
    return { cands: profesionalesDisponiblesParaSlot(fecha, slotId, disc), sel: '', noEncontrado: norm.join(' ') };
  }
  return { cands, sel: cands.length === 1 ? cands[0].id : '' };
}

function _cdtParsearLinea(linea, n, fecha) {
  const fila = { n, raw: linea, error: null, slotId: null, pacCands: [], pacSel: '', disc: '', profCands: [], profSel: '',
                 nota: [], estado: 'error', errores: [], avisos: [], pendientes: [] };
  const tokens = linea.split(/[\s,;|]+/).filter(t => t && !/^[-–—]+$/.test(t));
  const h = _cdtParsearHora(tokens);
  if (h.error) { fila.error = h.error; return fila; }
  fila.slotId = h.slotId;
  const resto = tokens.filter((_, i) => i !== h.idx);
  const restoNorm = resto.map(_cdtNorm);
  const d = _cdtBuscarDisciplina(restoNorm);
  if (!d) { fila.error = 'No pude identificar la disciplina (ej: kine, fono, ktr, to, psico)'; return fila; }
  fila.disc = d.key;
  const tokPac  = resto.slice(0, d.desde);
  const tokProf = resto.slice(d.hasta);
  if (tokPac.length === 0) { fila.error = 'Falta el paciente'; return fila; }

  const pr = _cdtResolverPaciente(tokPac);
  if (pr.cands.length === 0) { fila.error = `No encontré ningún paciente activo que coincida con "${tokPac.join(' ')}"`; return fila; }
  fila.pacCands = pr.cands.map(p => p.id);
  fila.pacSel = pr.sel;
  if (pr.inicialNoCoincide) fila.nota.push(`Ningún paciente "${tokPac[0]}" tiene la inicial "${tokPac[1][0].toUpperCase()}": confirmá cuál es`);

  const pf = _cdtResolverProfesional(tokProf, d.key, h.slotId, fecha);
  fila.profCands = pf.cands.map(p => p.id);
  fila.profSel = pf.sel;
  if (pf.faltante) fila.nota.push('Falta el profesional: elegí uno de los disponibles');
  if (pf.noEncontrado) fila.nota.push(`No encontré al profesional "${pf.noEncontrado}": elegí uno de los disponibles`);
  return fila;
}

// ─── Validación ───────────────────────────────────────────────────────────────
// Misma lógica que "Nueva sesión manual" / "Nueva sesión fija", más el solapamiento entre
// los propios renglones del texto. Los renglones válidos ocupan sus slots para los siguientes.

function _cdtEvaluar() {
  const fecha = _cdt.fecha;
  const sesionesDia = Asignaciones.delDia(fecha);
  const estadoDia = DiasState.delDia(fecha);
  const dia = _weekday(fecha);
  const lote = []; // sesiones virtuales de renglones ya aprobados

  _cdt.filas.forEach(f => {
    f.errores = []; f.avisos = []; f.pendientes = [];
    if (f.error) { f.estado = 'error'; f.errores = [f.error]; return; }

    if (!f.pacSel)  f.pendientes.push('Elegí el paciente');
    if (!f.profSel) f.pendientes.push('Elegí el profesional');
    if (f.pendientes.length) { f.estado = 'pregunta'; return; }

    const pac  = Pacientes.porId(f.pacSel);
    const prof = Profesionales.porId(f.profSel);
    const slot = SLOTS.find(s => s.id === f.slotId);
    const nomPac = pac ? `${apeNom(pac)}` : '?';
    const error = msg => { f.errores.push(msg); f.estado = 'error'; };

    if (!_discPermitida(f.disc)) return error('Solo podés crear sesiones de tu área');
    if (!prof || prof.activo === false) return error('El profesional no está activo');
    if (!(prof.disciplinas || []).includes(f.disc))
      return error(`${Profesionales.nombreCompleto(prof)} no atiende ${DISCIPLINAS[f.disc].label}`);

    const fuera = _motivoFueraDeHorarioAmbulatorio(pac, fecha, f.slotId);
    if (fuera) return error(fuera);

    const bloq = _slotsBloqueadosPaciente(pac, estadoDia, dia)[f.slotId];
    if (bloq) {
      const motivo = bloq === 'BAÑO' ? 'tiene su horario de baño'
                   : bloq === 'BLOQ_PERM' ? 'tiene el horario bloqueado (permanente)'
                   : 'tiene el horario bloqueado ese día';
      return error(`${nomPac} ${motivo} en ${slot.label}`);
    }

    const disp = _disponibilidadProfSlot(prof, estadoDia, slot, fecha);
    if (!disp.ok) return error(`${Profesionales.nombreCompleto(prof)}: ${disp.razon}`);

    const todas = [...sesionesDia, ...lote];
    const delPacEnSlot = todas.find(s => s.pacienteId === pac.id && s.slotId === f.slotId);
    if (delPacEnSlot) return error(`${nomPac} ya tiene una sesión en ${slot.label}`);

    const ocupantes = todas.filter(s => s.slotId === f.slotId &&
      (s.profesionalId === prof.id || (s.profesionalesAdicionales || []).includes(prof.id)));
    if (ocupantes.length) {
      // Única excepción: KTR dual (dos pacientes del mismo edificio, ninguno bloquea KTR compartido)
      const dualOk = f.disc === 'kinesiologiaRespiratoria' && ocupantes.length === 1 &&
        ocupantes[0].disciplina === 'kinesiologiaRespiratoria' && !ocupantes[0].profesionalesAdicionales?.length &&
        (() => {
          const otro = Pacientes.porId(ocupantes[0].pacienteId);
          return pac.edificio && pac.edificio === otro?.edificio && !pac.bloqueaKTR && !otro?.bloqueaKTR;
        })();
      if (!dualOk) {
        const otro = Pacientes.porId(ocupantes[0].pacienteId);
        return error(`${Profesionales.nombreCompleto(prof)} ya tiene una sesión en ${slot.label}` +
          (otro ? ` (${apeNom(otro)})` : ''));
      }
    }

    // Avisos (no bloquean, igual que en la creación manual)
    const limite = pac.limitesDiarios?.[f.disc];
    if (limite > 0) {
      const cant = todas.filter(s => s.pacienteId === pac.id && s.disciplina === f.disc).length + 1;
      if (cant > limite) f.avisos.push(`Supera el límite diario de ${DISCIPLINAS[f.disc].corto} (${cant}/${limite})`);
    }
    if (!_discsDelPlan(pac.id).includes(f.disc)) f.avisos.push(`${DISCIPLINAS[f.disc].corto} no está en el plan del paciente`);
    if (pac.requiereAlmuerzoTerapeutico && slot.esAlmuerzo) f.avisos.push('El horario está reservado a su almuerzo terapéutico');

    f.estado = 'ok';
    lote.push({ pacienteId: pac.id, profesionalId: prof.id, slotId: f.slotId, disciplina: f.disc });
  });
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function abrirModalCrearDesdeTexto() {
  if (!_puedeCrear(usuarioActual?.rol)) return;
  _cdt = { fecha: fechaActiva, texto: _cdt?.texto || '', filas: [], fase: 'editar' };
  document.querySelector('.sidebar')?.classList.remove('mobile-open'); // cerrar el drawer en mobile
  _cdtRenderEditar();
  setTimeout(() => document.getElementById('cdt-texto')?.focus(), 0);
}

function _cdtRenderEditar() {
  abrirModal(`
    <div class="modal-header">
      <h3>Crear desde texto — ${esc(formatFecha(_cdt.fecha))}</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <p class="text-muted" style="font-size:12px;margin-bottom:8px">
        Un renglón por sesión: <strong>horario paciente disciplina profesional</strong>.
        El horario es el inicio del slot (<em>9</em> = 09:00 – 10:00).
        Paciente: apellido y nombre o inicial (<em>ovi p</em>, <em>oviedo paola</em>).
      </p>
      <textarea id="cdt-texto" class="cdt-textarea" rows="15" spellcheck="false"
        placeholder="9 ovi p kine garcia&#10;10 oma ktr perez&#10;11 oviedo gabriel fono lopez">${esc(_cdt.texto)}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="_cdtRevisar()">Revisar</button>
    </div>`, 'wide');
}

function _cdtRevisar() {
  const texto = document.getElementById('cdt-texto')?.value ?? _cdt.texto;
  _cdt.texto = texto;
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lineas.length === 0) { mostrarToast('Escribí al menos una sesión.', 'warning'); return; }
  _cdt.filas = lineas.map((l, i) => _cdtParsearLinea(l, i + 1, _cdt.fecha));
  _cdt.fase = 'revisar';
  _cdtEvaluar();
  _cdtRenderRevisar();
}

function _cdtSelect(i, campo, cands, sel, labelFn) {
  return `<select class="select-field cdt-sel" onchange="_cdtElegir(${i},'${campo}',this.value)">
    <option value="">— elegir —</option>
    ${cands.map(id => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(labelFn(id))}</option>`).join('')}
  </select>`;
}

function _cdtRenderRevisar() {
  const nOk = _cdt.filas.filter(f => f.estado === 'ok').length;
  const nPreg = _cdt.filas.filter(f => f.estado === 'pregunta').length;
  const nErr = _cdt.filas.filter(f => f.estado === 'error').length;
  const labPac  = id => { const p = Pacientes.porId(id); return p ? `${apeNom(p)}` : '?'; };
  const labProf = id => Profesionales.nombreCompleto(Profesionales.porId(id));

  const filas = _cdt.filas.map((f, i) => {
    const slot = SLOTS.find(s => s.id === f.slotId);
    const icono = { ok: f.avisos.length ? '⚠' : '✅', pregunta: '❓', error: '❌' }[f.estado];
    const pacHtml = f.error ? '<span class="text-muted">—</span>'
      : (f.pacCands.length === 1 && f.pacSel) ? esc(labPac(f.pacSel))
      : _cdtSelect(i, 'pac', f.pacCands, f.pacSel, labPac);
    const profHtml = f.error ? '<span class="text-muted">—</span>'
      : (f.profCands.length === 1 && f.profSel) ? esc(labProf(f.profSel))
      : f.profCands.length ? _cdtSelect(i, 'prof', f.profCands, f.profSel, labProf)
      : '<span class="text-muted">sin candidatos</span>';
    const msgs = [...f.errores.map(m => `<div class="cdt-msg cdt-err">${esc(m)}</div>`),
                  ...(f.estado === 'pregunta' ? f.nota.map(m => `<div class="cdt-msg cdt-preg">${esc(m)}</div>`) : []),
                  ...f.avisos.map(m => `<div class="cdt-msg cdt-aviso">${esc(m)}</div>`)].join('');
    return `<tr class="cdt-fila cdt-${f.estado}">
      <td>${icono}</td>
      <td>${slot ? esc(slot.inicio) : '—'}</td>
      <td>${pacHtml}</td>
      <td>${f.disc ? esc(DISCIPLINAS[f.disc].corto) : '—'}</td>
      <td>${profHtml}</td>
      <td><div class="cdt-raw">${esc(f.raw)}</div>${msgs}</td>
    </tr>`;
  }).join('');

  abrirModal(`
    <div class="modal-header">
      <h3>Revisar sesiones — ${esc(formatFecha(_cdt.fecha))}</h3>
      <button class="modal-close" onclick="cerrarModal()">✕</button>
    </div>
    <div class="modal-body">
      <p class="text-muted" style="font-size:12px;margin-bottom:10px">
        ✅ ${nOk} lista${nOk === 1 ? '' : 's'} · ❓ ${nPreg} por confirmar · ❌ ${nErr} con error.
        Se crean solo las listas; los demás renglones quedan sin crear.
      </p>
      <div class="tabla-plan-wrap">
        <table class="tabla-plan cdt-tabla">
          <thead><tr><th></th><th>Hora</th><th>Paciente</th><th>Disciplina</th><th>Profesional</th><th>Renglón / detalle</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="_cdtVolver()">← Editar texto</button>
      <button class="btn btn-primary" id="cdt-crear" onclick="_cdtCrear()" ${nOk ? '' : 'disabled'}>Crear ${nOk} sesion${nOk === 1 ? '' : 'es'}</button>
    </div>`, 'wide');
}

function _cdtVolver() { _cdt.fase = 'editar'; _cdtRenderEditar(); }

function _cdtElegir(i, campo, valor) {
  const f = _cdt.filas[i];
  if (!f) return;
  if (campo === 'pac') f.pacSel = valor; else f.profSel = valor;
  _cdtEvaluar();
  _cdtRenderRevisar();
}

async function _cdtCrear() {
  if (!_cdt || _cdt.fase !== 'revisar') return;
  const btn = document.getElementById('cdt-crear');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
  // Refrescar contra el servidor y revalidar: otra persona pudo ocupar horarios mientras se revisaba
  if (typeof cargarDatosRemotos === 'function') {
    try { await cargarDatosRemotos(); }
    catch (err) { console.error('No se pudo refrescar contra el servidor, sigo con el cache local:', err); }
  }
  const antes = _cdt.filas.filter(f => f.estado === 'ok').length;
  _cdtEvaluar();
  const listas = _cdt.filas.filter(f => f.estado === 'ok');
  if (listas.length < antes) {
    _cdtRenderRevisar();
    mostrarToast('Algunos horarios cambiaron mientras revisabas. Revisá la lista antes de crear.', 'warning', 5000);
    return;
  }
  listas.forEach(f => Asignaciones.crearSesionManual(_cdt.fecha, f.pacSel, f.profSel, f.disc, f.slotId));
  const omitidas = _cdt.filas.length - listas.length;
  cerrarModal();
  renderVista();
  mostrarToast(`${listas.length} sesion${listas.length === 1 ? '' : 'es'} creada${listas.length === 1 ? '' : 's'}` +
    (omitidas ? ` · ${omitidas} sin crear` : ''), 'success', 4000);
  // Dejar en el texto solo los renglones que no se crearon, por si quiere corregirlos
  _cdt = { fecha: _cdt.fecha, texto: _cdt.filas.filter(f => f.estado !== 'ok').map(f => f.raw).join('\n'), filas: [], fase: 'editar' };
}
