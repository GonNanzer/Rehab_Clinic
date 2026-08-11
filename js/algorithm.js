// algorithm.js — Motor de generación de agenda

// ─── Semana ───────────────────────────────────────────────────────────────────

function limitesDeSemana(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  const dow = d.getDay(); // 0=Dom
  const diffLunes = dow === 0 ? -6 : 1 - dow;
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diffLunes);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return {
    inicio: lunes.toISOString().split('T')[0],
    fin:    domingo.toISOString().split('T')[0]
  };
}

// Días laborables restantes en la semana incluyendo la fecha dada (Lun–Vie)
function diasLaborablesRestantes(fecha) {
  const dow = new Date(fecha + 'T00:00:00').getDay();
  if (dow === 0 || dow === 6) return 1; // fin de semana: contar como 1
  return 6 - dow; // lunes=1→5, martes=2→4, miércoles=3→3, jueves=4→2, viernes=5→1
}

// slot_08 + delta(±1) → slot_09 / slot_07. Se usa para los bloqueos de
// "hora anterior/siguiente" del baño; si cae fuera del horario terapéutico
// simplemente no matchea ningún SLOTS y no bloquea nada.
function _slotAdyacente(slotId, delta) {
  const m = /^slot_(\d{2})$/.exec(slotId || '');
  if (!m) return null;
  return `slot_${String(Number(m[1]) + delta).padStart(2, '0')}`;
}

// Aplica los bloqueos de baño semanal de un paciente para el día dado
// (el slot del baño en sí, y opcionalmente la hora anterior/siguiente).
function _aplicarBloqueosBano(patientSlots, pacienteId, bañosSemana, diaActual) {
  (bañosSemana || []).forEach(b => {
    if (b.dia !== diaActual) return;
    if (SLOTS.some(s => s.id === b.slotId) && !patientSlots[pacienteId][b.slotId])
      patientSlots[pacienteId][b.slotId] = 'BAÑO';
    if (b.bloqAnterior) {
      const idAnt = _slotAdyacente(b.slotId, -1);
      if (idAnt && SLOTS.some(s => s.id === idAnt) && !patientSlots[pacienteId][idAnt])
        patientSlots[pacienteId][idAnt] = 'BAÑO';
    }
    if (b.bloqSiguiente) {
      const idSig = _slotAdyacente(b.slotId, 1);
      if (idSig && SLOTS.some(s => s.id === idSig) && !patientSlots[pacienteId][idSig])
        patientSlots[pacienteId][idSig] = 'BAÑO';
    }
  });
}

// ─── Construcción de necesidades ─────────────────────────────────────────────

/*
 * Devuelve una lista de "necesidades" para el paciente en el día dado.
 * Cada ítem es: { tipo, disciplina, esAlmuerzo, slotForzado, urgente, motivoUrgente, prioridad }
 */
function construirNecesidades(paciente, plan, conteoSemanal, prescripcionesUrgentes, fecha) {
  const necesidades = [];

  // 0. Rutina de higiene matutina: reserva slot 09:00
  if (paciente.requiereHigiene && paciente.disciplinaHigiene) {
    necesidades.push({
      tipo: 'higiene', disciplina: paciente.disciplinaHigiene,
      esAlmuerzo: false, slotForzado: 'slot_09',
      urgente: false, prioridad: 11
    });
  }

  // 1. Almuerzo terapéutico: siempre en slot 12:00-13:00
  if (paciente.requiereAlmuerzoTerapeutico) {
    necesidades.push({
      tipo: 'almuerzo', disciplina: '_almuerzo',
      esAlmuerzo: true, slotForzado: 'slot_12',
      urgente: false, prioridad: 10
    });
  }

  // 2. Prescripciones urgentes del día
  (prescripcionesUrgentes || []).forEach(p => {
    for (let i = 0; i < (p.veces || 1); i++) {
      necesidades.push({
        tipo: 'urgente', disciplina: p.disciplina,
        esAlmuerzo: false, urgente: true,
        motivoUrgente: p.motivo, prioridad: 9
      });
    }
  });

  // 3. Sesiones regulares basadas en plan semanal
  const horasYaOcupadas = necesidades.length;
  let horasPorCubrir = HORAS_OBJETIVO_DIA - horasYaOcupadas;
  if (horasPorCubrir <= 0) return necesidades;

  const disciplinas = Object.keys(plan).filter(d => (plan[d] || 0) > 0);
  if (disciplinas.length === 0) return necesidades;

  const diasRestantes = diasLaborablesRestantes(fecha);

  // Calcular cuántas sesiones de cada disciplina queremos hoy
  const idealHoy = {};
  disciplinas.forEach(disc => {
    const targetSemana = plan[disc] || 0;
    const hechasSemana = conteoSemanal[disc] || 0;
    const restanSemana = Math.max(0, targetSemana - hechasSemana);
    idealHoy[disc] = restanSemana > 0 ? Math.ceil(restanSemana / diasRestantes) : 0;
  });

  // Si el plan no definió nada, distribuir uniformemente
  const totalIdeal = Object.values(idealHoy).reduce((a, b) => a + b, 0);
  if (totalIdeal === 0) {
    const porDisc = Math.max(1, Math.floor(horasPorCubrir / disciplinas.length));
    disciplinas.forEach(disc => { idealHoy[disc] = porDisc; });
  }

  // Aplicar límites diarios por disciplina si están definidos en el paciente
  disciplinas.forEach(disc => {
    const limite = paciente.limitesDiarios?.[disc];
    if (limite > 0) idealHoy[disc] = Math.min(idealHoy[disc] || 0, limite);
  });

  // Primer pase: agregar las sesiones ideales
  let horasAgregadas = 0;
  const contadoresPorDisc = {};
  disciplinas.forEach(disc => {
    const cantidad = Math.min(idealHoy[disc] || 0, horasPorCubrir - horasAgregadas);
    for (let i = 0; i < cantidad; i++) {
      necesidades.push({ tipo: 'regular', disciplina: disc, esAlmuerzo: false, urgente: false, prioridad: 5 });
      horasAgregadas++;
    }
    contadoresPorDisc[disc] = cantidad;
  });

  // Segundo pase: completar horas restantes con round-robin por disciplinas,
  // respetando los límites diarios de cada disciplina.
  let idx = 0;
  let guard = disciplinas.length * horasPorCubrir * 2;
  while (horasAgregadas < horasPorCubrir && guard-- > 0) {
    const disc = disciplinas[idx % disciplinas.length];
    idx++;
    const limiteDisc = paciente.limitesDiarios?.[disc];
    if (limiteDisc > 0 && (contadoresPorDisc[disc] || 0) >= limiteDisc) continue;
    necesidades.push({ tipo: 'relleno', disciplina: disc, esAlmuerzo: false, urgente: false, prioridad: 3 });
    horasAgregadas++;
    contadoresPorDisc[disc] = (contadoresPorDisc[disc] || 0) + 1;
  }

  return necesidades;
}

// ─── Puntuación de asignación ────────────────────────────────────────────────

