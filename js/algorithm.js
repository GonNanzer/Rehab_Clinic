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

// Ventana de ingreso/egreso de un paciente ambulatorio para un día de la
// semana (1=Lun…6=Sáb, 0=Dom) — puede variar según el día.
function _horarioAmbulatorioDia(p, dia) {
  return (p.horarioAmbulatorioPorDia || {})[dia] || null;
}

// Ventana de un ambulatorio ese día como índices de SLOTS ({ iIng, iEgr }), o
// null si no asiste ese día o no tiene horario definido. Dentro de la ventana
// TODOS los slots libres deben tener sesión (el 12 y el 13 incluidos).
function _ventanaAmbulatoria(p, dia) {
  if (!p.esAmbulatorio) return null;
  if (!(p.diasAsistencia || []).includes(dia)) return null;
  const horario = _horarioAmbulatorioDia(p, dia);
  if (!horario || !horario.slotIngreso || !horario.slotEgreso) return null;
  const iIng = SLOTS.findIndex(s => s.id === horario.slotIngreso);
  const iEgr = SLOTS.findIndex(s => s.id === horario.slotEgreso);
  if (iIng < 0 || iEgr < 0 || iEgr < iIng) return null;
  return { iIng, iEgr };
}

// ¿Se le puede asignar sesiones a este paciente ese día? Un ambulatorio solo si
// asiste ese día Y tiene horario de ingreso/egreso definido: sin ventana no se
// sabe cuándo está en la institución, así que no se le asigna nada automático
// (la verificación previa y la grilla lo avisan).
function _pacienteAsignableAuto(pac, dia) {
  return !pac.esAmbulatorio || !!_ventanaAmbulatoria(pac, dia);
}

// Motivo (texto) por el que ese slot cae FUERA del horario de asistencia de un
// ambulatorio ese día, o null si está dentro (o el paciente no es ambulatorio).
// Es la validación común de TODA asignación o movimiento de sesión.
function _motivoFueraDeHorarioAmbulatorio(pac, fecha, slotId) {
  if (!pac || !pac.esAmbulatorio) return null;
  const dia = _weekday(fecha);
  const nombre = `${pac.apellido}, ${pac.nombre}`;
  if (!(pac.diasAsistencia || []).includes(dia))
    return `${nombre} es ambulatorio y no asiste ese día`;
  const v = _ventanaAmbulatoria(pac, dia);
  if (!v) return `${nombre} es ambulatorio y no tiene horario de ingreso/egreso definido para ese día`;
  const i = SLOTS.findIndex(s => s.id === slotId);
  if (i < v.iIng || i > v.iEgr)
    return `${nombre} es ambulatorio y asiste de ${SLOTS[v.iIng].inicio} a ${SLOTS[v.iEgr].fin}: ese horario queda fuera`;
  return null;
}

// Marca como 'BLOQ_HORARIO_AMB' los slots fuera de la ventana de cada
// ambulatorio que asiste ese día (aplica a todos los slots, incluido el 12).
function _aplicarVentanaAmbulatoria(patientSlots, pacientes, dia) {
  pacientes.forEach(p => {
    const v = _ventanaAmbulatoria(p, dia);
    if (!v || !patientSlots[p.id]) return;
    SLOTS.forEach((s, i) => {
      if ((i < v.iIng || i > v.iEgr) && !patientSlots[p.id][s.id])
        patientSlots[p.id][s.id] = 'BLOQ_HORARIO_AMB';
    });
  });
}

// El 12:00 es horario común para ambulatorios. Para un internado que almuerza
// en la institución "sin terapista" no se le asigna sesión automáticamente (el
// profesional queda libre para quien sí lo necesita), pero el operario puede
// asignarlo a mano. Los que requieren almuerzo terapéutico lo tienen reservado.
function _esSlotExcluidoDeAuto(pac, slot) {
  if (!slot || !slot.esAlmuerzo) return false;
  if (pac.requiereAlmuerzoTerapeutico) return true;
  return !pac.esAmbulatorio && (pac.almuerza ?? true);
}

// Slots que el perfil del paciente bloquea ese día (bloqueos del día,
// permanentes y baño), sin considerar sesiones ni ventana ambulatoria.
function _slotsBloqueadosPaciente(pac, estado, dia) {
  const tmp = { [pac.id]: {} };
  ((estado.bloquesPacientes || {})[pac.id] || []).forEach(b => { tmp[pac.id][b.slotId] = 'BLOQUEADO'; });
  (pac.bloqueosPermanentes || []).forEach(b => { if (!tmp[pac.id][b.slotId]) tmp[pac.id][b.slotId] = 'BLOQ_PERM'; });
  _aplicarBloqueosBano(tmp, pac.id, pac.bañosSemana, dia);
  return tmp[pac.id];
}

