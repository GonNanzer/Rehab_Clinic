// ============================================================
// datos_prueba.js
// Pegar en la consola del navegador con la app abierta.
// Crea 60 profesionales (10 por disciplina) y 25 pacientes.
// ============================================================

(function () {

  // ── Claves de storage (deben coincidir con config.js) ───────────────────
  const KEYS = {
    pacientes:    'rehab_pacientes',
    profesionales:'rehab_profesionales',
    planes:       'rehab_planes',
    diasState:    'rehab_dias_state',
    asignaciones: 'rehab_asignaciones',
    historial:    'rehab_historial',
    auditoria:    'rehab_auditoria'
  };

  const DISCIPLINAS_ALMUERZO_DEFAULT = ['fonoaudiologia', 'terapiaOcupacional'];

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function hoy() {
    return new Date().toISOString().split('T')[0];
  }

  if (!confirm('Esto REEMPLAZARÁ todos los datos existentes. ¿Continuar?')) {
    console.log('Cancelado.');
    return;
  }

  // Limpiar todo
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  console.log('Storage limpiado.');

  // ── 1. Profesionales: 10 por disciplina ─────────────────────────────────

  const disciplinas = [
    { key: 'kinesiologia',               prefijo: 'Kinesio'    },
    { key: 'kinesiologiaRespiratoria',   prefijo: 'KinRespir'  },
    { key: 'fonoaudiologia',             prefijo: 'Fono'       },
    { key: 'terapiaOcupacional',         prefijo: 'TO'         },
    { key: 'neuropsicologia',            prefijo: 'Neuropsi'   },
    { key: 'psicologia',                 prefijo: 'Psico'      }
  ];

  const profesionales = [];

  disciplinas.forEach(({ key, prefijo }) => {
    for (let i = 1; i <= 10; i++) {
      profesionales.push({
        id:         genId(),
        activo:     true,
        nombre:     `${prefijo}_${i}`,
        apellido:   '',               // apellido vacío para mantener nombre corto en grilla
        disciplinas: [key]
      });
    }
  });

  // Algunos profesionales con doble disciplina
  const kinesioProfs = profesionales.filter(p => p.disciplinas[0] === 'kinesiologia');
  kinesioProfs.slice(0, 3).forEach(p => {
    p.disciplinas = ['kinesiologia', 'kinesiologiaRespiratoria'];
    p.nombre = p.nombre + '+KR';
  });

  // Asignar grupos de preferencia distribuidos entre profesionales
  const grupos = ['tec', 'acv', 'medular'];
  profesionales.forEach((p, i) => {
    p.grupoPreferencia = grupos[i % grupos.length];
  });

  localStorage.setItem(KEYS.profesionales, JSON.stringify(profesionales));
  console.log(`✓ ${profesionales.length} profesionales creados.`);

  // Construir índice: disciplina → array de IDs de profesionales
  const profsPorDisc = {};
  disciplinas.forEach(({ key }) => {
    profsPorDisc[key] = profesionales
      .filter(p => p.disciplinas.includes(key))
      .map(p => p.id);
  });

  // ── 2. Pacientes: 25 ─────────────────────────────────────────────────────

  // Combinaciones de disciplinas requeridas (variedad clínica)
  const combinacionesDisciplinas = [
    ['kinesiologia', 'fonoaudiologia', 'terapiaOcupacional'],
    ['kinesiologia', 'neuropsicologia', 'psicologia'],
    ['kinesiologiaRespiratoria', 'fonoaudiologia', 'neuropsicologia'],
    ['kinesiologia', 'terapiaOcupacional', 'psicologia'],
    ['kinesiologia', 'kinesiologiaRespiratoria', 'fonoaudiologia'],
    ['fonoaudiologia', 'terapiaOcupacional', 'neuropsicologia'],
    ['kinesiologia', 'fonoaudiologia', 'neuropsicologia', 'psicologia'],
    ['kinesiologiaRespiratoria', 'terapiaOcupacional', 'psicologia'],
    ['kinesiologia', 'neuropsicologia'],
    ['fonoaudiologia', 'terapiaOcupacional'],
    ['kinesiologia', 'kinesiologiaRespiratoria', 'neuropsicologia'],
    ['kinesiologia', 'fonoaudiologia', 'terapiaOcupacional', 'psicologia'],
  ];

  const pacientes = [];

  for (let i = 1; i <= 25; i++) {
    // Rotar combinaciones
    const discs = combinacionesDisciplinas[(i - 1) % combinacionesDisciplinas.length];

    // Grupo diagnóstico y transferencias variados
    const gruposSeq = ['tec','acv','medular','tec','acv','medular','tec','acv','medular',
                       'tec','acv','medular','tec','acv','medular','tec','acv','medular',
                       'tec','acv','medular','tec','acv','medular','tec'];
    const transfSeq = ['minimaAsistencia','mediaAsistencia','asistenciaCompleta','grua',
                       'minimaAsistencia','grua','mediaAsistencia','asistenciaCompleta',
                       'grua','minimaAsistencia','mediaAsistencia','grua','asistenciaCompleta',
                       'minimaAsistencia','mediaAsistencia','grua','asistenciaCompleta',
                       'minimaAsistencia','mediaAsistencia','asistenciaCompleta','grua',
                       'mediaAsistencia','minimaAsistencia','grua','asistenciaCompleta'];
    const grupo = gruposSeq[(i - 1)] || 'tec';
    const transferencias = transfSeq[(i - 1)] || 'minimaAsistencia';

    // Almuerzo terapéutico: ~40% de pacientes
    const requiereAlmuerzo = i % 3 === 0; // pacientes 3,6,9,12,15,18,21,24

    // Referentes: primer profesional de cada disciplina requerida
    const referentes = {};
    discs.forEach((disc, idx) => {
      const pool = profsPorDisc[disc] || [];
      if (pool.length > 0) {
        // Distribuir referentes entre profesionales para no sobrecargar al primero
        referentes[disc] = pool[i % Math.min(pool.length, 4)];
      }
    });

    const habitacionNum = 100 + i;
    const dias = Math.floor(Math.random() * 60) + 1;
    const fechaIngreso = new Date();
    fechaIngreso.setDate(fechaIngreso.getDate() - dias);

    pacientes.push({
      id:       genId(),
      activo:   true,
      nombre:   `Paciente_${i}`,
      apellido: `Apellido_${i}`,
      habitacion: `${habitacionNum}`,
      fechaIngreso: fechaIngreso.toISOString().split('T')[0],
      grupo,
      transferencias,
      disciplinasRequeridas: discs,
      requiereAlmuerzoTerapeutico: requiereAlmuerzo,
      disciplinasAlmuerzo: DISCIPLINAS_ALMUERZO_DEFAULT,
      referentes
    });
  }

  localStorage.setItem(KEYS.pacientes, JSON.stringify(pacientes));
  console.log(`✓ ${pacientes.length} pacientes creados.`);

  // ── 3. Planes semanales ───────────────────────────────────────────────────

  const planes = {};
  const sesionesPorDiscDefecto = {
    kinesiologia:              5,
    kinesiologiaRespiratoria:  4,
    fonoaudiologia:            4,
    terapiaOcupacional:        3,
    neuropsicologia:           2,
    psicologia:                2
  };

  pacientes.forEach(pac => {
    const plan = {};
    pac.disciplinasRequeridas.forEach(disc => {
      plan[disc] = sesionesPorDiscDefecto[disc] || 3;
    });
    planes[pac.id] = plan;
  });

  localStorage.setItem(KEYS.planes, JSON.stringify(planes));
  console.log(`✓ Planes semanales creados para ${pacientes.length} pacientes.`);

  // ── 4. Estado del día de hoy: todos los profesionales presentes ──────────

  const fechaHoy = hoy();
  const diasState = {};
  diasState[fechaHoy] = {
    fecha: fechaHoy,
    profesionalesPresentes: profesionales.map(p => p.id),
    bloquesPacientes: {},
    prescripcionesUrgentes: {},
    generadoEn: null
  };

  // Ejemplo de bloqueos: primeros 5 pacientes tienen un bloqueo cada uno
  for (let i = 0; i < 5; i++) {
    const slots = ['slot_09','slot_10','slot_11','slot_14','slot_15'];
    diasState[fechaHoy].bloquesPacientes[pacientes[i].id] = [
      { slotId: slots[i], motivo: ['Higiene','Enfermería','Baño','Estudio','Control médico'][i] }
    ];
  }

  localStorage.setItem(KEYS.diasState, JSON.stringify(diasState));
  console.log(`✓ Disponibilidad del día ${fechaHoy} configurada (todos presentes, 5 bloqueos de ejemplo).`);

  // ── Resumen ───────────────────────────────────────────────────────────────

  console.log('\n════════════════════════════════');
  console.log(`✅ Datos de prueba cargados`);
  console.log(`   ${profesionales.length} profesionales (10 por disciplina)`);
  console.log(`   ${pacientes.length} pacientes`);
  console.log(`   Todos los profesionales están presentes hoy`);
  console.log(`   5 bloqueos de ejemplo cargados`);
  console.log('\n📌 Siguiente paso:');
  console.log('   Recargá la página (F5) y luego generá la agenda del día.');
  console.log('════════════════════════════════\n');

  alert('✅ Datos cargados correctamente.\n\nRecargá la página (F5) y luego ir a "Agenda del día" → "⚡ Generar agenda".');

})();