function calcularPuntaje(prof, slot, slotIdx, paciente, disciplina, esAlmuerzo, urgente,
                          sesionesActuales, profSlotsHoy, sesionesEstaSemana) {
  let total = 0;
  const motivos = [];

  // Urgencia
  if (urgente) { total += 200; motivos.push('Prescripción urgente del día'); }

  // Referente
  const esReferente = !esAlmuerzo && paciente.referentes?.[disciplina] === prof.id;
  if (esReferente) {
    total += 100;
    motivos.push('Profesional referente asignado');
    // Bonus adicional si no cumplió mínimo semanal
    const visitasRefSemana = (sesionesEstaSemana || [])
      .filter(s => s.profesionalId === prof.id && s.disciplina === disciplina).length;
    if (visitasRefSemana < VISITAS_MINIMAS_REFERENTE_SEMANA) {
      total += 50;
      motivos.push(`Referente: ${visitasRefSemana}/${VISITAS_MINIMAS_REFERENTE_SEMANA} visitas mínimas semanales`);
    }
  }

  // Balance de carga (favorece profesionales con menor carga hoy)
  // Preferencia de grupo del profesional
  // gruposPreferencia es un array ordenado de mayor a menor prioridad
  const prefs = Array.isArray(prof.gruposPreferencia)
    ? prof.gruposPreferencia
    : (prof.grupoPreferencia ? [prof.grupoPreferencia] : []); // compatibilidad con dato viejo
  const rankPref = prefs.indexOf(paciente.grupo);
  if (rankPref >= 0) {
    const bonus = [20, 14, 8][rankPref] ?? 6;
    total += bonus;
    motivos.push(`Preferencia de grupo (P${rankPref + 1}): ${GRUPOS_DIAGNOSTICOS[paciente.grupo]?.label} +${bonus}`);
  }

  const cargaActual = Object.keys(profSlotsHoy[prof.id] || {})
    .filter(k => profSlotsHoy[prof.id][k]).length;
  const balanceScore = Math.max(0, 30 - cargaActual * 4);
  total += balanceScore;
  const nivelCarga = cargaActual <= 2 ? 'baja' : cargaActual <= 5 ? 'media' : 'alta';
  motivos.push(`Carga ${nivelCarga} hoy (${cargaActual} sesiones)`);

  // Rotación (solo para no-referentes)
  if (!esReferente && !esAlmuerzo) {
    const dias = Historial.diasDesdeUltimaAtencion(prof.id, paciente.id, disciplina);
    if (dias === Infinity) {
      total += 25; motivos.push('Sin historial previo con este paciente');
    } else if (dias >= VENTANA_ROTACION_DIAS_ASISTENCIA) {
      total += 20; motivos.push(`Rotación adecuada (${dias} días-asistencia desde última atención)`);
    } else if (dias === 2) {
      total += 8;
    } else if (dias <= 1) {
      total -= 15; motivos.push(`Atendió recientemente (${dias} día/s) — rotación no recomendada`);
    }
  }

  // Orden ideal de terapias
  if (!esAlmuerzo) {
    // KTR: restricción de posicionamiento al inicio de turno.
    // Con una sola KTR diaria → inicio de mañana (slot_09, idx 0).
    // Con dos o más → la primera en slot_09, la siguiente en inicio de tarde (slot_14, idx 4).
    // Índices SLOTS: 0=09h 1=10h 2=11h 3=12h(almuerzo) 4=14h 5=15h 6=16h 7=17h 8=18h
    if (disciplina === 'kinesiologiaRespiratoria') {
      const ktrHoy = sesionesActuales.filter(
        s => s.pacienteId === paciente.id && s.disciplina === 'kinesiologiaRespiratoria'
      ).length;
      const bonusKtr = ktrHoy === 0
        ? [30, 12, 5, 0, 0, 0, 0, 0, 0][slotIdx] || 0   // primera: inicio turno mañana
        : [0,  0,  0, 0, 30, 12, 5, 2, 0][slotIdx] || 0; // siguiente: inicio turno tarde
      if (bonusKtr > 0) {
        total += bonusKtr;
        motivos.push(`KTR inicio de turno ${ktrHoy === 0 ? 'mañana' : 'tarde'} +${bonusKtr}`);
      }
    } else {
      const SLOT_ORDER_BONUS = {
        kinesiologia:       [3, 6, 9, 6, 3, 0, 0, 0, 0],
        fonoaudiologia:     [0, 0, 3, 0, 6, 9, 6, 3, 0],
        terapiaOcupacional: [0, 0, 3, 0, 6, 9, 6, 3, 0],
        neuropsicologia:    [0, 0, 0, 0, 3, 6, 9, 6, 3],
        psicologia:         [0, 0, 0, 0, 3, 6, 9, 6, 3]
      };
      const orderBonus = (SLOT_ORDER_BONUS[disciplina] || [])[slotIdx] || 0;
      if (orderBonus > 0) {
        total += orderBonus;
        motivos.push(`Orden preferido de terapia +${orderBonus}`);
      }
    }
  }

  // Penalización por horas seguidas de la misma disciplina.
  // Kinesiología tolera hasta MAX_CONSECUTIVAS_MISMA_DISCIPLINA (2) seguidas;
  // el resto de las disciplinas solo puede tener 1 consecutiva.
  if (!esAlmuerzo) {
    const maxConsec = disciplina === 'kinesiologia' ? MAX_CONSECUTIVAS_MISMA_DISCIPLINA : 1;
    let consecutivas = 0;
    for (let i = slotIdx - 1; i >= 0; i--) {
      const prevSlot = SLOTS[i];
      const prevSesion = sesionesActuales.find(s =>
        s.pacienteId === paciente.id &&
        s.slotId === prevSlot.id &&
        s.disciplina === disciplina
      );
      if (prevSesion) consecutivas++;
      else break;
    }
    if (consecutivas >= maxConsec) {
      total -= 80;
      motivos.push(`Penalización: ${consecutivas + 1} horas seguidas de ${disciplina}`);
    }
  }

  // Para almuerzo terapéutico: fonoaudiología y terapia ocupacional son prioritarias
  // sobre cualquier otra disciplina que el paciente pudiera tener configurada
  if (esAlmuerzo) {
    const discsPrioritariasAlm = ['fonoaudiologia', 'terapiaOcupacional'];
    if ((prof.disciplinas || []).some(d => discsPrioritariasAlm.includes(d))) {
      total += 30;
      motivos.push('Disciplina prioritaria para almuerzo (fono / TO)');
    }
  }

  return { total, motivos };
}

// ─── Intento de asignación ────────────────────────────────────────────────────

