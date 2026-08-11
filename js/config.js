// config.js — Constantes globales de la aplicación

const DISCIPLINAS = {
  kinesiologia: {
    label: 'Kinesiología',
    corto: 'Kinesio',
    color: '#16a34a',
    bg: '#dcfce7',
    border: '#86efac'
  },
  kinesiologiaRespiratoria: {
    label: 'Kinesiología Respiratoria',
    corto: 'Kinesio Resp.',
    color: '#2563eb',
    bg: '#dbeafe',
    border: '#93c5fd'
  },
  fonoaudiologia: {
    label: 'Fonoaudiología',
    corto: 'Fono',
    color: '#d97706',
    bg: '#fef3c7',
    border: '#fcd34d'
  },
  terapiaOcupacional: {
    label: 'Terapia Ocupacional',
    corto: 'T. Ocup.',
    color: '#7c3aed',
    bg: '#ede9fe',
    border: '#c4b5fd'
  },
  neuropsicologia: {
    label: 'Neuropsicología',
    corto: 'Neuropsi.',
    color: '#dc2626',
    bg: '#fee2e2',
    border: '#fca5a5'
  },
  psicologia: {
    label: 'Psicología',
    corto: 'Psico',
    color: '#0891b2',
    bg: '#cffafe',
    border: '#67e8f9'
  },
  educacionFisica: {
    label: 'Educación Física',
    corto: 'Ed. Física',
    color: '#15803d',
    bg: '#bbf7d0',
    border: '#4ade80'
  },
  ingenieriaBiomedica: {
    label: 'Ingeniería Biomédica',
    corto: 'Ing. Biomédica',
    color: '#1e40af',
    bg: '#bfdbfe',
    border: '#60a5fa'
  },
  odontologia: {
    label: 'Odontología',
    corto: 'Odonto',
    color: '#be185d',
    bg: '#fce7f3',
    border: '#f9a8d4'
  },
  fisiatria: {
    label: 'Fisiatría',
    corto: 'Fisiatría',
    color: '#92400e',
    bg: '#fef3c7',
    border: '#fbbf24'
  },
  trabajoSocial: {
    label: 'Trabajo Social',
    corto: 'T. Social',
    color: '#065f46',
    bg: '#d1fae5',
    border: '#6ee7b7'
  },
  acompananteTerapeutica: {
    label: 'Acompañante Terapéutica',
    corto: 'Acomp. Terap.',
    color: '#6b21a8',
    bg: '#f3e8ff',
    border: '#d8b4fe'
  }
};

// Disciplinas que pueden cubrir almuerzo terapéutico cuando el paciente tiene
// "-elegir-" (sin disciplinas específicas configuradas). NO es "cualquier
// disciplina": limita a las que tiene sentido que acompañen un almuerzo.
const DISCIPLINAS_ALMUERZO_DEFAULT = [
  'fonoaudiologia', 'kinesiologiaRespiratoria', 'kinesiologia',
  'psicologia', 'neuropsicologia', 'terapiaOcupacional'
];

const SLOTS = [
  { id: 'slot_08', inicio: '08:00', fin: '09:00', label: '08:00 – 09:00', turno: 'manana', esAlmuerzo: false },
  { id: 'slot_09', inicio: '09:00', fin: '10:00', label: '09:00 – 10:00', turno: 'manana', esAlmuerzo: false },
  { id: 'slot_10', inicio: '10:00', fin: '11:00', label: '10:00 – 11:00', turno: 'manana', esAlmuerzo: false },
  { id: 'slot_11', inicio: '11:00', fin: '12:00', label: '11:00 – 12:00', turno: 'manana', esAlmuerzo: false },
  { id: 'slot_12', inicio: '12:00', fin: '13:00', label: '12:00 – 13:00', turno: 'almuerzo', esAlmuerzo: true },
  { id: 'slot_14', inicio: '14:00', fin: '15:00', label: '14:00 – 15:00', turno: 'tarde', esAlmuerzo: false },
  { id: 'slot_15', inicio: '15:00', fin: '16:00', label: '15:00 – 16:00', turno: 'tarde', esAlmuerzo: false },
  { id: 'slot_16', inicio: '16:00', fin: '17:00', label: '16:00 – 17:00', turno: 'tarde', esAlmuerzo: false },
  { id: 'slot_17', inicio: '17:00', fin: '18:00', label: '17:00 – 18:00', turno: 'tarde', esAlmuerzo: false },
  { id: 'slot_18', inicio: '18:00', fin: '19:00', label: '18:00 – 19:00', turno: 'tarde', esAlmuerzo: false }
];

const HORAS_OBJETIVO_DIA = 6;
const VENTANA_ROTACION_DIAS_ASISTENCIA = 3;
const VISITAS_MINIMAS_REFERENTE_SEMANA = 2;

// Grupos diagnósticos de pacientes
const GRUPOS_DIAGNOSTICOS = {
  tec:     { label: 'TEC',     color: '#7c3aed', bg: '#ede9fe', border: '#c4b5fd' },
  acv:     { label: 'ACV',     color: '#dc2626', bg: '#fee2e2', border: '#fca5a5' },
  medular: { label: 'Medular', color: '#0891b2', bg: '#cffafe', border: '#67e8f9' }
};

// Nivel de asistencia para transferencias — define la prioridad de scheduling
// (mayor prioridad = se asigna antes cuando hay recursos limitados)
const TRANSFERENCIAS = {
  asistenciaCompleta: { label: 'Asistencia completa',  prioridad: 4 },
  mediaAsistencia:    { label: 'Media asistencia',     prioridad: 3 },
  minimaAsistencia:   { label: 'Mínima asistencia',   prioridad: 2 },
  grua:               { label: 'Grúa',                 prioridad: 1 }
};

const STORAGE_KEYS = {
  pacientes:      'rehab_pacientes',
  profesionales:  'rehab_profesionales',
  planes:         'rehab_planes',
  diasState:      'rehab_dias_state',
  asignaciones:   'rehab_asignaciones',
  historial:      'rehab_historial',
  auditoria:      'rehab_auditoria'
};
