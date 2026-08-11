// data.js — Capa de persistencia (cache en memoria + Supabase)
//
// Todas las lecturas (Pacientes.todos(), etc.) siguen siendo sincrónicas:
// leen de un cache en memoria (_cache) que se pobla una vez al inicio desde
// Supabase (ver cargarDatosRemotos()). Cada escritura actualiza el cache al
// instante y dispara en paralelo (sin esperar) un push a Supabase, para que
// el resto de la app (algorithm.js, app.js) no tenga que volverse async.
//
// Un canal de Realtime avisa cuando otro usuario cambió datos, refresca el
// cache y vuelve a renderizar (ver suscribirCambiosRemotos()).

// ─── Utilidades ──────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function hoy() {
  return new Date().toISOString().split('T')[0];
}

// ─── Cache en memoria ─────────────────────────────────────────────────────────

const _cache = {
  pacientes: [],
  profesionales: [],
  planes: {},
  diasState: {},
  asignaciones: {},
  historial: [],
  auditoria: []
};

// Mapa STORAGE_KEYS.pacientes ('rehab_pacientes') → 'pacientes', etc.
const _claveACampo = Object.fromEntries(
  Object.entries(STORAGE_KEYS).map(([campo, clave]) => [clave, campo])
);

function leerStorage(clave, valorDefault) {
  const campo = _claveACampo[clave];
  const valor = _cache[campo];
  return valor !== undefined ? valor : valorDefault;
}

function escribirStorage(clave, valor) {
  const campo = _claveACampo[clave];
  _cache[campo] = valor;

  if (typeof onDataChanged === 'function') onDataChanged();

  _sincronizarConSupabase(campo, valor).catch(err =>
    console.error(`Error sincronizando "${campo}" con Supabase:`, err));

  return true;
}

// ─── Sincronización con Supabase ──────────────────────────────────────────────
// Cada colección se guarda como filas { clave, data-jsonb } en su tabla.
// Al escribir se hace upsert de lo vigente y se borra lo que ya no está en el
// array/objeto local (equivalente a "reemplazar la colección completa").

const _SUPA_MAP = {
  pacientes:     { table: 'pacientes',     tipo: 'array-id' },
  profesionales: { table: 'profesionales', tipo: 'array-id' },
  auditoria:     { table: 'auditoria',     tipo: 'array-id' },
  planes:        { table: 'planes',        tipo: 'objeto', keyCol: 'paciente_id' },
  diasState:     { table: 'dias_state',    tipo: 'objeto', keyCol: 'fecha' },
  asignaciones:  { table: 'asignaciones',  tipo: 'objeto', keyCol: 'fecha' }
  // 'historial' no pasa por acá: se sincroniza de forma incremental
  // directamente desde Historial.registrarBulk (ver más abajo).
};

function _filtroListaTexto(col, valores) {
  return `(${valores.map(v => `"${v}"`).join(',')})`;
}

async function _sincronizarConSupabase(campo, valor) {
  if (typeof supabaseClient === 'undefined') return; // sin Supabase configurado aún
  const cfg = _SUPA_MAP[campo];
  if (!cfg) return;

  if (cfg.tipo === 'array-id') {
    const items = valor || [];
    const rows  = campo === 'auditoria'
      ? items.map(a => ({ id: a.id, timestamp: a.timestamp, data: a }))
      : items.map(o => ({ id: o.id, data: o }));
    const ids = items.map(o => o.id);

    if (rows.length) {
      const { error } = await supabaseClient.from(cfg.table).upsert(rows);
      if (error) throw error;
    }
    const del = supabaseClient.from(cfg.table).delete();
    const { error: errDel } = ids.length
      ? await del.not('id', 'in', _filtroListaTexto('id', ids))
      : await del.neq('id', '__ninguno__');
    if (errDel) throw errDel;

  } else if (cfg.tipo === 'objeto') {
    const obj  = valor || {};
    const keys = Object.keys(obj);
    const rows = keys.map(k => {
      if (campo === 'planes') return { paciente_id: k, sesiones: obj[k].sesiones ?? obj[k], meta: obj[k].meta ?? null };
      if (campo === 'diasState') return { fecha: k, data: obj[k] };
      if (campo === 'asignaciones') return { fecha: k, sesiones: obj[k] };
    });

    if (rows.length) {
      const { error } = await supabaseClient.from(cfg.table).upsert(rows);
      if (error) throw error;
    }
    const del = supabaseClient.from(cfg.table).delete();
    const { error: errDel } = keys.length
      ? await del.not(cfg.keyCol, 'in', _filtroListaTexto(cfg.keyCol, keys))
      : await del.neq(cfg.keyCol, '__ninguno__');
    if (errDel) throw errDel;
  }
}