// Cantidad de sesiones que el paciente debe tener ese día. Un ambulatorio
// presente necesita una por cada slot libre de su ventana; el resto, el objetivo fijo.
function _horasObjetivoPaciente(pac, estado, dia) {
  const v = _ventanaAmbulatoria(pac, dia);
  if (!v) return HORAS_OBJETIVO_DIA;
  const bloq = _slotsBloqueadosPaciente(pac, estado, dia);
  let n = 0;
  for (let i = v.iIng; i <= v.iEgr; i++) if (!bloq[SLOTS[i].id]) n++;
  return n;
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

// Rutinas con disciplina "por prioridad" (higiene, almuerzo): dada una lista
// ordenada de disciplinas preferidas, devuelve la primera que tenga al menos
// un profesional disponible para ese turno/horario. Si la lista está vacía
// ("-elegir-"), devuelve null = sin restricción (cualquier disciplina sirve).
// Si ninguna de las preferidas tiene profesional disponible, devuelve igual
// la primera (para que el intento de asignación falle más abajo con un
// mensaje claro, en vez de saltarse la prioridad silenciosamente).
function _discPrioritariaDisponible(discsPrioridad, profsDisponibles, estadoDia, slot, fecha) {
  if (!discsPrioridad || discsPrioridad.length === 0) return null;
  for (const disc of discsPrioridad) {
    const hayDisponible = profsDisponibles.some(p =>
      (p.disciplinas || []).includes(disc) && _disponibilidadProfSlot(p, estadoDia, slot, fecha).ok
    );
    if (hayDisponible) return disc;
  }
  return discsPrioridad[0];
}

// Restricción dura: una disciplina no puede repetirse en dos slots
// consecutivos para el mismo paciente (ni con la sesión anterior ni con la
// siguiente). Se compara por índice en SLOTS, así que el slot de almuerzo
// (que tiene disciplina '_almuerzo' y nunca coincide con una disciplina
// real) separa naturalmente a la mañana de la tarde.
function _generaConsecutividad(pacienteId, disciplina, slotIdx, sesionesActuales) {
  const prevSlot = SLOTS[slotIdx - 1];
  const nextSlot = SLOTS[slotIdx + 1];
  const mismaDisc = s => s.pacienteId === pacienteId && s.disciplina === disciplina;
  if (prevSlot && sesionesActuales.some(s => s.slotId === prevSlot.id && mismaDisc(s))) return true;
  if (nextSlot && sesionesActuales.some(s => s.slotId === nextSlot.id && mismaDisc(s))) return true;
  return false;
}

// ─── Construcción de necesidades ─────────────────────────────────────────────

/*
 * Devuelve una lista de "necesidades" para el paciente en el día dado.
 * Cada ítem es: { tipo, disciplina, esAlmuerzo, slotForzado, urgente, motivoUrgente, prioridad, profesionalId? }
 */
function construirNecesidades(paciente, plan, conteoSemanal, prescripcionesUrgentes, fecha, horasObjetivo = HORAS_OBJETIVO_DIA) {
  const necesidades = [];

  // 0. Rutina de higiene matutina: reserva slot 09:00
  // disciplina va con sentinel '_higiene' (igual que el almuerzo con '_almuerzo');
  // la disciplina real la decide intentarAsignar según discsPrioridad ([] = cualquiera).
  if (paciente.requiereHigiene) {
    necesidades.push({
      tipo: 'higiene', disciplina: '_higiene', discsPrioridad: paciente.disciplinasHigiene || [],
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

  // 2. Prescripciones urgentes del día / Asignaciones necesarias
  (prescripcionesUrgentes || []).forEach(p => {
    for (let i = 0; i < (p.veces || 1); i++) {
      const nec = {
        tipo: 'urgente', disciplina: p.disciplina,
        esAlmuerzo: false, urgente: true,
        motivoUrgente: p.motivo, prioridad: 9
      };
      if (p.profesionalId) nec.profesionalId = p.profesionalId;
      necesidades.push(nec);
    }
  });

  // 3. Sesiones regulares basadas en plan semanal
  const horasYaOcupadas = necesidades.length;
  let horasPorCubrir = horasObjetivo - horasYaOcupadas;
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
    // Con una sola KTR diaria → inicio de mañana (slot_08, idx 0).
    // Con dos o más → la primera en slot_08, la siguiente en inicio de tarde (slot_14, idx 5).
    // Índices SLOTS: 0=08h 1=09h 2=10h 3=11h 4=12h 5=13h 6=14h 7=15h 8=16h 9=17h 10=18h
    if (disciplina === 'kinesiologiaRespiratoria') {
      const ktrHoy = sesionesActuales.filter(
        s => s.pacienteId === paciente.id && s.disciplina === 'kinesiologiaRespiratoria'
      ).length;
      const bonusKtr = ktrHoy === 0
        ? [30, 12, 5, 0, 0, 0, 0,  0,  0, 0, 0][slotIdx] || 0   // primera: inicio turno mañana
        : [0,  0,  0, 0, 0, 0, 30, 12, 5, 2, 0][slotIdx] || 0;  // siguiente: inicio turno tarde
      if (bonusKtr > 0) {
        total += bonusKtr;
        motivos.push(`KTR inicio de turno ${ktrHoy === 0 ? 'mañana' : 'tarde'} +${bonusKtr}`);
      }
    } else {
      // Curvas simétricas por turno: cada disciplina tiene su pico tanto a la
      // mañana como a la tarde, en el orden ideal del recorrido del paciente
      // (kinesiología primero para activar el cuerpo, después TO, después
      // fono, y neuropsicología/psicología más tarde en el turno).
      const SLOT_ORDER_BONUS = {
        kinesiologia:       [9, 6, 3, 0, 0, 0,  9, 6, 3, 0, 0],
        terapiaOcupacional: [3, 9, 6, 0, 0, 0,  3, 9, 6, 3, 0],
        fonoaudiologia:     [0, 3, 9, 6, 0, 0,  0, 3, 9, 6, 3],
        neuropsicologia:    [0, 0, 3, 9, 0, 0,  0, 0, 3, 9, 6],
        psicologia:         [0, 0, 3, 9, 0, 0,  0, 0, 3, 9, 6]
      };
      const orderBonus = (SLOT_ORDER_BONUS[disciplina] || [])[slotIdx] || 0;
      if (orderBonus > 0) {
        total += orderBonus;
        motivos.push(`Orden preferido de terapia +${orderBonus}`);
      }
    }

    // Evitar acumular la misma disciplina en un solo turno: si el paciente ya
    // tiene esta disciplina hoy en el mismo turno (mañana/tarde) que el slot
    // candidato, penalizar para empujar la siguiente sesión hacia el otro
    // turno (ej.: kinesiología una vez a la mañana y otra a la tarde).
    const yaEnEsteTurno = sesionesActuales.some(s => {
      if (s.pacienteId !== paciente.id || s.disciplina !== disciplina) return false;
      const slotSes = SLOTS.find(sl => sl.id === s.slotId);
      return slotSes && slotSes.turno === slot.turno;
    });
    if (yaEnEsteTurno) {
      total -= 40;
      motivos.push(`Ya tiene ${disciplina} en el turno ${slot.turno} — mejor el otro turno`);
    }

    // Variar profesional entre sesiones de la misma disciplina el mismo día
    // (ej.: kinesiología a la mañana y a la tarde con distinto kinesiólogo).
    // No aplica si este profesional es el referente del paciente en esa
    // disciplina: ahí sí conviene que sea siempre el mismo.
    if (!esReferente) {
      const mismoProfMismaDisc = sesionesActuales.some(s =>
        s.pacienteId === paciente.id && s.disciplina === disciplina && s.profesionalId === prof.id
      );
      if (mismoProfMismaDisc) {
        total -= 50;
        motivos.push(`${Profesionales.iniciales(prof)} ya atendió ${disciplina} hoy — variar profesional`);
      }
    }
  }

  // La repetición de disciplina en slots consecutivos ahora es una restricción
  // dura (ver _generaConsecutividad), aplicada antes de llegar a este cálculo
  // de puntaje — por eso ya no hace falta penalizarla acá.

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
  // ctx.relajar: { consecutividad, limites, grupo, exclusiones } — restricciones que
  //   pueden ceder SOLO para completar la ventana de un ambulatorio (ver _completarVentanaAmbulatoria).
  const relajar = ctx.relajar || {};
  const { disciplina, esAlmuerzo, slotForzado, urgente, discsPrioridad } = necesidad;
  const esHigiene = necesidad.tipo === 'higiene';
  const estadoDia = DiasState.delDia(fecha);

  // Ambulatorio: nunca fuera de su día / horario de asistencia (guarda común a todos los caminos automáticos)
  if (!_pacienteAsignableAuto(paciente, _weekday(fecha)))
    return { ok: false, razon: 'ambulatorio_fuera_de_horario', msg: 'Ambulatorio sin asistencia o sin horario definido ese día' };

  // Verificar límite diario por disciplina (las prescripciones urgentes lo omiten)
  if (!esAlmuerzo && !urgente && !relajar.limites) {
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
    candidatos = SLOTS.filter(s => s.id === slotForzado && !patientSlots[paciente.id][s.id]
      && !_motivoFueraDeHorarioAmbulatorio(paciente, fecha, s.id));
    // Relleno de hueco / cierre de ventana: respeta la no repetición de disciplina
    // en slots consecutivos (salvo que se la ceda explícitamente)
    if ((necesidad.tipo === 'relleno_hueco' || necesidad.tipo === 'cierre_ventana') && !relajar.consecutividad) {
      candidatos = candidatos.filter(s =>
        !_generaConsecutividad(paciente.id, disciplina, SLOTS.findIndex(sl => sl.id === s.id), sesionesActuales));
    }
  } else {
    candidatos = SLOTS.filter(s => {
      if (patientSlots[paciente.id][s.id]) return false;     // ocupado o bloqueado
      if (_motivoFueraDeHorarioAmbulatorio(paciente, fecha, s.id)) return false; // fuera del horario de asistencia
      if (esAlmuerzo) return s.esAlmuerzo;
      if (_esSlotExcluidoDeAuto(paciente, s)) return false;  // 12:00: almuerzo reservado / sin terapista
      const idx = SLOTS.findIndex(sl => sl.id === s.id);
      if (!relajar.consecutividad && _generaConsecutividad(paciente.id, disciplina, idx, sesionesActuales)) return false;
      return true;
    });
  }

  if (candidatos.length === 0) {
    return { ok: false, razon: 'sin_slot', msg: 'No hay slots disponibles' };
  }

  const excluidoPorPaciente = p => !relajar.exclusiones && (paciente.exclusionesProfesionales || []).includes(p.id);

  let mejorPuntaje = -Infinity;
  let mejorAsignacion = null;

  for (const slot of candidatos) {
    const slotIdx = SLOTS.findIndex(s => s.id === slot.id);

    // Filtrar profesionales válidos para este slot
    // (_disponibilidadProfSlot cubre presencia del día, horario habitual / rango del día y bloqueos)
    let profsValidos;
    if (esAlmuerzo) {
      const discElegidaAlm = _discPrioritariaDisponible(
        paciente.disciplinasAlmuerzo?.length ? paciente.disciplinasAlmuerzo : DISCIPLINAS_ALMUERZO_DEFAULT,
        profsDisponibles, estadoDia, slot, fecha
      );
      profsValidos = profsDisponibles.filter(p => {
        if (excluidoPorPaciente(p)) return false;
        if (!_disponibilidadProfSlot(p, estadoDia, slot, fecha).ok) return false;
        if (discElegidaAlm && !(p.disciplinas || []).includes(discElegidaAlm)) return false;
        return !profSlotsHoy[p.id]?.[slot.id];
      });
    } else if (esHigiene) {
      const discElegidaHig = _discPrioritariaDisponible(
        discsPrioridad, profsDisponibles, estadoDia, slot, fecha
      );
      profsValidos = profsDisponibles.filter(p => {
        if (excluidoPorPaciente(p)) return false;
        if (!_disponibilidadProfSlot(p, estadoDia, slot, fecha).ok) return false;
        if (discElegidaHig && !(p.disciplinas || []).includes(discElegidaHig)) return false;
        return !profSlotsHoy[p.id]?.[slot.id];
      });
    } else {
      profsValidos = profsDisponibles.filter(p => {
        if (necesidad.profesionalId && p.id !== necesidad.profesionalId) return false;
        if (excluidoPorPaciente(p)) return false;
        if (!_disponibilidadProfSlot(p, estadoDia, slot, fecha).ok) return false;
        if (!(p.disciplinas || []).includes(disciplina)) return false;
        // Grupo exclusivo: el profesional solo atiende su grupo asignado
        if (!relajar.grupo && p.grupoExclusivo && paciente.grupo !== p.grupoExclusivo) return false;
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
          if (!sesExistente || sesExistente.disciplina !== 'kinesiologiaRespiratoria') return false;
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
  const motivos = [...mejorAsignacion.motivos];
  const cedidas = Object.keys(relajar).filter(k => relajar[k]);
  if (cedidas.length) motivos.push(`Cierre de ventana ambulatoria (cede: ${cedidas.join(', ')})`);

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
      motivo:         motivos.join(' · '),
      urgente:        !!urgente,
      creadoEn:       new Date().toISOString()
    }
  };
}

// Registra una sesión recién creada en los mapas de carga del día (profesional
// y paciente) y en la cuota semanal de coordinadores. KTR dual: un mismo
// profesional puede tener dos sesiones en el slot.
function _registrarSesionEnMapas(sesion, sesiones, profSlotsHoy, patientSlots, profsDisponibles, ctx = {}) {
  sesiones.push(sesion);
  patientSlots[sesion.pacienteId][sesion.slotId] = sesion.id;
  if (!profSlotsHoy[sesion.profesionalId]) profSlotsHoy[sesion.profesionalId] = {};
  const existing = profSlotsHoy[sesion.profesionalId][sesion.slotId];
  profSlotsHoy[sesion.profesionalId][sesion.slotId] = existing ? [existing, sesion.id] : sesion.id;
  if (ctx.coordSesEstaSemana && profsDisponibles.find(p => p.id === sesion.profesionalId)?.esCoordinador) {
    ctx.coordSesEstaSemana[sesion.profesionalId] = (ctx.coordSesEstaSemana[sesion.profesionalId] || 0) + 1;
  }
}

// ─── Cierre de ventana de pacientes ambulatorios ──────────────────────────────
//
// Un ambulatorio presente no puede tener un slot libre dentro de su ventana.
// Esto se garantiza por construcción: los ambulatorios se asignan primero, con
// una cantidad de necesidades igual a su ventana, y este paso cierra los slots
// que hayan quedado sin cubrir:
//   1. Asigna una disciplina del plan (nunca fuera del plan) con un profesional
//      libre, cediendo —solo si hace falta y en este orden— la no repetición
//      consecutiva, los límites diarios, el grupo exclusivo y las exclusiones.
//   2. Si no hay profesional libre, reubica la sesión de otro paciente (la
//      reasigna a otro profesional libre o la mueve a otro slot) para liberar
//      a un profesional de una disciplina del plan.
// Devuelve los slots que no pudo cubrir (solo ocurre ante datos de carga inconsistentes).

const _TIERS_CESION = [
  {},
  { consecutividad: true },
  { consecutividad: true, limites: true },
  { consecutividad: true, limites: true, grupo: true },
  { consecutividad: true, limites: true, grupo: true, exclusiones: true }
];

function _completarVentanaAmbulatoria(pac, sesiones, profSlotsHoy, patientSlots, profsDisponibles, fecha, sesionesEstaSemana, ctx = {}) {
  const dia = _weekday(fecha);
  const v = _ventanaAmbulatoria(pac, dia);
  if (!v) return [];
  const plan = Planes.delPaciente(pac.id);
  const discs = _discsPlanOrdenadasPorDeficit(pac, plan, fecha);
  const sinCubrir = [];

  for (let i = v.iIng; i <= v.iEgr; i++) {
    const slot = SLOTS[i];
    if (patientSlots[pac.id][slot.id]) continue; // ocupado o bloqueado por el perfil/día
    let cubierto = false;

    for (const tier of _TIERS_CESION) {
      let mejor = null;
      for (const disc of discs) {
        const nec = { tipo: 'cierre_ventana', disciplina: disc, esAlmuerzo: false, slotForzado: slot.id, urgente: false };
        const res = intentarAsignar(nec, pac, sesiones, profSlotsHoy, patientSlots, profsDisponibles,
          fecha, sesionesEstaSemana, { ...ctx, relajar: tier });
        if (res.ok && (!mejor || res.sesion.puntaje > mejor.sesion.puntaje)) mejor = res;
      }
      if (mejor) {
        _registrarSesionEnMapas(mejor.sesion, sesiones, profSlotsHoy, patientSlots, profsDisponibles, ctx);
        cubierto = true;
        break;
      }
    }

    if (!cubierto) {
      cubierto = _repararHuecoAmbulatorio(pac, slot, discs, sesiones, profSlotsHoy, patientSlots,
        profsDisponibles, fecha, sesionesEstaSemana, ctx);
    }
    if (!cubierto) sinCubrir.push(slot);
  }
  return sinCubrir;
}

// Cubre el hueco de un ambulatorio reorganizando el slot con un camino aumentante
// (matching): el ambulatorio toma a un profesional ocupado y la sesión desplazada
//   · pasa a otro profesional libre o, en cadena, desplaza a su vez a otra sesión;
//     un ambulatorio desplazado puede cambiar a otra disciplina de su plan, un
//     internado conserva la suya; o
//   · (solo internados) se mueve a otro slot libre manteniendo a su profesional.
// Si no hay camino cediendo nada, se permite que los ambulatorios cedan las
// exclusiones y el grupo exclusivo (primero solo el del hueco, después los de la cadena).
// No toca sesiones fijas ni rutinas (higiene / almuerzo terapéutico).
function _repararHuecoAmbulatorio(pac, slot, discs, sesiones, profSlotsHoy, patientSlots,
                                  profsDisponibles, fecha, sesionesEstaSemana, ctx) {
  const estado = DiasState.delDia(fecha);
  const dia = _weekday(fecha);

  const puedeMoverse = ses => ses && !ses.fijo && !(ses.disciplina || '').startsWith('_');
  const esAmbulatorioHoy = p => !!_ventanaAmbulatoria(p, dia);
  const discsDePlan = (p, primera) => {
    const todas = _discsPlanOrdenadasPorDeficit(p, Planes.delPaciente(p.id), fecha);
    return primera ? [primera, ...todas.filter(d => d !== primera)] : todas;
  };

  // nivel de cesión: 0 = nada · 1 = el ambulatorio del hueco cede exclusiones/grupo · 2 = todo ambulatorio en la cadena
  let nivel = 0;
  const cedeExcl = paciente => nivel === 2 ? esAmbulatorioHoy(paciente) : (nivel === 1 && paciente.id === pac.id);

  // Opciones (profesional, disciplina) válidas para un paciente en este slot
  const opcionesDe = (paciente, disciplinas) => {
    const out = [];
    const cede = cedeExcl(paciente);
    for (const P of profsDisponibles) {
      if (P.esCoordinador) continue; // no se reubican cuotas de coordinadores
      if (!_disponibilidadProfSlot(P, estado, slot, fecha).ok) continue;
      if (!cede && (paciente.exclusionesProfesionales || []).includes(P.id)) continue;
      if (!cede && P.grupoExclusivo && paciente.grupo !== P.grupoExclusivo) continue;
      const d = disciplinas.find(x => (P.disciplinas || []).includes(x));
      if (d) out.push({ P, d });
    }
    return out;
  };

  // Otro slot donde el internado Y puede quedar con el mismo profesional P
  const slotAlternativo = (Y, occ, P) => SLOTS.find(S2 => {
    if (S2.id === slot.id) return false;
    if (patientSlots[Y.id]?.[S2.id]) return false;
    if (profSlotsHoy[P.id]?.[S2.id]) return false;
    if (_esSlotExcluidoDeAuto(Y, S2)) return false;
    if (!_disponibilidadProfSlot(P, estado, S2, fecha).ok) return false;
    const sinOcc = sesiones.filter(s => s.id !== occ.id);
    return !_generaConsecutividad(Y.id, occ.disciplina, SLOTS.indexOf(S2), sinOcc);
  });

  const movimientos = []; // más profundo primero: { ses (null = sesión nueva), paciente, P, d, moverA }
  const buscar = (paciente, ses, visitados) => {
    const disciplinas = !ses ? discs
      : (esAmbulatorioHoy(paciente) ? discsDePlan(paciente, ses.disciplina) : [ses.disciplina]);
    for (const { P, d } of opcionesDe(paciente, disciplinas)) {
      if (visitados.has(P.id)) continue;
      visitados.add(P.id);
      const actual = profSlotsHoy[P.id]?.[slot.id];
      if (!actual) { movimientos.push({ ses, paciente, P, d }); return true; }
      if (typeof actual !== 'string') continue; // KTR dual: no se toca
      const occ = sesiones.find(x => x.id === actual);
      if (!puedeMoverse(occ) || occ.pacienteId === pac.id) continue;
      const Y = Pacientes.porId(occ.pacienteId);
      if (!Y) continue;
      const mark = movimientos.length;
      if (buscar(Y, occ, visitados)) { movimientos.push({ ses, paciente, P, d }); return true; }
      movimientos.length = mark;
      if (!Y.esAmbulatorio) { // un ambulatorio nunca se reubica a otro slot (queda dentro de su ventana)
        const S2 = slotAlternativo(Y, occ, P);
        if (S2) {
          movimientos.push({ ses: occ, paciente: Y, P, d: occ.disciplina, moverA: S2 });
          movimientos.push({ ses, paciente, P, d });
          return true;
        }
      }
    }
    return false;
  };

  for (nivel = 0; nivel <= 2; nivel++) {
    movimientos.length = 0;
    if (!buscar(pac, null, new Set())) continue;

    // Aplicar los movimientos (con instantánea para revertir si la asignación final falla)
    const snapSes = [...sesiones];
    const snapProf = Object.fromEntries(Object.entries(profSlotsHoy).map(([k, v]) => [k, { ...v }]));
    const snapPac  = Object.fromEntries(Object.entries(patientSlots).map(([k, v]) => [k, { ...v }]));
    const restaurar = () => {
      sesiones.length = 0; sesiones.push(...snapSes);
      Object.keys(profSlotsHoy).forEach(k => { profSlotsHoy[k] = snapProf[k] || {}; });
      Object.keys(patientSlots).forEach(k => { patientSlots[k] = snapPac[k] || {}; });
    };

    let nueva = null;
    for (const m of movimientos) {
      if (!m.ses) { nueva = m; continue; }
      const i = sesiones.findIndex(x => x.id === m.ses.id);
      if (m.moverA) {
        sesiones[i] = { ...m.ses, slotId: m.moverA.id, inicio: m.moverA.inicio, fin: m.moverA.fin, origen: 'automatico_mejora' };
        delete profSlotsHoy[m.P.id][slot.id];
        profSlotsHoy[m.P.id][m.moverA.id] = m.ses.id;
        delete patientSlots[m.paciente.id][slot.id];
        patientSlots[m.paciente.id][m.moverA.id] = m.ses.id;
      } else {
        const viejoProf = m.ses.profesionalId;
        sesiones[i] = { ...m.ses, profesionalId: m.P.id, disciplina: m.d, origen: 'automatico_mejora' };
        if (profSlotsHoy[viejoProf]?.[slot.id] === m.ses.id) delete profSlotsHoy[viejoProf][slot.id];
        profSlotsHoy[m.P.id][slot.id] = m.ses.id;
      }
    }
    const nec = { tipo: 'cierre_ventana', disciplina: nueva.d, esAlmuerzo: false, slotForzado: slot.id,
                  urgente: false, profesionalId: nueva.P.id };
    for (const tier of _TIERS_CESION) {
      const res = intentarAsignar(nec, pac, sesiones, profSlotsHoy, patientSlots, profsDisponibles,
        fecha, sesionesEstaSemana, { ...ctx, relajar: tier });
      if (res.ok) {
        _registrarSesionEnMapas(res.sesion, sesiones, profSlotsHoy, patientSlots, profsDisponibles, ctx);
        return true;
      }
    }
    restaurar();
  }
  return false;
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

// Devuelve 'habitual' | 'dia' | { ingreso, retiro } | null según la presencia del profesional en el día.
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

// Presencia con rango horario puntual del día: { ingreso:'HH:00', retiro:'HH:00' }.
function _presenciaConRango(pres) {
  return typeof pres === 'object' && pres !== null && !!pres.ingreso && !!pres.retiro;
}

// Única fuente de verdad de "¿puede este profesional atender en este slot de este día?".
// Devuelve { ok, razon }. Reglas:
//   · Tiene que estar presente ese día (panel de disponibilidad).
//   · Si el operario indicó ingreso/retiro para ese día, ese rango REEMPLAZA al
//     horario habitual (puede acortarlo o alargarlo). El panel no distingue el 13:00,
//     así que con rango el profesional queda fuera de ese slot.
//   · Con "horario habitual", se usa el perfil: solo los slots tildados (el 13:00 es opt-in).
//     Un día sin horarios cargados en el perfil (presencia marcada a mano en un día no
//     laboral) cubre el día completo salvo el 13:00.
//   · Sin bloqueo coyuntural del profesional en ese slot.
// No mira ocupación por otras sesiones ni "excluir del armado automático".
function _disponibilidadProfSlot(prof, estado, slot, fecha) {
  if (!prof || !slot) return { ok: false, razon: 'Profesional o horario inexistente' };
  const pres = _getPresencia(estado, prof.id, fecha);
  if (!pres) return { ok: false, razon: 'No está presente ese día' };

  const bloq = ((estado?.bloqueosProfesionales || {})[prof.id] || []).find(b => b.slotId === slot.id);
  if (bloq) return { ok: false, razon: 'Tiene el horario bloqueado' + (bloq.motivo ? ` (${bloq.motivo})` : '') };

  if (_presenciaConRango(pres)) {
    if (slot.id === SLOT_SOLO_PERFIL)
      return { ok: false, razon: 'Cambió su horario ese día: las 13:00 solo se usan con el horario habitual' };
    if (slot.inicio >= pres.ingreso && slot.fin <= pres.retiro) return { ok: true };
    return { ok: false, razon: `Fuera del horario del día (${pres.ingreso}–${pres.retiro})` };
  }

  const dia = _weekday(fecha);
  const horarios = (prof.horariosPorDia || {})[dia] || [];
  const base = horarios.length > 0
    ? horarios
    : ((prof.diasLaborales || []).includes(dia) ? [] : SLOTS_DIA_DEFAULT);
  if (base.includes(slot.id)) return { ok: true };
  return { ok: false, razon: slot.id === SLOT_SOLO_PERFIL
    ? 'No tiene tildadas las 13:00 en su perfil'
    : 'Fuera de su horario habitual' };
}

// Compatibilidad: el resto del código llama a esto con (estado, profId, turno, fecha, slotId).
function _profEnTurno(estado, profId, slotTurno, fecha, slotId) {
  const prof = Profesionales.porId(profId);
  const slot = SLOTS.find(s => s.id === slotId);
  return _disponibilidadProfSlot(prof, estado, slot, fecha).ok;
}

// Profesionales presentes y libres (sin sesión) en cada slot del día, para el
// panel "Disponibles" y el PDF. Excluye a los marcados "excluir del armado automático".
function profesionalesLibresPorSlot(fecha, sesiones) {
  const estado = DiasState.delDia(fecha);
  const excluidos = estado.profesionalesExcluidos || [];
  const profs = Profesionales.todos().filter(p => p.activo !== false && !excluidos.includes(p.id) && _getPresencia(estado, p.id, fecha));
  const libres = {};
  SLOTS.forEach(slot => {
    const ocupados = new Set();
    sesiones.filter(x => x.slotId === slot.id).forEach(x => {
      ocupados.add(x.profesionalId);
      (x.profesionalesAdicionales || []).forEach(id => ocupados.add(id));
    });
    libres[slot.id] = profs.filter(p => !ocupados.has(p.id) && _disponibilidadProfSlot(p, estado, slot, fecha).ok);
  });
  return libres;
}

// Profesionales activos que pueden atender en ese slot y día (para los desplegables
// de asignación manual). Incluye a los "excluidos del armado automático" y deja
// afuera a los ya ocupados en ese horario. Si disciplina viene, filtra por ella.
function profesionalesDisponiblesParaSlot(fecha, slotId, disciplina, opciones = {}) {
  const { ignorarSesionId = null } = opciones;
  const estado = DiasState.delDia(fecha);
  const slot = SLOTS.find(s => s.id === slotId);
  if (!slot) return [];
  const sesiones = Asignaciones.delDia(fecha).filter(s => s.slotId === slotId && s.id !== ignorarSesionId);
  const ocupados = new Set();
  sesiones.forEach(s => {
    // KTR dual: un kinesiólogo respiratorio con una sola sesión KTR puede recibir un segundo paciente
    if (disciplina === 'kinesiologiaRespiratoria' && s.disciplina === 'kinesiologiaRespiratoria'
        && sesiones.filter(x => x.profesionalId === s.profesionalId).length < 2) return;
    ocupados.add(s.profesionalId);
    (s.profesionalesAdicionales || []).forEach(id => ocupados.add(id));
  });
  return Profesionales.activos().filter(p =>
    (!disciplina || (p.disciplinas || []).includes(disciplina)) &&
    !ocupados.has(p.id) &&
    _disponibilidadProfSlot(p, estado, slot, fecha).ok
  );
}

// Total de slots disponibles de un profesional en la semana
function _totalSlotsSemanales(prof) {
  const dias = prof.diasLaborales || [];
  if (dias.length === 0) return SLOTS_DIA_DEFAULT.length;
  return dias.reduce((total, d) => {
    const horarios = (prof.horariosPorDia || {})[d];
    return total + (horarios && horarios.length > 0 ? horarios.length : SLOTS_DIA_DEFAULT.length);
  }, 0);
}

// Asigna las necesidades del día de un paciente. Si es un ambulatorio presente,
// además cierra su ventana (ver _completarVentanaAmbulatoria): no puede quedar
// un slot sin sesión dentro de su horario de asistencia.
// S = { estado, fecha, sesiones, profSlotsHoy, patientSlots, profsDisponibles, coordSesEstaSemana, alertas }
function _asignarPacienteDia(paciente, S) {
  const { estado, fecha, sesiones, profSlotsHoy, patientSlots, profsDisponibles, coordSesEstaSemana, alertas } = S;
  const diaActual = _weekday(fecha);
  const semana = limitesDeSemana(fecha);
  if (!_pacienteAsignableAuto(paciente, diaActual)) return;

  const esAmb = !!_ventanaAmbulatoria(paciente, diaActual);
  const fijasDelPac = sesiones.filter(s => s.fijo === true && s.pacienteId === paciente.id).length;
  // Ambulatorio: tantas sesiones como slots libres tenga su ventana. Resto: objetivo fijo.
  const horasNecesarias = esAmb
    ? Math.max(0, _horasObjetivoPaciente(paciente, estado, diaActual) - fijasDelPac)
    : HORAS_OBJETIVO_DIA;
  // Saltear pacientes cuyos slots fijos ya cubrieron todas las necesidades
  if (!esAmb && fijasDelPac >= HORAS_OBJETIVO_DIA) return;

  const plan = Planes.delPaciente(paciente.id);
  const prescripciones = (estado.prescripcionesUrgentes || {})[paciente.id] || [];

  // Sesiones ya hechas esta semana (antes de hoy) para calcular proporción
  const sesionesEstaSemana = Asignaciones.delPacienteEnSemana(paciente.id, semana.inicio, semana.fin);
  const conteoSemanal = {};
  sesionesEstaSemana
    .filter(s => s.fecha < fecha)
    .forEach(s => { conteoSemanal[s.disciplina] = (conteoSemanal[s.disciplina] || 0) + 1; });

  const necesidades = construirNecesidades(
    paciente, plan, conteoSemanal, prescripciones, fecha, horasNecesarias
  );

  const ctx = { coordSesEstaSemana };
  let horasAsignadas = 0;

  for (const nec of necesidades) {
    const resultado = intentarAsignar(
      nec, paciente, sesiones, profSlotsHoy,
      patientSlots, profsDisponibles, fecha, sesionesEstaSemana, ctx
    );

    if (resultado.ok) {
      _registrarSesionEnMapas(resultado.sesion, sesiones, profSlotsHoy, patientSlots, profsDisponibles, ctx);
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

  if (esAmb) {
    const antes = sesiones.length;
    const sinCubrir = _completarVentanaAmbulatoria(
      paciente, sesiones, profSlotsHoy, patientSlots, profsDisponibles, fecha, sesionesEstaSemana, ctx);
    horasAsignadas += sesiones.length - antes;
    sinCubrir.forEach(slot => alertas.push({
      tipo: 'ambulatorio_hueco',
      pacienteId: paciente.id,
      pacienteNombre: `${paciente.nombre} ${paciente.apellido}`,
      slotId: slot.id,
      msg: `${paciente.nombre} ${paciente.apellido} (ambulatorio): sin sesión a las ${slot.label} — ` +
           `no hay profesional disponible con una disciplina de su plan. Revisá la carga de datos.`
    }));
  }

  const objetivo = esAmb ? horasNecesarias : HORAS_OBJETIVO_DIA;
  if (horasAsignadas < objetivo) {
    alertas.push({
      tipo: 'deficit_horas',
      pacienteId: paciente.id,
      pacienteNombre: `${paciente.nombre} ${paciente.apellido}`,
      horasAsignadas,
      horasObjetivo: objetivo,
      msg: `${paciente.nombre} ${paciente.apellido}: ${horasAsignadas}/${objetivo} horas asignadas`
    });
  }
}

function generarAgenda(fecha, opciones = {}) {
  const { ordenOverride = null, persistir = true } = opciones;
  const estado = DiasState.delDia(fecha);
  const todosPacientes = Pacientes.activos();
  const idsExcluidos  = estado.profesionalesExcluidos  || [];
  const profsDisponibles = Profesionales.todos()
    .filter(p => p.activo !== false && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));

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

  // Ordenar pacientes: prioritarios del día primero (en el orden declarado),
  // luego ambulatorios, luego el resto; dentro de cada grupo por scorePrioridad.
  const pacientesOrdenados = ordenOverride
    ? ordenOverride
    : (() => {
        const sort = (arr) => [...arr].sort((a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a));
        const idsPrioHoy = estado.pacientesPrioritariosHoy || [];
        const prioHoy = idsPrioHoy.map(id => todosPacientes.find(p => p.id === id)).filter(Boolean);
        const idsPrioSet = new Set(idsPrioHoy);
        const ambul = todosPacientes.filter(p => p.esAmbulatorio && !idsPrioSet.has(p.id));
        const resto = todosPacientes.filter(p => !p.esAmbulatorio && !idsPrioSet.has(p.id));
        return [...prioHoy, ...sort(ambul), ...sort(resto)];
      })();

  const diaActual = _weekday(fecha);

  // Bloquear slots fuera de la ventana de asistencia ambulatoria
  _aplicarVentanaAmbulatoria(patientSlots, todosPacientes, diaActual);

  // Bloquear slots de baño semanal (+ hora anterior/siguiente si corresponde)
  todosPacientes.forEach(p => {
    _aplicarBloqueosBano(patientSlots, p.id, p.bañosSemana, diaActual);
  });

  // Los ambulatorios presentes se resuelven primero (siempre, también en las
  // rotaciones de generarAgendaOptima): no pueden quedar con slots sin cubrir.
  const _presenteAmb = p => !!_ventanaAmbulatoria(p, diaActual);
  const ordenFinal = [
    ...pacientesOrdenados.filter(_presenteAmb),
    ...pacientesOrdenados.filter(p => !_presenteAmb(p))
  ];

  const S = { estado, fecha, sesiones, profSlotsHoy, patientSlots, profsDisponibles, coordSesEstaSemana, alertas };
  for (const paciente of ordenFinal) _asignarPacienteDia(paciente, S);

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
    .filter(p => p.activo !== false && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));

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
  _aplicarVentanaAmbulatoria(patientSlots, todosPacientes, diaActual);

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
  const ambulatoriosConVentana = [];

  for (const pac of todosPacientes) {
    if (pac.esAmbulatorio) {
      if (!(pac.diasAsistencia || []).includes(diaActual)) continue;
      // Ambulatorios con ventana definida: se resuelven primero y por completo (ver más abajo)
      if (_ventanaAmbulatoria(pac, diaActual)) { ambulatoriosConVentana.push(pac); continue; }
      continue; // asiste pero sin horario definido: no se le asigna nada automático
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

  // ── Ambulatorios primero: sesión en cada slot libre de su ventana ──
  const alertasAmb = [];
  const _S = { estado, fecha, sesiones, profSlotsHoy, patientSlots, profsDisponibles, coordSesEstaSemana, alertas: alertasAmb };
  [...ambulatoriosConVentana]
    .sort((a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a))
    .forEach(pac => _asignarPacienteDia(pac, _S));

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

  // Horario del profesional (perfil / rango del día / bloqueos) lo valida _profEnTurno;
  // acá solo la cuota semanal de coordinadores.
  function _profDisponibleEnSlot(prof, slot) {
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
        const discElegidaAlm = _discPrioritariaDisponible(
          pac.disciplinasAlmuerzo?.length ? pac.disciplinasAlmuerzo : DISCIPLINAS_ALMUERZO_DEFAULT,
          profsDisponibles, estado, slot, fecha
        );
        let bestProf = null, bestScore = -Infinity;
        for (const prof of profsDisponibles) {
          if ((pac.exclusionesProfesionales || []).includes(prof.id)) continue;
          if (discElegidaAlm && !(prof.disciplinas || []).includes(discElegidaAlm)) continue;
          if (profSlotsHoy[prof.id][slot.id]) continue;
          if (!_profDisponibleEnSlot(prof, slot)) continue;
          if (!_profEnTurno(estado, prof.id, slot.turno, fecha, slot.id)) continue;
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
      // El 12:00 sigue con las disciplinas regulares para quienes no lo tienen
      // reservado (ver _esSlotExcluidoDeAuto en el filtro de candidatos).
    }

    // Higiene matutina forzada a slot_09
    if (slot.id === 'slot_09') {
      for (const pac of pacientesActivos) {
        if (!pac.requiereHigiene) continue;
        if (patientSlots[pac.id][slot.id]) continue;
        if (!(remainingNeeds[pac.id]?.['_higiene'] > 0)) continue;
        const discElegidaHig = _discPrioritariaDisponible(
          pac.disciplinasHigiene, profsDisponibles, estado, slot, fecha
        );
        let bestProf = null, bestScore = -Infinity;
        for (const prof of profsDisponibles) {
          if ((pac.exclusionesProfesionales || []).includes(prof.id)) continue;
          if (discElegidaHig && !(prof.disciplinas || []).includes(discElegidaHig)) continue;
          if (profSlotsHoy[prof.id][slot.id]) continue;
          if (!_profDisponibleEnSlot(prof, slot)) continue;
          if (!_profEnTurno(estado, prof.id, slot.turno, fecha, slot.id)) continue;
          const { total } = calcularPuntaje(
            prof, slot, 0, pac, '_higiene', false, false,
            sesiones, profSlotsHoy, sesSemanaMap[pac.id] || []
          );
          if (total > bestScore) { bestScore = total; bestProf = prof; }
        }
        if (!bestProf) continue;
        _registrar({
          id: genId(), fecha, pacienteId: pac.id, profesionalId: bestProf.id,
          disciplina: '_higiene', slotId: slot.id, inicio: slot.inicio, fin: slot.fin,
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
        if (!_profEnTurno(estado, prof.id, slot.turno, fecha, slot.id)) return false;
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
          if (_esSlotExcluidoDeAuto(pac, slot)) return false;
          if (_generaConsecutividad(pac.id, disc, slotIdx, sesiones)) return false;
          if (prof.grupoExclusivo && pac.grupo !== prof.grupoExclusivo) return false;
          if ((pac.exclusionesProfesionales || []).includes(prof.id)) return false;
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
  return { sesiones, alertas: alertasAmb, metricas };
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
    .filter(p => p.activo !== false && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));
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
    _aplicarVentanaAmbulatoria(patientSlots, todosPacientes, _diaActual);

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

  const diaMejora = _weekday(fecha);
  const pacientesOrdenados = todosPacientes
    .filter(p => _pacienteAsignableAuto(p, diaMejora)) // ambulatorios solo si asisten ese día y tienen horario
    .sort((a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a));

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

          for (const sesObstáculo of sesDelProf) {
            if (swapEncontrado) break;

            // ¿El slot bloqueado por esta sesión está disponible para nuestro paciente?
            if (patientSlots[pac.id]?.[sesObstáculo.slotId]) continue;

            // El prof debe poder atender a pac en el slot liberado (grupoExclusivo, exclusiones)
            if (prof.grupoExclusivo && pac.grupo !== prof.grupoExclusivo) continue;
            if ((pac.exclusionesProfesionales || []).includes(prof.id)) continue;

            // El prof debe estar presente en el turno del slot liberado
            const slotLiberadoDef = SLOTS.find(s => s.id === sesObstáculo.slotId);
            if (!slotLiberadoDef) continue;
            if (!_profEnTurno(estado, prof.id, slotLiberadoDef.turno, fecha, slotLiberadoDef.id)) continue;
            if (_esSlotExcluidoDeAuto(pac, slotLiberadoDef)) continue;

            // El slot liberado no puede quedar adyacente a otra sesión de la
            // misma disciplina que ya tenga nuestro paciente
            const idxLiberado = SLOTS.findIndex(s => s.id === slotLiberadoDef.id);
            if (_generaConsecutividad(pac.id, nec.disciplina, idxLiberado, sesiones)) continue;

            // Buscar un nuevo slot al que mover la sesión obstáculo
            const pacDonor = Pacientes.porId(sesObstáculo.pacienteId);
            if (!pacDonor) continue;

            for (const nuevoSlot of SLOTS) {
              if (_esSlotExcluidoDeAuto(pacDonor, nuevoSlot)) continue;
              if (nuevoSlot.id === sesObstáculo.slotId) continue;
              if (profSlotsHoy[prof.id]?.[nuevoSlot.id]) continue;        // prof ocupado ahí
              if (patientSlots[pacDonor.id]?.[nuevoSlot.id]) continue;    // donor ocupado/bloqueado

              // Verificar que el prof puede trabajar en el turno del nuevo slot
              if (!_profEnTurno(estado, prof.id, nuevoSlot.turno, fecha, nuevoSlot.id)) continue;

              // Que el donante tampoco quede con la misma disciplina en slots consecutivos
              const idxNuevo = SLOTS.findIndex(s => s.id === nuevoSlot.id);
              const sesionesSinObstaculo = sesiones.filter(s => s.id !== sesObstáculo.id);
              if (_generaConsecutividad(pacDonor.id, sesObstáculo.disciplina, idxNuevo, sesionesSinObstaculo)) continue;

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

// ─── Relleno de espacios vacíos ────────────────────────────────────────────────
// Después de generar la agenda suelen quedar slots libres para pacientes que
// tienen disciplinas de su plan sin cubrir, con profesionales disponibles en
// ese horario. Estas funciones detectan esos huecos y los completan — de
// forma automática (elige sola la mejor opción) o interactiva (recorre los
// huecos uno por uno para que el operador decida). Reutilizan intentarAsignar,
// así heredan todas las restricciones duras y blandas del motor principal.

// Arma profSlotsHoy/patientSlots aplicando los mismos bloqueos que
// generarAgenda/mejoraLocal, superponiendo las sesiones ya existentes.
function _reconstruirMapsDelDia(fecha, sesionesHoy, profsDisponibles, todosPacientes) {
  const estado = DiasState.delDia(fecha);
  const diaActual = _weekday(fecha);
  const profSlotsHoy = {};
  const patientSlots = {};
  profsDisponibles.forEach(p => { profSlotsHoy[p.id] = {}; });
  todosPacientes.forEach(p => { patientSlots[p.id] = {}; });

  const bloqueos = estado.bloquesPacientes || {};
  for (const pacId in bloqueos) {
    if (patientSlots[pacId]) {
      (bloqueos[pacId] || []).forEach(b => { patientSlots[pacId][b.slotId] = `BLOQUEADO:${b.motivo}`; });
    }
  }
  todosPacientes.forEach(p => {
    (p.bloqueosPermanentes || []).forEach(b => {
      if (patientSlots[p.id] && !patientSlots[p.id][b.slotId]) patientSlots[p.id][b.slotId] = `BLOQ_PERM:${b.motivo}`;
    });
  });
  const bloqueosProf = estado.bloqueosProfesionales || {};
  for (const profId in bloqueosProf) {
    if (profSlotsHoy[profId]) {
      (bloqueosProf[profId] || []).forEach(b => {
        if (!profSlotsHoy[profId][b.slotId]) profSlotsHoy[profId][b.slotId] = `BLOQ_PROF:${b.motivo || ''}`;
      });
    }
  }
  _aplicarVentanaAmbulatoria(patientSlots, todosPacientes, diaActual);
  todosPacientes.forEach(p => {
    _aplicarBloqueosBano(patientSlots, p.id, p.bañosSemana, diaActual);
  });

  sesionesHoy.forEach(s => {
    if (patientSlots[s.pacienteId]) patientSlots[s.pacienteId][s.slotId] = s.id;
    if (profSlotsHoy[s.profesionalId]) {
      const ex = profSlotsHoy[s.profesionalId][s.slotId];
      profSlotsHoy[s.profesionalId][s.slotId] = ex ? [ex, s.id] : s.id;
    }
  });

  return { profSlotsHoy, patientSlots };
}

// Disciplinas del plan de un paciente, ordenadas por cuánto le falta esta
// semana (la más atrasada respecto del objetivo semanal, primero).
function _discsPlanOrdenadasPorDeficit(pac, plan, fecha) {
  const semana = limitesDeSemana(fecha);
  const sessSemana = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);
  const conteoSemanal = {};
  sessSemana.filter(s => s.fecha < fecha).forEach(s => {
    conteoSemanal[s.disciplina] = (conteoSemanal[s.disciplina] || 0) + 1;
  });
  return Object.keys(plan)
    .filter(d => (plan[d] || 0) > 0)
    .sort((a, b) => {
      const deficitA = (plan[a] || 0) - (conteoSemanal[a] || 0);
      const deficitB = (plan[b] || 0) - (conteoSemanal[b] || 0);
      return deficitB - deficitA;
    });
}

function _profsDisponiblesDelDia(fecha) {
  const estado = DiasState.delDia(fecha);
  const idsExcluidos = estado.profesionalesExcluidos || [];
  return Profesionales.todos()
    .filter(p => p.activo !== false && _getPresencia(estado, p.id, fecha) && !idsExcluidos.includes(p.id));
}

// Detecta huecos rellenables: pacientes que ya tienen agenda ese día, con
// algún slot libre y alguna disciplina de su plan con profesional disponible.
function detectarHuecosRellenables(fecha) {
  const estado = DiasState.delDia(fecha);
  const diaActual = _weekday(fecha);
  const profsDisponibles = _profsDisponiblesDelDia(fecha);
  const todosPacientes = Pacientes.activos();
  const sesionesHoy = Asignaciones.delDia(fecha);
  const { profSlotsHoy, patientSlots } = _reconstruirMapsDelDia(fecha, sesionesHoy, profsDisponibles, todosPacientes);

  const pacientesConAgenda = todosPacientes.filter(p => _pacienteAsignableAuto(p, diaActual) &&
    (sesionesHoy.some(s => s.pacienteId === p.id) || _ventanaAmbulatoria(p, diaActual)));
  const pacientesOrdenados = [...pacientesConAgenda].sort(
    (a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a)
  );

  const huecos = [];
  pacientesOrdenados.forEach(pac => {
    if (pac.esAmbulatorio && !(pac.diasAsistencia || []).includes(diaActual)) return;
    const plan = Planes.delPaciente(pac.id);
    const discsPlan = Object.keys(plan).filter(d => (plan[d] || 0) > 0);
    if (discsPlan.length === 0) return;

    SLOTS.forEach(slot => {
      if (_esSlotExcluidoDeAuto(pac, slot)) return;
      if (patientSlots[pac.id]?.[slot.id]) return;
      const hayCandidato = discsPlan.some(disc =>
        profsDisponibles.some(p =>
          (p.disciplinas || []).includes(disc) &&
          _profEnTurno(estado, p.id, slot.turno, fecha, slot.id) &&
          !profSlotsHoy[p.id]?.[slot.id]
        )
      );
      if (hayCandidato) huecos.push({ pacienteId: pac.id, slotId: slot.id });
    });
  });

  return huecos;
}

// Modo automático: recorre los huecos y asigna sola la mejor combinación
// disciplina/profesional disponible para cada uno (probando cada disciplina
// del plan por orden de déficit semanal, y quedándose con la de mejor puntaje).
function rellenarEspaciosVaciosAuto(fecha) {
  const profsDisponibles = _profsDisponiblesDelDia(fecha);
  const todosPacientes = Pacientes.activos();
  const semana = limitesDeSemana(fecha);
  const diaActual = _weekday(fecha);

  let sesiones = [...Asignaciones.delDia(fecha)];
  if (!sesiones.length) return { sesionesAgregadas: 0, detalles: [] };

  const pacientesConAgenda = todosPacientes.filter(p => _pacienteAsignableAuto(p, diaActual) &&
    (sesiones.some(s => s.pacienteId === p.id) || _ventanaAmbulatoria(p, diaActual)));
  const pacientesOrdenados = [...pacientesConAgenda].sort(
    (a, b) => Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a)
  );

  let sesionesAgregadas = 0;
  const detalles = [];

  pacientesOrdenados.forEach(pac => {
    if (pac.esAmbulatorio && !(pac.diasAsistencia || []).includes(diaActual)) return;
    const plan = Planes.delPaciente(pac.id);
    const discsOrdenadas = _discsPlanOrdenadasPorDeficit(pac, plan, fecha);
    if (discsOrdenadas.length === 0) return;

    // Ambulatorio con ventana: se cierra por completo (cede restricciones y reubica si hace falta)
    if (_ventanaAmbulatoria(pac, diaActual)) {
      const { profSlotsHoy, patientSlots } = _reconstruirMapsDelDia(fecha, sesiones, profsDisponibles, todosPacientes);
      const sessSemana = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);
      const antes = sesiones.length;
      _completarVentanaAmbulatoria(pac, sesiones, profSlotsHoy, patientSlots, profsDisponibles, fecha, sessSemana, {});
      for (let i = antes; i < sesiones.length; i++) {
        sesiones[i] = { ...sesiones[i], origen: 'automatico_relleno', fijo: false };
        sesionesAgregadas++;
        const slot = SLOTS.find(sl => sl.id === sesiones[i].slotId);
        const prof = Profesionales.porId(sesiones[i].profesionalId);
        detalles.push(
          `+ ${discLabel(sesiones[i].disciplina)} → ${pac.nombre} ${pac.apellido} ` +
          `(${slot?.label}, ${prof ? Profesionales.nombreCompleto(prof) : '?'})`
        );
      }
      return;
    }

    SLOTS.forEach(slot => {
      if (_esSlotExcluidoDeAuto(pac, slot)) return;

      const { profSlotsHoy, patientSlots } = _reconstruirMapsDelDia(fecha, sesiones, profsDisponibles, todosPacientes);
      if (patientSlots[pac.id]?.[slot.id]) return;

      const sessSemana = Asignaciones.delPacienteEnSemana(pac.id, semana.inicio, semana.fin);
      let mejor = null;
      discsOrdenadas.forEach(disc => {
        const necesidad = { tipo: 'relleno_hueco', disciplina: disc, esAlmuerzo: false, slotForzado: slot.id, urgente: false };
        const resultado = intentarAsignar(necesidad, pac, sesiones, profSlotsHoy, patientSlots, profsDisponibles, fecha, sessSemana);
        if (resultado.ok && (!mejor || resultado.sesion.puntaje > mejor.sesion.puntaje)) mejor = resultado;
      });

      if (mejor) {
        const sesion = { ...mejor.sesion, origen: 'automatico_relleno', fijo: false };
        sesiones.push(sesion);
        sesionesAgregadas++;
        const prof = Profesionales.porId(sesion.profesionalId);
        detalles.push(
          `+ ${discLabel(sesion.disciplina)} → ${pac.nombre} ${pac.apellido} ` +
          `(${slot.label}, ${prof ? Profesionales.nombreCompleto(prof) : '?'})`
        );
      }
    });
  });

  if (sesionesAgregadas > 0) {
    Asignaciones.guardarDia(fecha, sesiones);
    Auditoria.registrar({
      tipo: 'relleno_huecos',
      fecha,
      descripcion: `Relleno automático de huecos: +${sesionesAgregadas} sesión(es)`,
      detalles
    });
  }

  return { sesionesAgregadas, detalles };
}

// Modo interactivo: para un hueco puntual, devuelve las opciones disponibles
// (una por disciplina compatible del plan, con el mejor profesional para
// cada una) para que el operador elija.
function opcionesParaHueco(fecha, pacienteId, slotId) {
  const profsDisponibles = _profsDisponiblesDelDia(fecha);
  const todosPacientes = Pacientes.activos();
  const sesionesHoy = Asignaciones.delDia(fecha);
  const { profSlotsHoy, patientSlots } = _reconstruirMapsDelDia(fecha, sesionesHoy, profsDisponibles, todosPacientes);

  const pac = Pacientes.porId(pacienteId);
  if (!pac || patientSlots[pacienteId]?.[slotId]) return [];
  if (!pac || !_pacienteAsignableAuto(pac, _weekday(fecha))) return [];

  const plan = Planes.delPaciente(pacienteId);
  const discsOrdenadas = _discsPlanOrdenadasPorDeficit(pac, plan, fecha);
  const semana = limitesDeSemana(fecha);
  const sessSemana = Asignaciones.delPacienteEnSemana(pacienteId, semana.inicio, semana.fin);

  const opciones = [];
  discsOrdenadas.forEach(disc => {
    const necesidad = { tipo: 'relleno_hueco', disciplina: disc, esAlmuerzo: false, slotForzado: slotId, urgente: false };
    const resultado = intentarAsignar(necesidad, pac, sesionesHoy, profSlotsHoy, patientSlots, profsDisponibles, fecha, sessSemana);
    if (resultado.ok) {
      opciones.push({
        disciplina: disc,
        profesionalId: resultado.sesion.profesionalId,
        puntaje: resultado.sesion.puntaje,
        motivo: resultado.sesion.motivo
      });
    }
  });

  return opciones.sort((a, b) => b.puntaje - a.puntaje);
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

// ─── Verificación previa de cobertura ambulatoria ─────────────────────────────
//
// Antes de generar: avisa si los datos cargados hacen imposible que un
// ambulatorio presente quede con todos los slots de su ventana cubiertos
// (ventana sin definir, plan vacío, o slots donde no hay suficientes
// profesionales disponibles con disciplinas de los planes). Sirve para
// detectar errores de carga; devuelve una lista de textos (vacía si todo ok).
function verificarCoberturaAmbulatorios(fecha) {
  const estado = DiasState.delDia(fecha);
  const dia = _weekday(fecha);
  const profs = _profsDisponiblesDelDia(fecha);
  const avisos = [];
  const infos = [];

  Pacientes.activos()
    .filter(p => p.esAmbulatorio && (p.diasAsistencia || []).includes(dia))
    .forEach(pac => {
      const nombre = `${pac.apellido}, ${pac.nombre}`;
      const v = _ventanaAmbulatoria(pac, dia);
      if (!v) {
        avisos.push(`${nombre}: es ambulatorio y asiste este día pero no tiene horario de ingreso/egreso definido.`);
        return;
      }
      const plan = Planes.delPaciente(pac.id);
      const discs = Object.keys(plan).filter(d => (plan[d] || 0) > 0);
      if (discs.length === 0) {
        avisos.push(`${nombre}: es ambulatorio pero no tiene disciplinas en su plan semanal.`);
        return;
      }
      const bloq = _slotsBloqueadosPaciente(pac, estado, dia);
      const libres = [];
      for (let i = v.iIng; i <= v.iEgr; i++) if (!bloq[SLOTS[i].id]) libres.push(SLOTS[i].id);
      infos.push({ pac, nombre, discs, libres });
    });

  SLOTS.forEach(slot => {
    const necesitan = infos.filter(i => i.libres.includes(slot.id));
    if (necesitan.length === 0) return;
    // Nodos de profesionales: los de KTR pueden atender 2 pacientes (dual)
    const nodos = [];
    profs.filter(p => _disponibilidadProfSlot(p, estado, slot, fecha).ok).forEach(p => {
      nodos.push({ p, soloKtr: false });
      if ((p.disciplinas || []).includes('kinesiologiaRespiratoria')) nodos.push({ p, soloKtr: true });
    });
    // El segundo cupo de KTR (dual) exige paciente con edificio y que no bloquee KTR compartido
    const compatible = (info, nodo) => info.discs.some(d =>
      (nodo.p.disciplinas || []).includes(d) &&
      (!nodo.soloKtr || (d === 'kinesiologiaRespiratoria' && !!info.pac.edificio && !info.pac.bloqueaKTR)));

    // Matching bipartito (Kuhn): pacientes → nodos de profesional
    const asignadoA = new Array(nodos.length).fill(-1);
    const intentar = (i, vistos) => {
      for (let j = 0; j < nodos.length; j++) {
        if (vistos[j] || !compatible(necesitan[i], nodos[j])) continue;
        vistos[j] = true;
        if (asignadoA[j] < 0 || intentar(asignadoA[j], vistos)) { asignadoA[j] = i; return true; }
      }
      return false;
    };
    const sinProf = necesitan.filter((_, i) => !intentar(i, new Array(nodos.length).fill(false)));
    if (sinProf.length > 0) {
      avisos.push(`${slot.label}: ${necesitan.length} ambulatorio(s) presentes y faltan profesionales disponibles con ` +
        `disciplinas de su plan (sin cobertura posible: ${sinProf.map(i => i.nombre).join(', ')}).`);
    }
  });

  return avisos;
}