function intentarAsignar(necesidad, paciente, sesionesActuales, profSlotsHoy,
                          patientSlots, profsDisponibles, fecha, sesionesEstaSemana,
                          ctx = {}) {
  // ctx.coordSesEstaSemana: { profId: count } — cuota semanal de coordinadores
  const { disciplina, esAlmuerzo, slotForzado, urgente } = necesidad;

  // Verificar límite diario por disciplina (las prescripciones urgentes lo omiten)
  if (!esAlmuerzo && !urgente) {
    const limiteD = paciente.limitesDiarios?.[disciplina];
    if (limiteD > 0) {
      const yaHoy = sesionesActuales.filter(
        s => s.pacienteId === paciente.id && s.disciplina === disciplina
      ).length;
      if (yaHoy >= limiteD)
        return { ok: false, razon: 'limite_diario', msg: `Límite diario de ${disciplina} alcanzado` };
    }
  }

  // Slots candidatos
  let candidatos;
  if (slotForzado) {
    candidatos = SLOTS.filter(s => s.id === slotForzado && !patientSlots[paciente.id][s.id]);
  } else {
    candidatos = SLOTS.filter(s => {
      if (patientSlots[paciente.id][s.id]) return false;     // ocupado o bloqueado
      if (s.esAlmuerzo && paciente.requiereAlmuerzoTerapeutico) return false; // reservado para almuerzo
      if (esAlmuerzo) return s.esAlmuerzo;
      return true;
    });
  }

  if (candidatos.length === 0) {
    return { ok: false, razon: 'sin_slot', msg: 'No hay slots disponibles' };
  }

  let mejorPuntaje = -Infinity;
  let mejorAsignacion = null;

  for (const slot of candidatos) {
    const slotIdx = SLOTS.findIndex(s => s.id === slot.id);

    // Filtrar profesionales válidos para este slot
    let profsValidos;
    if (esAlmuerzo) {
      const discsAlmuerzo = paciente.disciplinasAlmuerzo?.length
        ? paciente.disciplinasAlmuerzo
        : DISCIPLINAS_ALMUERZO_DEFAULT;
      const _diaNumAlm = _weekday(fecha);
      const _estadoAlm = DiasState.delDia(fecha);
      profsValidos = profsDisponibles.filter(p => {
        if (!_profEnTurno(_estadoAlm, p.id, slot.turno, fecha)) return false;
        if (!discsAlmuerzo.some(d => (p.disciplinas || []).includes(d))) return false;
        const horariosAlm = (p.horariosPorDia || {})[_diaNumAlm];
        if (horariosAlm && horariosAlm.length > 0 && !horariosAlm.includes(slot.id)) return false;
        const slotStatus = profSlotsHoy[p.id]?.[slot.id];
        return !slotStatus;
      });
    } else {
      const _estadoSlot = DiasState.delDia(fecha);
      profsValidos = profsDisponibles.filter(p => {
        if (!_profEnTurno(_estadoSlot, p.id, slot.turno, fecha)) return false;
        if (!(p.disciplinas || []).includes(disciplina)) return false;
        // Grupo exclusivo: el profesional solo atiende su grupo asignado
        if (p.grupoExclusivo && paciente.grupo !== p.grupoExclusivo) return false;
        // Verificar disponibilidad horaria del profesional en este slot
        const diaNum = _weekday(fecha);
        const horarios = (p.horariosPorDia || {})[diaNum];
        if (horarios && horarios.length > 0 && !horarios.includes(slot.id)) return false;
        // Coordinador: cuota semanal (max total_slots_semana - 1)
        if (p.esCoordinador && ctx.coordSesEstaSemana) {
          const maxSemana = _totalSlotsSemanales(p) - 1;
          const yaAsignados = ctx.coordSesEstaSemana[p.id] || 0;
          if (yaAsignados >= maxSemana) return false;
        }
        const slotStatus = profSlotsHoy[p.id]?.[slot.id];
        if (!slotStatus) return true;
        // KTR dual: permitir segundo paciente bajo condiciones
        if (disciplina === 'kinesiologiaRespiratoria' && !Array.isArray(slotStatus)) {
          if (paciente.bloqueaKTR) return false;
          const sesExistente = sesionesActuales.find(s => s.id === slotStatus);
          if (!sesExistente) return false;
          const pacExistente = Pacientes.porId(sesExistente.pacienteId);
          if (!pacExistente) return false;
          if (pacExistente.bloqueaKTR) return false;
          if (!paciente.edificio || paciente.edificio !== pacExistente.edificio) return false;
          return true;
        }
        return false;
      });
    }

    if (profsValidos.length === 0) continue;

    for (const prof of profsValidos) {
      const { total, motivos } = calcularPuntaje(
        prof, slot, slotIdx, paciente, disciplina, esAlmuerzo, urgente,
        sesionesActuales, profSlotsHoy, sesionesEstaSemana
      );

      if (total > mejorPuntaje) {
        mejorPuntaje = total;
        mejorAsignacion = { slot, prof, motivos, puntaje: total };
      }
    }
  }

  if (!mejorAsignacion) {
    return { ok: false, razon: 'sin_profesional', msg: `Sin profesionales disponibles para ${disciplina}` };
  }

  const discFinal = esAlmuerzo ? '_almuerzo' : disciplina;

  return {
    ok: true,
    sesion: {
      id: genId(),
      fecha,
      pacienteId:     paciente.id,
      profesionalId:  mejorAsignacion.prof.id,
      disciplina:     discFinal,
      slotId:         mejorAsignacion.slot.id,
      inicio:         mejorAsignacion.slot.inicio,
      fin:            mejorAsignacion.slot.fin,
      esAlmuerzo:     !!esAlmuerzo,
      origen:         'automatico',
      puntaje:        mejorAsignacion.puntaje,
      motivo:         mejorAsignacion.motivos.join(' · '),
      urgente:        !!urgente,
      creadoEn:       new Date().toISOString()
    }
  };
}

// ─── Índice de calidad de agenda ─────────────────────────────────────────────
//
// Devuelve un score 0-100 que representa qué tan bien cubre la agenda las
// necesidades del día, ponderado por la prioridad clínica de cada paciente.
// Las prescripciones urgentes no cubiertas penalizan -10 puntos c/u.

function calcularIndiceCalidad(sesiones, pacientes, fecha) {
  const estado    = DiasState.delDia(fecha);
  const semana    = limitesDeSemana(fecha);
  const diaActual = _weekday(fecha);

  let sumPeso           = 0;
  let sumCubierto       = 0;
  let urgentesNoCubiertos = 0;
  const detallesPacientes = [];

  for (const pac of pacientes) {
    if (pac.esAmbulatorio) {
      if (!(pac.diasAsistencia || []).includes(diaActual)) continue;
    }
    const plan          = Planes.delPaciente(pac.id);
    const prescripciones = (estado.prescripcionesUrgentes || {})[pac.id] || [];

    const sessSemana   = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);
    const conteoSemanal = {};
    sessSemana.filter(s => s.fecha < fecha)
      .forEach(s => { conteoSemanal[s.disciplina] = (conteoSemanal[s.disciplina] || 0) + 1; });

    const necesidades = construirNecesidades(pac, plan, conteoSemanal, prescripciones, fecha);
    const sesDelPac   = sesiones.filter(s => s.pacienteId === pac.id);

    const necesitadas = necesidades.length;
    const cubiertas   = Math.min(sesDelPac.length, necesitadas);

    const urgentesNec  = necesidades.filter(n => n.urgente).length;
    const urgentesAsig = sesDelPac.filter(s => s.urgente).length;
    urgentesNoCubiertos += Math.max(0, urgentesNec - urgentesAsig);

    const peso  = Math.max(1, Pacientes.scorePrioridad(pac));
    const ratio = necesitadas > 0 ? cubiertas / necesitadas : 1;

    sumPeso     += peso;
    sumCubierto += peso * ratio;

    detallesPacientes.push({
      pacienteId: pac.id,
      nombre:     `${pac.nombre} ${pac.apellido}`,
      necesitadas,
      cubiertas,
      pct: Math.round(ratio * 100)
    });
  }

  let score = sumPeso > 0 ? (sumCubierto / sumPeso) * 100 : 100;
  score = Math.max(0, score - urgentesNoCubiertos * 10);

  return {
    score: Math.round(score * 10) / 10,
    detallesPacientes,
    urgentesNoCubiertos
  };
}

// ─── Generación principal ─────────────────────────────────────────────────────

// Total de slots disponibles de un profesional en la semana
// Devuelve 'dia' | 'manana' | 'tarde' | null según la presencia del profesional en el día.
// Lee el nuevo campo presenciaProfesionales con fallback al array legacy profesionalesPresentes.
function _getPresencia(estado, profId, fecha) {
  if (estado && 'presenciaProfesionales' in estado)
    return (estado.presenciaProfesionales || {})[profId] || null;
  if (estado?.profesionalesPresentes?.length)
    return estado.profesionalesPresentes.includes(profId) ? 'dia' : null;
  // Sin configuración explícita → horario habitual del día
  if (fecha) {
    const prof = Profesionales.todos().find(p => p.id === profId);
    if (prof && (prof.diasLaborales || []).includes(_weekday(fecha))) return 'dia';
  }
  return null;
}

// Devuelve true si el profesional puede trabajar en el turno del slot dado.
// almuerzo es compatible con cualquier turno.
function _profEnTurno(estado, profId, slotTurno, fecha) {
  const pres = _getPresencia(estado, profId, fecha);
  if (!pres) return false;
  if (pres === 'dia' || slotTurno === 'almuerzo') return true;
  return pres === slotTurno;
}