// ─── Carga inicial desde Supabase ──────────────────────────────────────────────
// Se llama una vez al arrancar la app (después de requireAuth()), antes del
// primer renderVista().

async function cargarDatosRemotos() {
  const [pac, prof, pln, dia, asig, hist, aud] = await Promise.all([
    supabaseClient.from('pacientes').select('*'),
    supabaseClient.from('profesionales').select('*'),
    supabaseClient.from('planes').select('*'),
    supabaseClient.from('dias_state').select('*'),
    supabaseClient.from('asignaciones').select('*'),
    supabaseClient.from('historial').select('*'),
    supabaseClient.from('auditoria').select('*').order('timestamp', { ascending: false })
  ]);

  for (const [nombre, res] of Object.entries({ pac, prof, pln, dia, asig, hist, aud })) {
    if (res.error) console.error(`Error cargando ${nombre} desde Supabase:`, res.error);
  }

  _cache.pacientes     = (pac.data  || []).map(r => r.data);
  _cache.profesionales = (prof.data || []).map(r => r.data);
  _cache.planes        = Object.fromEntries((pln.data || []).map(r => [r.paciente_id, { sesiones: r.sesiones, meta: r.meta }]));
  _cache.diasState     = Object.fromEntries((dia.data || []).map(r => [r.fecha, r.data]));
  _cache.asignaciones  = Object.fromEntries((asig.data || []).map(r => [r.fecha, r.sesiones]));
  _cache.historial     = (hist.data || []).map(r => ({ fecha: r.fecha, profesionalId: r.profesional_id, pacienteId: r.paciente_id, disciplina: r.disciplina }));
  _cache.auditoria     = (aud.data  || []).map(r => ({ ...r.data, id: r.id, timestamp: r.timestamp }));
}

// ─── Realtime: enterarse de cambios hechos por otros usuarios ────────────────

let _canalCambiosRemotos = null;

function suscribirCambiosRemotos(onCambioRemoto) {
  if (typeof supabaseClient === 'undefined') return null;

  const tablas = ['pacientes', 'profesionales', 'planes', 'dias_state', 'asignaciones', 'historial', 'auditoria'];
  let timer = null;

  _canalCambiosRemotos = supabaseClient.channel('rehab-datos-cambios');
  tablas.forEach(t => {
    _canalCambiosRemotos.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
      // Debounce: un guardado nuestro puede tocar varias tablas casi a la vez.
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await cargarDatosRemotos();
        if (typeof onCambioRemoto === 'function') onCambioRemoto();
      }, 400);
    });
  });
  _canalCambiosRemotos.subscribe();
  return _canalCambiosRemotos;
}

// ─── Pacientes ────────────────────────────────────────────────────────────────

