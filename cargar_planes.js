// cargar_planes.js
// Pegá este script en la consola del navegador (F12 → Console) con la app abierta.
// Asigna un plan semanal a todos los pacientes activos.
// No modifica pacientes, profesionales ni disponibilidad.

(function () {
  const pacientes = JSON.parse(localStorage.getItem('rehab_pacientes') || '[]');

  if (pacientes.length === 0) {
    console.warn('No hay pacientes cargados.');
    return;
  }

  // Primera mitad → psicología  |  segunda mitad → neuropsicología
  const mitad = Math.ceil(pacientes.length / 2);

  const planesActuales = JSON.parse(localStorage.getItem('rehab_planes') || '{}');

  pacientes.forEach((p, i) => {
    const discExtra = i < mitad ? 'psicologia' : 'neuropsicologia';
    planesActuales[p.id] = {
      sesiones: {
        kinesiologia:              10,
        kinesiologiaRespiratoria:   5,
        fonoaudiologia:             5,
        [discExtra]:                5,
      },
      meta: null,
    };
  });

  localStorage.setItem('rehab_planes', JSON.stringify(planesActuales));

  if (typeof onDataChanged === 'function') onDataChanged();
  if (typeof renderVista   === 'function') renderVista();

  console.log(`✓ Planes cargados para ${pacientes.length} pacientes:`);
  pacientes.forEach((p, i) => {
    const extra = i < mitad ? 'psicología' : 'neuropsicología';
    console.log(`  ${i + 1}. ${p.apellido} → kinesio ×10 · KTR ×5 · fono ×5 · ${extra} ×5`);
  });
})();