function _totalSlotsSemanales(prof) {
  const dias = prof.diasLaborales || [];
  if (dias.length === 0) return SLOTS.filter(s => !s.esAlmuerzo).length;
  return dias.reduce((total, d) => {
    const horarios = (prof.horariosPorDia || {})[d];
    const slotsDelDia = horarios && horarios.length > 0
      ? horarios.filter(sid => { const s = SLOTS.find(x => x.id === sid); return s && !s.esAlmuerzo; })
      : SLOTS.filter(s => !s.esAlmuerzo).map(s => s.id);
    return total + slotsDelDia.length;
  }, 0);
}

function generarAgenda(fecha, opciones = {}) {
  const { ordenOverride = null, persistir = true } = opciones;
  const estado = DiasState.delDia(fecha);
  const todosPacientes = Pacientes.activos();
  const idsExcluidos  = estado.profesionalesExcluidos  || [];
  const profsDisponibles = Profesionales.todos()
    .filter(p => p.activo !== false && !p.esPracticante && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));

  const semana = limitesDeSemana(fecha);

  // Inicializar registros de carga
  const profSlotsHoy = {};
  profsDisponibles.forEach(p => { profSlotsHoy[p.id] = {}; });

  // Bloqueos coyunturales de profesionales
  const bloqueosProfDia = estado.bloqueosProfesionales || {};
  for (const profId in bloqueosProfDia) {
    if (profSlotsHoy[profId]) {
      (bloqueosProfDia[profId] || []).forEach(b => {
        if (!profSlotsHoy[profId][b.slotId])
          profSlotsHoy[profId][b.slotId] = `BLOQ_PROF:${b.motivo || ''}`;
      });
    }
  }

  // Pre-cargar sesiones fijas (no se tocan al regenerar)
  const sesionesPrevias = Asignaciones.delDia(fecha);
  const sesionesFijas = sesionesPrevias.filter(s => s.fijo === true);

  // Inicializar slots de pacientes y aplicar bloqueos del día
  const patientSlots = {};
  todosPacientes.forEach(p => { patientSlots[p.id] = {}; });

  // Bloqueos del día (DiasState)
  const bloqueos = estado.bloquesPacientes || {};
  for (const pacId in bloqueos) {
    (bloqueos[pacId] || []).forEach(b => {
      if (patientSlots[pacId]) patientSlots[pacId][b.slotId] = `BLOQUEADO:${b.motivo}`;
    });
  }

  // Bloqueos permanentes del perfil del paciente (Opción B: algoritmo los lee directo)
  todosPacientes.forEach(p => {
    (p.bloqueosPermanentes || []).forEach(b => {
      if (!patientSlots[p.id][b.slotId])
        patientSlots[p.id][b.slotId] = `BLOQ_PERM:${b.motivo}`;
    });
  });

  // Marcar slots ocupados por sesiones fijas
  sesionesFijas.forEach(s => {
    if (patientSlots[s.pacienteId]) patientSlots[s.pacienteId][s.slotId] = s.id;
    if (profSlotsHoy[s.profesionalId]) {
      const existing = profSlotsHoy[s.profesionalId][s.slotId];
      profSlotsHoy[s.profesionalId][s.slotId] = existing
        ? [existing, s.id] : s.id;
    }
  });

  // Cálculo de cuota semanal para coordinadores
  const todosPorFecha = Asignaciones.todos();
  const coordSesEstaSemana = {};
  profsDisponibles.filter(p => p.esCoordinador).forEach(p => {
    let count = 0;
    for (const f in todosPorFecha) {
      if (f >= semana.inicio && f < fecha) {
        count += todosPorFecha[f].filter(s => s.profesionalId === p.id).length;
      }
    }
    coordSesEstaSemana[p.id] = count;
  });

  const sesiones = [...sesionesFijas];
  const alertas = [];

  // Ordenar pacientes: ambulatorios primero (garantizar que llenan todos sus slots),
  // luego el resto por prioridad de transferencias.
  const pacientesOrdenados = ordenOverride
    ? ordenOverride
    : (() => {
        const sort = (arr) => [...arr].sort((a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a));
        const ambul = todosPacientes.filter(p => p.esAmbulatorio);
        const resto = todosPacientes.filter(p => !p.esAmbulatorio);
        return [...sort(ambul), ...sort(resto)];
      })();

  const diaActual = _weekday(fecha);

  // Bloquear slots fuera de la ventana de asistencia ambulatoria
  todosPacientes.forEach(p => {
    if (!p.esAmbulatorio || !p.slotIngreso || !p.slotEgreso) return;
    if (!(p.diasAsistencia || []).includes(diaActual)) return;
    const iIng = SLOTS.findIndex(s => s.id === p.slotIngreso);
    const iEgr = SLOTS.findIndex(s => s.id === p.slotEgreso);
    if (iIng < 0 || iEgr < 0) return;
    SLOTS.forEach((s, i) => {
      if (!s.esAlmuerzo && (i < iIng || i > iEgr) && !patientSlots[p.id][s.id])
        patientSlots[p.id][s.id] = 'BLOQ_HORARIO_AMB';
    });
  });

  // Bloquear slot_12 para pacientes que almuerzan sin terapista
  todosPacientes.forEach(p => {
    if (p.almuerza === true && !p.requiereAlmuerzoTerapeutico && !patientSlots[p.id]['slot_12'])
      patientSlots[p.id]['slot_12'] = 'ALMUERZO';
  });

  // Bloquear slots de baño semanal (+ hora anterior/siguiente si corresponde)
  todosPacientes.forEach(p => {
    _aplicarBloqueosBano(patientSlots, p.id, p.bañosSemana, diaActual);
  });

  for (const paciente of pacientesOrdenados) {
    if (paciente.esAmbulatorio) {
      if (!(paciente.diasAsistencia || []).includes(diaActual)) continue;
    }
    // Saltear pacientes cuyos slots fijos ya cubrieron todas las necesidades
    const sesionesFijasDelPac = sesionesFijas.filter(s => s.pacienteId === paciente.id);
    if (sesionesFijasDelPac.length >= HORAS_OBJETIVO_DIA) continue;

    const plan = Planes.delPaciente(paciente.id);
    const prescripciones = (estado.prescripcionesUrgentes || {})[paciente.id] || [];

    // Sesiones ya hechas esta semana (antes de hoy) para calcular proporción
    const sesionesEstaSemana = Asignaciones.delPacienteEnSemana(
      paciente.id, semana.inicio, semana.fin
    );
    const conteoSemanal = {};
    sesionesEstaSemana
      .filter(s => s.fecha < fecha)
      .forEach(s => { conteoSemanal[s.disciplina] = (conteoSemanal[s.disciplina] || 0) + 1; });

    const necesidades = construirNecesidades(
      paciente, plan, conteoSemanal, prescripciones, fecha
    );

    let horasAsignadas = 0;

    for (const nec of necesidades) {
      const resultado = intentarAsignar(
        nec, paciente, sesiones, profSlotsHoy,
        patientSlots, profsDisponibles, fecha, sesionesEstaSemana,
        { coordSesEstaSemana }
      );

      if (resultado.ok) {
        sesiones.push(resultado.sesion);
        patientSlots[paciente.id][resultado.sesion.slotId] = resultado.sesion.id;
        // Registro de carga: KTR dual puede tener dos sesiones en el mismo slot
        const profId  = resultado.sesion.profesionalId;
        const slotId  = resultado.sesion.slotId;
        const existing = profSlotsHoy[profId]?.[slotId];
        if (existing) {
          profSlotsHoy[profId][slotId] = [existing, resultado.sesion.id]; // dual KTR
        } else {
          profSlotsHoy[profId][slotId] = resultado.sesion.id;
        }
        // Actualizar conteo semanal de coordinador
        if (profsDisponibles.find(p => p.id === profId)?.esCoordinador) {
          coordSesEstaSemana[profId] = (coordSesEstaSemana[profId] || 0) + 1;
        }
        horasAsignadas++;
      } else {
        alertas.push({
          tipo: resultado.razon,
          pacienteId: paciente.id,
          pacienteNombre: `${paciente.nombre} ${paciente.apellido}`,
          disciplina: nec.disciplina,
          msg: resultado.msg
        });
      }
    }

    if (horasAsignadas < HORAS_OBJETIVO_DIA) {
      alertas.push({
        tipo: 'deficit_horas',
        pacienteId: paciente.id,
        pacienteNombre: `${paciente.nombre} ${paciente.apellido}`,
        horasAsignadas,
        horasObjetivo: HORAS_OBJETIVO_DIA,
        msg: `${paciente.nombre} ${paciente.apellido}: ${horasAsignadas}/${HORAS_OBJETIVO_DIA} horas asignadas`
      });
    }
  }

  // Persistir solo si no es una corrida de comparación
  if (persistir) {
    Asignaciones.guardarDia(fecha, sesiones);
    Historial.registrarBulk(fecha, sesiones);
    DiasState.guardar(fecha, { generadoEn: new Date().toISOString() });
    Auditoria.registrar({
      tipo: 'generacion_automatica',
      fecha,
      descripcion: `Agenda generada automáticamente: ${sesiones.length} sesiones, ${alertas.length} alertas`,
      sesionesCount: sesiones.length,
      alertasCount: alertas.length
    });
  }

  const metricas = calcularMetricas(sesiones, todosPacientes);
  return { sesiones, alertas, metricas };
}