const Pacientes = {
  todos() { return leerStorage(STORAGE_KEYS.pacientes, []); },

  activos() { return this.todos().filter(p => p.activo !== false && p.egresado !== true); },

  egresados() { return this.todos().filter(p => p.egresado === true); },

  porId(id) { return this.todos().find(p => p.id === id) || null; },

  crear(datos) {
    const paciente = {
      id: genId(),
      activo: true,
      egresado: false,
      fechaIngreso: hoy(),
      edificio: null,                   // 'arriba' | 'abajo'
      grupo: null,                      // 'tec' | 'acv' | 'medular'
      esAmbulatorio: false,             // paciente ambulatorio (no internado)
      diasAsistencia: [],               // [1,3,5] — días que asiste (solo ambulatorio)
      slotIngreso: null,                // slot de llegada diaria (solo ambulatorio)
      slotEgreso: null,                 // slot de salida diaria (solo ambulatorio)
      transferencias: null,             // clave de TRANSFERENCIAS
      disciplinasRequeridas: [],
      limitesDiarios: {},               // { disciplina: maxSesionesPorDia }
      bloqueaKTR: false,                // impide atención KTR simultánea con otro paciente
      bloqueosPermanentes: [],          // [{ slotId, motivo }] — el algoritmo los lee directo
      requiereHigiene: false,           // necesita rutina de higiene matutina (reserva slot 09:00)
      disciplinasHigiene: [],           // disciplinas responsables, en orden de prioridad ([] = "-elegir-": cualquiera)
      requiereAlmuerzoTerapeutico: false,
      disciplinasAlmuerzo: [],          // disciplinas responsables, en orden de prioridad ([] = "-elegir-": cualquiera)
      referentes: {},
      ...datos
    };
    const lista = this.todos();
    lista.push(paciente);
    escribirStorage(STORAGE_KEYS.pacientes, lista);
    return paciente;
  },

  actualizar(id, cambios) {
    const lista = this.todos();
    const idx = lista.findIndex(p => p.id === id);
    if (idx < 0) return false;
    lista[idx] = { ...lista[idx], ...cambios };
    return escribirStorage(STORAGE_KEYS.pacientes, lista);
  },

  eliminar(id) {
    return escribirStorage(STORAGE_KEYS.pacientes,
      this.todos().filter(p => p.id !== id));
  },

  // Prioridad de scheduling: pacientes con mayor asistencia en transferencias se atienden primero
  scorePrioridad(p) {
    return TRANSFERENCIAS[p.transferencias]?.prioridad ?? 0;
  }
};

// ─── Profesionales ────────────────────────────────────────────────────────────

const Profesionales = {
  todos() { return leerStorage(STORAGE_KEYS.profesionales, []); },

  activos() { return this.todos().filter(p => p.activo !== false); },

  porId(id) { return this.todos().find(p => p.id === id) || null; },

  porDisciplina(disc) {
    return this.activos().filter(p => (p.disciplinas || []).includes(disc));
  },

  crear(datos) {
    const prof = {
      id: genId(),
      activo: true,
      disciplinas: [],
      gruposPreferencia: [],  // array ordenado de mayor a menor prioridad: ['tec','acv',...]
      grupoExclusivo: null,   // 'tec'|'acv'|'medular'|null — si != null, solo atiende ese grupo
      esPracticante: false,   // no se asigna automáticamente; visible en agenda como disponible
      diasLaborales: [],      // días que trabaja habitualmente: [1,2,3,4,5] (1=Lun … 6=Sáb)
      horariosPorDia: {},     // { dia: ['slot_09','slot_10',...] } — slots que asiste en cada día
      esCoordinador: false,   // deja al menos 1 slot libre por semana
      ...datos
    };
    const lista = this.todos();
    lista.push(prof);
    escribirStorage(STORAGE_KEYS.profesionales, lista);
    return prof;
  },

  actualizar(id, cambios) {
    const lista = this.todos();
    const idx = lista.findIndex(p => p.id === id);
    if (idx < 0) return false;
    lista[idx] = { ...lista[idx], ...cambios };
    return escribirStorage(STORAGE_KEYS.profesionales, lista);
  },

  eliminar(id) {
    return escribirStorage(STORAGE_KEYS.profesionales,
      this.todos().filter(p => p.id !== id));
  },

  nombreCompleto(prof) {
    if (!prof) return 'Desconocido';
    return `${prof.nombre || ''} ${prof.apellido || ''}`.trim();
  },

  iniciales(prof) {
    if (!prof) return '?';
    const n = (prof.nombre || ' ')[0];
    const a = (prof.apellido || ' ')[0];
    return `${n}${a}`.toUpperCase();
  }
};

// ─── Planes semanales ─────────────────────────────────────────────────────────

