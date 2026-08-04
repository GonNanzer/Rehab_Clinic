// cargar_pacientes.js
// Pegá este script en la consola del navegador (F12 → Console) con la app abierta.
// Borra TODOS los pacientes actuales y sus planes, y carga la lista nueva.
// Profesionales, disponibilidad y auditoría NO se modifican.

(function () {
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const apellidos = [
    'OVIEDO G',
    'VILLARREAL',
    'CUASSOLO',
    'LAZARO',
    'MONTIVERO',
    'OVIEDO P',
    'OMARINI',
    'GALIANO',
    'VICENTE',
    'MARIONI',
    'MORILLA',
    'DI PAOLA',
    'GOMEZ',
    'STORERO',
    'CEBALLOS',
    'PREITE',
    'ABBA',
    'CÁCERES',
    'AQUINO',
    'BIURRUN',
    'PASCUAL',
  ];

  const pacientes = apellidos.map(apellido => ({
    id:                          genId(),
    activo:                      true,
    fechaIngreso:                new Date().toISOString().split('T')[0],
    apellido:                    apellido,
    nombre:                      '',
    edificio:                    null,
    grupo:                       null,
    diasHorarioAmbulatorio:      [],
    transferencias:              null,
    disciplinasRequeridas:       [],
    limitesDiarios:              {},
    bloqueaKTR:                  false,
    bloqueosPermanentes:         [],
    requiereHigiene:             false,
    disciplinaHigiene:           null,
    requiereAlmuerzoTerapeutico: false,
    disciplinasAlmuerzo:         ['fonoaudiologia', 'terapiaOcupacional'],
    referentes:                  {},
  }));

  localStorage.setItem('rehab_pacientes', JSON.stringify(pacientes));
  localStorage.setItem('rehab_planes',    JSON.stringify({}));
  localStorage.removeItem('rehab_asignaciones');
  localStorage.removeItem('rehab_historial');

  if (typeof onDataChanged === 'function') onDataChanged();
  if (typeof renderVista   === 'function') renderVista();

  console.log(`✓ ${pacientes.length} pacientes cargados:`);
  pacientes.forEach((p, i) => console.log(`  ${i + 1}. ${p.apellido}`));
  console.log('\nSi la vista no se actualizó sola, recargá la página (F5).');
})();