// ─── Generación óptima con rotaciones circulares ─────────────────────────────
//
// Identifica el grupo de pacientes con máximo scorePrioridad, genera una agenda
// por cada rotación circular de ese grupo, calcula el índice de calidad de cada
// una y retorna la mejor. Si hay empate exacto retorna los candidatos para que
// el usuario elija; si no hay empate persiste la ganadora directamente.

function generarAgendaOptima(fecha) {
  const todosPacientes = Pacientes.activos();

  if (todosPacientes.length === 0) {
    return { sesiones: [], alertas: [], candidatos: null,
             indice: { score: 100, detallesPacientes: [], urgentesNoCubiertos: 0 } };
  }

  const ordenBase = [...todosPacientes].sort((a, b) =>
    Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a)
  );

  const topScore = Pacientes.scorePrioridad(ordenBase[0]);
  const grupoTop = ordenBase.filter(p => Pacientes.scorePrioridad(p) === topScore);
  const resto    = ordenBase.filter(p => Pacientes.scorePrioridad(p) !== topScore);

  // Sin empate en la cima: una sola corrida, persistir directamente
  if (grupoTop.length <= 1) {
    const resultado = generarAgenda(fecha, { persistir: true });
    const indice    = calcularIndiceCalidad(resultado.sesiones, todosPacientes, fecha);
    return { ...resultado, candidatos: null, indice };
  }

  // Generar N agendas (N = tamaño del grupo top) con rotaciones circulares
  const candidatos = [];
  for (let i = 0; i < grupoTop.length; i++) {
    const ordenRotado = [...grupoTop.slice(i), ...grupoTop.slice(0, i), ...resto];
    const resultado   = generarAgenda(fecha, { ordenOverride: ordenRotado, persistir: false });
    const indice      = calcularIndiceCalidad(resultado.sesiones, todosPacientes, fecha);
    candidatos.push({
      sesiones: resultado.sesiones,
      alertas:  resultado.alertas,
      indice,
      rotacion: i,
      primerPaciente: ordenRotado[0]
    });
  }

  // Ordenar por score descendente; usar total de sesiones como desempate secundario
  candidatos.sort((a, b) =>
    b.indice.score !== a.indice.score
      ? b.indice.score - a.indice.score
      : b.sesiones.length - a.sesiones.length
  );

  const mejorScore = candidatos[0].indice.score;
  // Umbral de 0.05 para considerar un empate real (evita falsos empates por flotantes)
  const empatados  = candidatos.filter(c => Math.abs(c.indice.score - mejorScore) < 0.05);

  // Siempre persistir el candidato ganador (el primero, ya sea único o uno de varios empatados)
  const ganador = empatados[0];
  Asignaciones.guardarDia(fecha, ganador.sesiones);
  Historial.registrarBulk(fecha, ganador.sesiones);
  DiasState.guardar(fecha, { generadoEn: new Date().toISOString() });
  Auditoria.registrar({
    tipo: 'generacion_automatica',
    fecha,
    descripcion: empatados.length > 1
      ? `Agenda generada — ${empatados.length} opciones equivalentes (índice ${ganador.indice.score}%), requiere elección del usuario`
      : `Agenda generada automáticamente — índice de calidad ${ganador.indice.score}%`,
    sesionesCount: ganador.sesiones.length,
    alertasCount:  ganador.alertas.length
  });

  return {
    ...ganador,
    candidatos: empatados.length > 1 ? empatados : null
  };
}

// ─── Generación slot-por-slot (modo "por horario") ───────────────────────────
//
// Alternativa al greedy por paciente: barre cada franja horaria de izquierda a
// derecha y dentro de cada franja asigna primero KTR, luego Kine, luego el resto.
// Refleja la metodología manual: "armar toda la franja de las 9, luego las 10…"