const Planes = {
  todos() { return leerStorage(STORAGE_KEYS.planes, {}); },

  delPaciente(pacienteId) {
    const entry = this.todos()[pacienteId];
    if (!entry) return {};
    // retrocompatibilidad: entradas antiguas son { disc: n } sin wrapper
    return entry.sesiones ?? entry;
  },

  metaDelPaciente(pacienteId) {
    const entry = this.todos()[pacienteId];
    return entry?.meta || null;
  },

  tienePlan(pacienteId) {
    const sesiones = this.delPaciente(pacienteId);
    return Object.values(sesiones).some(v => (v || 0) > 0);
  },

  // sesiones = { kinesiologia: 3, ... }  meta = { modificadoPor }
  guardar(pacienteId, sesiones, meta = null) {
    const todos  = this.todos();
    const previo = todos[pacienteId];
    todos[pacienteId] = {
      sesiones,
      meta: {
        ...(previo?.meta || {}),
        ...(meta || {}),
        modificadoEn: new Date().toISOString()
      }
    };
    return escribirStorage(STORAGE_KEYS.planes, todos);
  }
};

// ─── Estado del día ───────────────────────────────────────────────────────────

const DiasState = {
  todos() { return leerStorage(STORAGE_KEYS.diasState, {}); },

  delDia(fecha) {
    return this.todos()[fecha] || {
      fecha,
      profesionalesExcluidos: [],
      bloquesPacientes: {},
      prescripcionesUrgentes: {},
      generadoEn: null
    };
  },

  guardar(fecha, cambios) {
    const todos = this.todos();
    todos[fecha] = { ...this.delDia(fecha), ...cambios };
    return escribirStorage(STORAGE_KEYS.diasState, todos);
  },

  setProfesionalesPresentes(fecha, ids) {
    return this.guardar(fecha, { profesionalesPresentes: ids });
  },

  setProfesionalesPresencia(fecha, presencias) {
    return this.guardar(fecha, { presenciaProfesionales: presencias });
  },

  setProfesionalesExcluidos(fecha, ids) {
    return this.guardar(fecha, { profesionalesExcluidos: ids });
  },

  setBloqueosPaciente(fecha, pacienteId, bloqueos) {
    const estado = this.delDia(fecha);
    estado.bloquesPacientes[pacienteId] = bloqueos;
    return this.guardar(fecha, estado);
  },

  setPrescripcionesUrgentes(fecha, pacienteId, prescripciones) {
    const estado = this.delDia(fecha);
    estado.prescripcionesUrgentes[pacienteId] = prescripciones;
    return this.guardar(fecha, estado);
  },

  setBloqueosProfesional(fecha, profId, bloqueos) {
    const estado = this.delDia(fecha);
    if (!estado.bloqueosProfesionales) estado.bloqueosProfesionales = {};
    estado.bloqueosProfesionales[profId] = bloqueos;
    return this.guardar(fecha, estado);
  }
};

// ─── Asignaciones ─────────────────────────────────────────────────────────────

const Asignaciones = {
  todos() { return leerStorage(STORAGE_KEYS.asignaciones, {}); },

  delDia(fecha) {
    return this.todos()[fecha] || [];
  },

  guardarDia(fecha, sesiones) {
    const todos = this.todos();
    todos[fecha] = sesiones;
    return escribirStorage(STORAGE_KEYS.asignaciones, todos);
  },

  actualizarSesion(fecha, sesionId, cambios) {
    const sesiones = this.delDia(fecha);
    const idx = sesiones.findIndex(s => s.id === sesionId);
    if (idx < 0) return false;
    const antes = { ...sesiones[idx] };
    sesiones[idx] = {
      ...sesiones[idx],
      ...cambios,
      origen: 'manual',
      modificadoEn: new Date().toISOString()
    };
    const todos = this.todos();
    todos[fecha] = sesiones;
    escribirStorage(STORAGE_KEYS.asignaciones, todos);
    Auditoria.registrar({
      tipo: 'modificacion_manual',
      fecha,
      sesionId,
      descripcion: `Sesión de ${antes.pacienteId} en slot ${antes.slotId} modificada manualmente`,
      antes,
      despues: sesiones[idx]
    });
    return true;
  },

  toggleFijo(fecha, sesionId, fijo) {
    const sesiones = this.delDia(fecha);
    const idx = sesiones.findIndex(s => s.id === sesionId);
    if (idx < 0) return false;
    sesiones[idx] = { ...sesiones[idx], fijo: !!fijo };
    const todos = this.todos();
    todos[fecha] = sesiones;
    return escribirStorage(STORAGE_KEYS.asignaciones, todos);
  },

  crearSesionManual(fecha, pacienteId, profesionalId, disciplina, slotId) {
    const slot = (typeof SLOTS !== 'undefined') ? SLOTS.find(s => s.id === slotId) : null;
    const sesion = {
      id: genId(),
      fecha,
      pacienteId,
      profesionalId,
      disciplina,
      slotId,
      inicio:      slot?.inicio || '',
      fin:         slot?.fin    || '',
      esAlmuerzo:  slot?.esAlmuerzo || false,
      origen:                'manual',
      puntaje:               null,
      motivo:                'Creada manualmente',
      urgente:               false,
      fijo:                  true,
      profesionalesAdicionales: [],
      creadoEn:    new Date().toISOString(),
      modificadoEn: new Date().toISOString()
    };
    const sesiones = this.delDia(fecha);
    sesiones.push(sesion);
    this.guardarDia(fecha, sesiones);
    Auditoria.registrar({
      tipo: 'creacion_manual',
      fecha,
      sesionId: sesion.id,
      descripcion: `Sesión manual: ${pacienteId} — ${disciplina} — ${slotId}`
    });
    return sesion;
  },

  delPacienteEnSemana(pacienteId, inicioSemana, finSemana) {
    const todos = this.todos();
    const resultado = [];
    for (const fecha in todos) {
      if (fecha >= inicioSemana && fecha <= finSemana) {
        const ss = todos[fecha].filter(s => s.pacienteId === pacienteId);
        resultado.push(...ss);
      }
    }
    return resultado;
  }
};

// ─── Historial de atenciones (para rotación) ─────────────────────────────────

const Historial = {
  todos() { return leerStorage(STORAGE_KEYS.historial, []); },

  registrarBulk(fecha, sesiones) {
    const todos = this.todos();
    const nuevas = sesiones.map(s => ({
      fecha,
      profesionalId: s.profesionalId,
      pacienteId:    s.pacienteId,
      disciplina:    s.disciplina
    }));
    todos.push(...nuevas);
    // Conservar últimos 90 días para no crecer indefinidamente
    const corte = new Date();
    corte.setDate(corte.getDate() - 90);
    const corteStr = corte.toISOString().split('T')[0];
    const filtrado = todos.filter(h => h.fecha >= corteStr);

    _cache.historial = filtrado;
    if (typeof onDataChanged === 'function') onDataChanged();

    // Sync incremental con Supabase: insertar solo lo nuevo y podar lo viejo
    // (evita reescribir toda la tabla en cada generación de agenda).
    if (typeof supabaseClient !== 'undefined') {
      if (nuevas.length) {
        supabaseClient.from('historial')
          .insert(nuevas.map(n => ({ fecha: n.fecha, profesional_id: n.profesionalId, paciente_id: n.pacienteId, disciplina: n.disciplina })))
          .then(({ error }) => { if (error) console.error('Error insertando historial en Supabase:', error); });
      }
      supabaseClient.from('historial').delete().lt('fecha', corteStr)
        .then(({ error }) => { if (error) console.error('Error podando historial en Supabase:', error); });
    }
    return true;
  },

  // Devuelve la cantidad de días-asistencia del profesional desde la última vez que
  // atendió a este paciente en esta disciplina. Usa las fechas en que el profesional
  // aparece en el historial como proxy de "días que asistió a la clínica".
  diasDesdeUltimaAtencion(profesionalId, pacienteId, disciplina) {
    const todos = this.todos();

    // Fechas distintas en que este profesional aparece en el historial (= días que asistió)
    const fechasAsistencia = [...new Set(
      todos.filter(h => h.profesionalId === profesionalId).map(h => h.fecha)
    )].sort();

    // Última fecha en que este profesional atendió a este paciente en esta disciplina
    const atenciones = todos
      .filter(h =>
        h.profesionalId === profesionalId &&
        h.pacienteId === pacienteId &&
        h.disciplina === disciplina
      )
      .map(h => h.fecha)
      .sort()
      .reverse();

    if (atenciones.length === 0) return Infinity; // Nunca lo atendió

    const ultimaFecha = atenciones[0];
    // Días-asistencia desde esa fecha
    return fechasAsistencia.filter(f => f > ultimaFecha).length;
  }
};