function generarAgendaSlotPorSlot(fecha) {
  const estado         = DiasState.delDia(fecha);
  const todosPacientes = Pacientes.activos();
  const idsExcluidos   = estado.profesionalesExcluidos  || [];
  const profsDisponibles = Profesionales.todos()
    .filter(p => p.activo !== false && !p.esPracticante && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));

  const semana    = limitesDeSemana(fecha);
  const diaActual = _weekday(fecha);

  // ── Estructuras de seguimiento (igual que generarAgenda) ──
  const profSlotsHoy = {};
  profsDisponibles.forEach(p => { profSlotsHoy[p.id] = {}; });

  // Bloqueos coyunturales de profesionales
  const bloqueosProfSlot = estado.bloqueosProfesionales || {};
  for (const profId in bloqueosProfSlot) {
    if (profSlotsHoy[profId]) {
      (bloqueosProfSlot[profId] || []).forEach(b => {
        if (!profSlotsHoy[profId][b.slotId])
          profSlotsHoy[profId][b.slotId] = `BLOQ_PROF:${b.motivo || ''}`;
      });
    }
  }

  const sesionesPrevias = Asignaciones.delDia(fecha);
  const sesionesFijas   = sesionesPrevias.filter(s => s.fijo === true);

  const patientSlots = {};
  todosPacientes.forEach(p => { patientSlots[p.id] = {}; });

  const bloqueos = estado.bloquesPacientes || {};
  for (const pacId in bloqueos) {
    (bloqueos[pacId] || []).forEach(b => {
      if (patientSlots[pacId]) patientSlots[pacId][b.slotId] = `BLOQUEADO:${b.motivo}`;
    });
  }
  todosPacientes.forEach(p => {
    (p.bloqueosPermanentes || []).forEach(b => {
      if (!patientSlots[p.id][b.slotId])
        patientSlots[p.id][b.slotId] = `BLOQ_PERM:${b.motivo}`;
    });
  });
  // Bloquear slots fuera de la ventana de asistencia ambulatoria
  todosPacientes.forEach(p => {
    if (!p.esAmbulatorio || !p.slotIngreso || !p.slotEgreso) return;
    if (!(p.diasAsistencia || []).includes(diaActual)) return;
    const iIng = SLOTS.findIndex(s => s.id === p.slotIngreso);
    const iEgr = SLOTS.findIndex(s => s.id === p.slotEgreso);
    if (iIng < 0 || iEgr < 0) return;
    SLOTS.forEach((s, i) => {
      if (!s.esAlmuerzo && (i < iIng || i > iEgr) && !patientSlots[p.id][s.id])
        patientSlots[p.id][s.id] = 'BLOQ_HORARIO_AMB';
    });
  });

  // Bloquear slot_12 para pacientes que almuerzan sin terapista
  todosPacientes.forEach(p => {
    if (p.almuerza === true && !p.requiereAlmuerzoTerapeutico && !patientSlots[p.id]['slot_12'])
      patientSlots[p.id]['slot_12'] = 'ALMUERZO';
  });

  // Bloquear slots de baño semanal (+ hora anterior/siguiente si corresponde)
  todosPacientes.forEach(p => {
    _aplicarBloqueosBano(patientSlots, p.id, p.bañosSemana, diaActual);
  });

  sesionesFijas.forEach(s => {
    if (patientSlots[s.pacienteId]) patientSlots[s.pacienteId][s.slotId] = s.id;
    if (profSlotsHoy[s.profesionalId]) {
      const ex = profSlotsHoy[s.profesionalId][s.slotId];
      profSlotsHoy[s.profesionalId][s.slotId] = ex ? [ex, s.id] : s.id;
    }
  });

  const todosPorFecha = Asignaciones.todos();
  const coordSesEstaSemana = {};
  profsDisponibles.filter(p => p.esCoordinador).forEach(p => {
    let count = 0;
    for (const f in todosPorFecha) {
      if (f >= semana.inicio && f < fecha)
        count += todosPorFecha[f].filter(s => s.profesionalId === p.id).length;
    }
    coordSesEstaSemana[p.id] = count;
  });

  // ── Calcular necesidades restantes por paciente (conteo por disciplina) ──
  const remainingNeeds  = {};   // { pacId: { disc: count } }
  const sesSemanaMap    = {};   // { pacId: sesión[] }
  const pacientesActivos = [];

  for (const pac of todosPacientes) {
    if (pac.esAmbulatorio) {
      if (!(pac.diasAsistencia || []).includes(diaActual)) continue;
    }
    const fijasDelPac = sesionesFijas.filter(s => s.pacienteId === pac.id);
    if (fijasDelPac.length >= HORAS_OBJETIVO_DIA) continue;

    const plan           = Planes.delPaciente(pac.id);
    const prescripciones = (estado.prescripcionesUrgentes || {})[pac.id] || [];
    const sesSemana      = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);
    sesSemanaMap[pac.id] = sesSemana;
    const conteoSemanal  = {};
    sesSemana.filter(s => s.fecha < fecha)
      .forEach(s => { conteoSemanal[s.disciplina] = (conteoSemanal[s.disciplina] || 0) + 1; });

    const necesidades = construirNecesidades(pac, plan, conteoSemanal, prescripciones, fecha);
    remainingNeeds[pac.id] = {};
    for (const nec of necesidades) {
      remainingNeeds[pac.id][nec.disciplina] = (remainingNeeds[pac.id][nec.disciplina] || 0) + 1;
    }
    // Descontar lo ya cubierto por sesiones fijas
    for (const sf of fijasDelPac) {
      if ((remainingNeeds[pac.id][sf.disciplina] || 0) > 0)
        remainingNeeds[pac.id][sf.disciplina]--;
    }
    pacientesActivos.push(pac);
  }

  const sesiones = [...sesionesFijas];

  // ── Helpers ──
  function _registrar(sesion) {
    sesiones.push(sesion);
    patientSlots[sesion.pacienteId][sesion.slotId] = sesion.id;
    const ex = profSlotsHoy[sesion.profesionalId][sesion.slotId];
    profSlotsHoy[sesion.profesionalId][sesion.slotId] = ex ? [ex, sesion.id] : sesion.id;
    if (profsDisponibles.find(p => p.id === sesion.profesionalId)?.esCoordinador)
      coordSesEstaSemana[sesion.profesionalId] = (coordSesEstaSemana[sesion.profesionalId] || 0) + 1;
    if ((remainingNeeds[sesion.pacienteId][sesion.disciplina] || 0) > 0)
      remainingNeeds[sesion.pacienteId][sesion.disciplina]--;
  }

  function _profDisponibleEnSlot(prof, slot) {
    const horarios = (prof.horariosPorDia || {})[diaActual];
    if (horarios && horarios.length > 0 && !horarios.includes(slot.id)) return false;
    if (prof.esCoordinador) {
      const maxSemana = _totalSlotsSemanales(prof) - 1;
      if ((coordSesEstaSemana[prof.id] || 0) >= maxSemana) return false;
    }
    return true;
  }

  function _mejorPaciente(candidatos, prof, slot, slotIdx, disc) {
    let best = null, bestScore = -Infinity;
    for (const pac of candidatos) {
      const { total } = calcularPuntaje(
        prof, slot, slotIdx, pac, disc, false, false,
        sesiones, profSlotsHoy, sesSemanaMap[pac.id] || []
      );
      if (total > bestScore) { bestScore = total; best = pac; }
    }
    return best;
  }

  // ── Orden de disciplinas dentro de cada franja ──
  const DISC_PRIORIDAD = [
    'kinesiologiaRespiratoria',
    'kinesiologia',
    'fonoaudiologia',
    'terapiaOcupacional',
    'psicologia',
    'neuropsicologia',
    'educacionFisica',
    'ingenieriaBiomedica',
    'odontologia',
    'fisiatria',
    'trabajoSocial',
    'acompananteTerapeutica',
  ];

  // ── Barrido por slot ──
  for (const slot of SLOTS) {
    const slotIdx = SLOTS.findIndex(s => s.id === slot.id);

    // Slot de almuerzo
    if (slot.esAlmuerzo) {
      for (const pac of pacientesActivos) {
        if (!remainingNeeds[pac.id]?.['_almuerzo']) continue;
        if (patientSlots[pac.id][slot.id]) continue;
        const discsAlm = pac.disciplinasAlmuerzo?.length
          ? pac.disciplinasAlmuerzo : ['fonoaudiologia', 'terapiaOcupacional'];
        let bestProf = null, bestScore = -Infinity;
        for (const prof of profsDisponibles) {
          if (!discsAlm.some(d => (prof.disciplinas || []).includes(d))) continue;
          if (profSlotsHoy[prof.id][slot.id]) continue;
          if (!_profDisponibleEnSlot(prof, slot)) continue;
          if (!_profEnTurno(estado, prof.id, slot.turno, fecha)) continue;
          const { total } = calcularPuntaje(
            prof, slot, slotIdx, pac, '_almuerzo', true, false,
            sesiones, profSlotsHoy, sesSemanaMap[pac.id] || []
          );
          if (total > bestScore) { bestScore = total; bestProf = prof; }
        }
        if (!bestProf) continue;
        _registrar({
          id: genId(), fecha, pacienteId: pac.id, profesionalId: bestProf.id,
          disciplina: '_almuerzo', slotId: slot.id, inicio: slot.inicio, fin: slot.fin,
          esAlmuerzo: true, origen: 'automatico_horario', puntaje: bestScore,
          urgente: false, creadoEn: new Date().toISOString()
        });
      }
      continue;
    }

    // Higiene matutina forzada a slot_09
    if (slot.id === 'slot_09') {
      for (const pac of pacientesActivos) {
        if (!pac.requiereHigiene || !pac.disciplinaHigiene) continue;
        if (patientSlots[pac.id][slot.id]) continue;
        if (!(remainingNeeds[pac.id]?.[pac.disciplinaHigiene] > 0)) continue;
        const disc = pac.disciplinaHigiene;
        let bestProf = null, bestScore = -Infinity;
        for (const prof of profsDisponibles) {
          if (!(prof.disciplinas || []).includes(disc)) continue;
          if (profSlotsHoy[prof.id][slot.id]) continue;
          if (!_profDisponibleEnSlot(prof, slot)) continue;
          if (!_profEnTurno(estado, prof.id, slot.turno, fecha)) continue;
          const { total } = calcularPuntaje(
            prof, slot, 0, pac, disc, false, false,
            sesiones, profSlotsHoy, sesSemanaMap[pac.id] || []
          );
          if (total > bestScore) { bestScore = total; bestProf = prof; }
        }
        if (!bestProf) continue;
        _registrar({
          id: genId(), fecha, pacienteId: pac.id, profesionalId: bestProf.id,
          disciplina: disc, slotId: slot.id, inicio: slot.inicio, fin: slot.fin,
          esAlmuerzo: false, origen: 'automatico_horario', puntaje: bestScore,
          urgente: false, creadoEn: new Date().toISOString()
        });
      }
    }

    // Disciplinas en orden de prioridad
    for (const disc of DISC_PRIORIDAD) {
      const profsSlot = profsDisponibles.filter(prof => {
        if (!(prof.disciplinas || []).includes(disc)) return false;
        if (!_profDisponibleEnSlot(prof, slot)) return false;
        if (!_profEnTurno(estado, prof.id, slot.turno, fecha)) return false;
        const status = profSlotsHoy[prof.id]?.[slot.id];
        if (!status) return true;
        // KTR dual: admitir si el profesional solo tiene una sesión (no array)
        if (disc === 'kinesiologiaRespiratoria' && !Array.isArray(status)) return true;
        return false;
      });

      for (const prof of profsSlot) {
        const isKtrDual = disc === 'kinesiologiaRespiratoria' && !!profSlotsHoy[prof.id][slot.id];
        const candidatos = pacientesActivos.filter(pac => {
          if (!(remainingNeeds[pac.id]?.[disc] > 0)) return false;
          if (patientSlots[pac.id][slot.id]) return false;
          if (prof.grupoExclusivo && pac.grupo !== prof.grupoExclusivo) return false;
          if (isKtrDual) {
            if (pac.bloqueaKTR) return false;
            const sesExist = sesiones.find(s => s.id === profSlotsHoy[prof.id][slot.id]);
            if (!sesExist) return false;
            const pacExist = Pacientes.porId(sesExist.pacienteId);
            if (!pacExist || pacExist.bloqueaKTR) return false;
            if (!pac.edificio || pac.edificio !== pacExist.edificio) return false;
          }
          return true;
        });
        if (candidatos.length === 0) continue;
        const pac = _mejorPaciente(candidatos, prof, slot, slotIdx, disc);
        if (!pac) continue;
        _registrar({
          id: genId(), fecha, pacienteId: pac.id, profesionalId: prof.id,
          disciplina: disc, slotId: slot.id, inicio: slot.inicio, fin: slot.fin,
          esAlmuerzo: false, origen: 'automatico_horario', puntaje: 0,
          urgente: false, creadoEn: new Date().toISOString()
        });
      }
    }
  }

  Asignaciones.guardarDia(fecha, sesiones);
  Historial.registrarBulk(fecha, sesiones);
  DiasState.guardar(fecha, { generadoEn: new Date().toISOString() });
  Auditoria.registrar({
    tipo: 'generacion_automatica_horario',
    fecha,
    descripcion: `Agenda generada por horario: ${sesiones.length} sesiones`,
    sesionesCount: sesiones.length,
    alertasCount: 0
  });

  const metricas = calcularMetricas(sesiones, todosPacientes);
  return { sesiones, alertas: [], metricas };
}

// ─── Mejora local (post-greedy) ───────────────────────────────────────────────
//
// Toma la agenda ya generada y trata de cubrir necesidades no satisfechas
// mediante dos movimientos:
//   1. Asignación directa: un profesional quedó libre en algún slot posterior
//   2. Swap: se mueve una sesión existente a otro slot para liberar espacio
//
// Hasta MAX_ITER pasadas o hasta que no haya más mejoras.

function mejoraLocal(fecha) {
  const sesiones = [...Asignaciones.delDia(fecha)];
  if (!sesiones.length) return { sesionesAgregadas: 0, swapsRealizados: 0, detalles: [] };

  const estado    = DiasState.delDia(fecha);
  const idsExcluidos = estado.profesionalesExcluidos  || [];
  const profsDisponibles = Profesionales.todos()
    .filter(p => p.activo !== false && !p.esPracticante && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));
  const todosPacientes = Pacientes.activos();
  const semana = limitesDeSemana(fecha);

  // ── Reconstruir profSlotsHoy y patientSlots desde las sesiones actuales ──
  function reconstruirMaps(ss) {
    const profSlotsHoy  = {};
    const patientSlots  = {};
    profsDisponibles.forEach(p => { profSlotsHoy[p.id]  = {}; });
    todosPacientes.forEach(p =>  { patientSlots[p.id] = {}; });

    // Bloqueos del día (DiasState)
    const bloqueos = estado.bloquesPacientes || {};
    for (const pacId in bloqueos) {
      if (patientSlots[pacId]) {
        (bloqueos[pacId] || []).forEach(b => {
          patientSlots[pacId][b.slotId] = `BLOQUEADO:${b.motivo}`;
        });
      }
    }
    // Bloqueos permanentes del perfil
    todosPacientes.forEach(p => {
      (p.bloqueosPermanentes || []).forEach(b => {
        if (patientSlots[p.id] && !patientSlots[p.id][b.slotId])
          patientSlots[p.id][b.slotId] = `BLOQ_PERM:${b.motivo}`;
      });
    });
    // Bloqueos coyunturales de profesionales
    const _bloqProf = estado.bloqueosProfesionales || {};
    for (const profId in _bloqProf) {
      if (profSlotsHoy[profId]) {
        (_bloqProf[profId] || []).forEach(b => {
          if (!profSlotsHoy[profId][b.slotId])
            profSlotsHoy[profId][b.slotId] = `BLOQ_PROF:${b.motivo || ''}`;
        });
      }
    }
    // Bloquear slots fuera de la ventana de asistencia ambulatoria
    const _diaActual = _weekday(fecha);
    todosPacientes.forEach(p => {
      if (!p.esAmbulatorio || !p.slotIngreso || !p.slotEgreso) return;
      if (!(p.diasAsistencia || []).includes(_diaActual)) return;
      const iIng = SLOTS.findIndex(s => s.id === p.slotIngreso);
      const iEgr = SLOTS.findIndex(s => s.id === p.slotEgreso);
      if (iIng < 0 || iEgr < 0) return;
      SLOTS.forEach((s, i) => {
        if (!s.esAlmuerzo && (i < iIng || i > iEgr) && !patientSlots[p.id][s.id])
          patientSlots[p.id][s.id] = 'BLOQ_HORARIO_AMB';
      });
    });

    // Bloquear slot_12 para pacientes que almuerzan sin terapista
    todosPacientes.forEach(p => {
      if (p.almuerza === true && !p.requiereAlmuerzoTerapeutico && !patientSlots[p.id]['slot_12'])
        patientSlots[p.id]['slot_12'] = 'ALMUERZO';
    });

    // Bloquear slots de baño semanal (+ hora anterior/siguiente si corresponde)
    todosPacientes.forEach(p => {
      _aplicarBloqueosBano(patientSlots, p.id, p.bañosSemana, _diaActual);
    });

    ss.forEach(s => {
      if (patientSlots[s.pacienteId])  patientSlots[s.pacienteId][s.slotId]   = s.id;
      if (profSlotsHoy[s.profesionalId]) {
        const existing = profSlotsHoy[s.profesionalId][s.slotId];
        profSlotsHoy[s.profesionalId][s.slotId] = existing
          ? [existing, s.id] : s.id;
      }
    });
    return { profSlotsHoy, patientSlots };
  }

  // ── Necesidades aún no cubiertas para un paciente ──
  function necesidadesPendientes(pac, ss) {
    const plan = Planes.delPaciente(pac.id);
    const prescripciones = (estado.prescripcionesUrgentes || {})[pac.id] || [];

    // Conteo semanal solo de días anteriores a hoy (mismo criterio que el greedy)
    const sessSemana = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);
    const conteoSemanal = {};
    sessSemana.filter(s => s.fecha < fecha).forEach(s => {
      conteoSemanal[s.disciplina] = (conteoSemanal[s.disciplina] || 0) + 1;
    });

    const todasNecs = construirNecesidades(pac, plan, conteoSemanal, prescripciones, fecha);

    // Restar lo ya asignado hoy
    const asignadasHoy = {};
    ss.filter(s => s.pacienteId === pac.id).forEach(s => {
      asignadasHoy[s.disciplina] = (asignadasHoy[s.disciplina] || 0) + 1;
    });

    const cuentas = { ...asignadasHoy };
    const pendientes = [];
    for (const nec of todasNecs) {
      if ((cuentas[nec.disciplina] || 0) > 0) {
        cuentas[nec.disciplina]--;
      } else {
        pendientes.push(nec);
      }
    }
    return pendientes;
  }

  let sesionesAgregadas = 0;
  let swapsRealizados   = 0;
  const detalles        = [];

  const pacientesOrdenados = [...todosPacientes].sort(
    (a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a)
  );

  const MAX_ITER = 3;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let cambio = false;

    for (const pac of pacientesOrdenados) {
      const pendientes = necesidadesPendientes(pac, sesiones);
      if (!pendientes.length) continue;

      for (const nec of pendientes) {
        const { profSlotsHoy, patientSlots } = reconstruirMaps(sesiones);
        const sessSemana = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);

        // ── Movimiento 1: asignación directa ──────────────────────────────
        const resultado = intentarAsignar(
          nec, pac, sesiones, profSlotsHoy, patientSlots, profsDisponibles, fecha, sessSemana
        );

        if (resultado.ok) {
          sesiones.push(resultado.sesion);
          sesionesAgregadas++;
          cambio = true;
          detalles.push(`✓ ${discLabel(nec.disciplina)} → ${pac.nombre} ${pac.apellido}`);
          break;
        }

        // ── Movimiento 2: swap ────────────────────────────────────────────
        // Buscar un profesional con la disciplina que esté ocupado en un slot
        // que podríamos usar para este paciente, y que pueda moverse a otro slot.
        const profsConDisc = profsDisponibles.filter(
          p => (p.disciplinas || []).includes(nec.disciplina)
        );

        let swapEncontrado = false;
        for (const prof of profsConDisc) {
          if (swapEncontrado) break;

          const sesDelProf = sesiones.filter(
            s => s.profesionalId === prof.id && !s.esAlmuerzo
          );

          const diaNumSwap = _weekday(fecha);

          for (const sesObstáculo of sesDelProf) {
            if (swapEncontrado) break;

            // ¿El slot bloqueado por esta sesión está disponible para nuestro paciente?
            if (patientSlots[pac.id]?.[sesObstáculo.slotId]) continue;

            // El prof debe poder atender a pac en el slot liberado (grupoExclusivo)
            if (prof.grupoExclusivo && pac.grupo !== prof.grupoExclusivo) continue;

            // El prof debe estar presente en el turno del slot liberado
            const slotLiberadoDef = SLOTS.find(s => s.id === sesObstáculo.slotId);
            if (!slotLiberadoDef) continue;
            if (!_profEnTurno(estado, prof.id, slotLiberadoDef.turno, fecha)) continue;

            // Buscar un nuevo slot al que mover la sesión obstáculo
            const pacDonor = Pacientes.porId(sesObstáculo.pacienteId);
            if (!pacDonor) continue;

            for (const nuevoSlot of SLOTS) {
              if (nuevoSlot.esAlmuerzo) continue;
              if (nuevoSlot.id === sesObstáculo.slotId) continue;
              if (profSlotsHoy[prof.id]?.[nuevoSlot.id]) continue;        // prof ocupado ahí
              if (patientSlots[pacDonor.id]?.[nuevoSlot.id]) continue;    // donor ocupado/bloqueado

              // Verificar que el prof puede trabajar en el turno del nuevo slot
              if (!_profEnTurno(estado, prof.id, nuevoSlot.turno, fecha)) continue;

              // Verificar horario específico del prof en el nuevo slot
              const horariosProf = (prof.horariosPorDia || {})[diaNumSwap];
              if (horariosProf && horariosProf.length > 0 && !horariosProf.includes(nuevoSlot.id)) continue;

              // ¡Swap válido!
              const idxObs = sesiones.findIndex(s => s.id === sesObstáculo.id);
              if (idxObs < 0) continue;

              // Mover la sesión obstáculo al nuevo slot
              sesiones[idxObs] = {
                ...sesiones[idxObs],
                slotId:  nuevoSlot.id,
                inicio:  nuevoSlot.inicio,
                fin:     nuevoSlot.fin,
                origen:  'automatico_mejora'
              };

              // Asignar al profesional con nuestro paciente en el slot liberado
              sesiones.push({
                id:            genId(),
                fecha,
                pacienteId:    pac.id,
                profesionalId: prof.id,
                disciplina:    nec.disciplina,
                slotId:        slotLiberadoDef.id,
                inicio:        slotLiberadoDef.inicio,
                fin:           slotLiberadoDef.fin,
                esAlmuerzo:    false,
                origen:        'automatico_mejora',
                puntaje:       0,
                motivo:        `Mejora local — swap con ${pacDonor.nombre} ${pacDonor.apellido}`,
                urgente:       false,
                creadoEn:      new Date().toISOString()
              });

              swapsRealizados++;
              sesionesAgregadas++;
              cambio = true;
              swapEncontrado = true;
              detalles.push(
                `↕ swap (${pacDonor.apellido} ${slotLiberadoDef.label}→${nuevoSlot.label}) ` +
                `+ ${discLabel(nec.disciplina)} → ${pac.nombre} ${pac.apellido}`
              );
              break;
            }
          }
        }

        if (swapEncontrado) break;
      }
    }

    if (!cambio) break;
  }

  if (sesionesAgregadas > 0) {
    Asignaciones.guardarDia(fecha, sesiones);
    Auditoria.registrar({
      tipo:        'mejora_local',
      fecha,
      descripcion: `Mejora local: +${sesionesAgregadas} sesión(es), ${swapsRealizados} swap(s)`,
      detalles
    });
  }

  return { sesionesAgregadas, swapsRealizados, detalles };
}

// ─── Métricas ─────────────────────────────────────────────────────────────────

function calcularMetricas(sesiones, pacientes) {
  const porPaciente = {};
  const porProfesional = {};

  pacientes.forEach(p => {
    const mis = sesiones.filter(s => s.pacienteId === p.id);
    porPaciente[p.id] = {
      horasAsignadas: mis.length,
      horasObjetivo: HORAS_OBJETIVO_DIA,
      pct: Math.round(mis.length / HORAS_OBJETIVO_DIA * 100),
      disciplinas: [...new Set(mis.map(s => s.disciplina))]
    };
  });

  Profesionales.todos().forEach(p => {
    const sus = sesiones.filter(s => s.profesionalId === p.id);
    porProfesional[p.id] = {
      sesiones: sus.length,
      maxPosible: SLOTS.length,
      pct: Math.round(sus.length / SLOTS.length * 100),
      pacientesAtendidos: [...new Set(sus.map(s => s.pacienteId))].length
    };
  });

  return { porPaciente, porProfesional };
}