// ─── Auditoría ────────────────────────────────────────────────────────────────

const Auditoria = {
  todos() { return leerStorage(STORAGE_KEYS.auditoria, []); },

  registrar(entrada) {
    const todos = this.todos();
    todos.unshift({
      id: genId(),
      timestamp: new Date().toISOString(),
      consensuado: null, // null = no registrado aún (campo futuro)
      ...entrada
    });
    // Mantener últimas 500 entradas
    return escribirStorage(STORAGE_KEYS.auditoria, todos.slice(0, 500));
  }
};

// ─── Migración de datos ───────────────────────────────────────────────────────
// Convierte pacientes con grupo='ambulatorio' al nuevo campo esAmbulatorio: true

function migrarDatos() {
  const pacs = Pacientes.todos();
  const necesita = pacs.some(p => p.grupo === 'ambulatorio');
  if (!necesita) return;
  const actualizados = pacs.map(p => {
    if (p.grupo !== 'ambulatorio') return p;
    return { ...p, esAmbulatorio: true, grupo: null };
  });
  escribirStorage(STORAGE_KEYS.pacientes, actualizados);
}

// Convierte disciplinaHigiene (un solo valor) y disciplinasAlmuerzo (checkboxes
// sin orden) al mismo formato: lista de disciplinas por prioridad, donde []
// significa "-elegir-" (cualquiera). Los pacientes que ya requerían la
// rutina la siguen requiriendo, ahora con la disciplina en "-elegir-".
function migrarHigieneAlmuerzo() {
  const pacs = Pacientes.todos();
  const necesita = pacs.some(p =>
    'disciplinaHigiene' in p || !Array.isArray(p.disciplinasHigiene) || !Array.isArray(p.disciplinasAlmuerzo)
  );
  if (!necesita) return;
  const actualizados = pacs.map(p => {
    const { disciplinaHigiene, ...resto } = p;
    return { ...resto, disciplinasHigiene: [], disciplinasAlmuerzo: [] };
  });
  escribirStorage(STORAGE_KEYS.pacientes, actualizados);
}

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────

function cargarDatosEjemplo() {
  if (Pacientes.activos().length > 0 || Profesionales.activos().length > 0) {
    if (!confirm('Ya existen datos cargados. ¿Reemplazar con datos de ejemplo?')) return;
    // Limpiar todo (cache + Supabase)
    escribirStorage(STORAGE_KEYS.pacientes, []);
    escribirStorage(STORAGE_KEYS.profesionales, []);
    escribirStorage(STORAGE_KEYS.planes, {});
    escribirStorage(STORAGE_KEYS.diasState, {});
    escribirStorage(STORAGE_KEYS.asignaciones, {});
    escribirStorage(STORAGE_KEYS.auditoria, []);
    _cache.historial = [];
    if (typeof supabaseClient !== 'undefined') {
      supabaseClient.from('historial').delete().neq('fecha', '0001-01-01')
        .then(({ error }) => { if (error) console.error('Error limpiando historial en Supabase:', error); });
    }
  }

  // Profesionales
  const profs = [
    { nombre: 'Ana',      apellido: 'Rodríguez', disciplinas: ['kinesiologia'] },
    { nombre: 'Martín',   apellido: 'López',     disciplinas: ['kinesiologia', 'kinesiologiaRespiratoria'] },
    { nombre: 'Sofía',    apellido: 'García',    disciplinas: ['kinesiologiaRespiratoria'] },
    { nombre: 'Lucas',    apellido: 'Fernández', disciplinas: ['fonoaudiologia'] },
    { nombre: 'Valeria',  apellido: 'Torres',    disciplinas: ['fonoaudiologia', 'terapiaOcupacional'] },
    { nombre: 'Diego',    apellido: 'Martínez',  disciplinas: ['terapiaOcupacional'] },
    { nombre: 'Camila',   apellido: 'Sánchez',   disciplinas: ['neuropsicologia'] },
    { nombre: 'Federico', apellido: 'Gómez',     disciplinas: ['psicologia'] }
  ].map(d => Profesionales.crear(d));

  // Pacientes
  const pacs = [
    {
      nombre: 'Carlos', apellido: 'Méndez', habitacion: '101',
      complejidad: { dependenciaFisica: 3, complejidadCognitiva: 2, cargaConductual: 1 },
      disciplinasRequeridas: ['kinesiologia', 'fonoaudiologia', 'terapiaOcupacional'],
      requiereAlmuerzoTerapeutico: true,
      disciplinasAlmuerzo: ['fonoaudiologia', 'terapiaOcupacional'],
      referentes: {
        kinesiologia: profs[0].id,
        fonoaudiologia: profs[3].id,
        terapiaOcupacional: profs[5].id
      }
    },
    {
      nombre: 'Marta', apellido: 'Pérez', habitacion: '102',
      complejidad: { dependenciaFisica: 2, complejidadCognitiva: 1, cargaConductual: 2 },
      disciplinasRequeridas: ['kinesiologia', 'neuropsicologia', 'psicologia'],
      requiereAlmuerzoTerapeutico: false,
      referentes: {
        kinesiologia: profs[1].id,
        neuropsicologia: profs[6].id,
        psicologia: profs[7].id
      }
    },
    {
      nombre: 'Roberto', apellido: 'Silva', habitacion: '103',
      complejidad: { dependenciaFisica: 1, complejidadCognitiva: 3, cargaConductual: 3 },
      disciplinasRequeridas: ['kinesiologiaRespiratoria', 'fonoaudiologia', 'neuropsicologia'],
      requiereAlmuerzoTerapeutico: true,
      disciplinasAlmuerzo: ['fonoaudiologia'],
      referentes: {
        kinesiologiaRespiratoria: profs[2].id,
        fonoaudiologia: profs[4].id,
        neuropsicologia: profs[6].id
      }
    },
    {
      nombre: 'Elena', apellido: 'Castro', habitacion: '104',
      complejidad: { dependenciaFisica: 2, complejidadCognitiva: 2, cargaConductual: 1 },
      disciplinasRequeridas: ['kinesiologia', 'terapiaOcupacional', 'psicologia'],
      requiereAlmuerzoTerapeutico: false,
      referentes: {
        kinesiologia: profs[0].id,
        terapiaOcupacional: profs[5].id,
        psicologia: profs[7].id
      }
    },
    {
      nombre: 'Jorge', apellido: 'Herrera', habitacion: '105',
      complejidad: { dependenciaFisica: 3, complejidadCognitiva: 1, cargaConductual: 2 },
      disciplinasRequeridas: ['kinesiologia', 'kinesiologiaRespiratoria', 'fonoaudiologia'],
      requiereAlmuerzoTerapeutico: true,
      disciplinasAlmuerzo: ['terapiaOcupacional', 'fonoaudiologia'],
      referentes: {
        kinesiologia: profs[1].id,
        kinesiologiaRespiratoria: profs[2].id,
        fonoaudiologia: profs[3].id
      }
    }
  ].map(d => Pacientes.crear(d));

  // Planes semanales
  Planes.guardar(pacs[0].id, { kinesiologia: 4, fonoaudiologia: 3, terapiaOcupacional: 3 });
  Planes.guardar(pacs[1].id, { kinesiologia: 4, neuropsicologia: 2, psicologia: 2 });
  Planes.guardar(pacs[2].id, { kinesiologiaRespiratoria: 4, fonoaudiologia: 3, neuropsicologia: 2 });
  Planes.guardar(pacs[3].id, { kinesiologia: 3, terapiaOcupacional: 3, psicologia: 2 });
  Planes.guardar(pacs[4].id, { kinesiologia: 3, kinesiologiaRespiratoria: 3, fonoaudiologia: 3 });

  alert('Datos de ejemplo cargados correctamente. Ahora configurá la disponibilidad del día y generá la agenda.');
}
