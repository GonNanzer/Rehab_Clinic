// configurar_limites.js
// Pegá este script en la consola del navegador (F12 → Console) con la app abierta.
// Pone límite diario de 2 sesiones por disciplina a cada paciente,
// según las disciplinas activas en su plan semanal.
// No modifica los planes ni ningún otro dato.

(function () {
  const pacientes = JSON.parse(localStorage.getItem('rehab_pacientes') || '[]');
  const planesRaw = JSON.parse(localStorage.getItem('rehab_planes')    || '{}');

  if (pacientes.length === 0) { console.warn('No hay pacientes.'); return; }

  let modificados = 0;

  pacientes.forEach(p => {
    const entry   = planesRaw[p.id];
    const sesiones = entry?.sesiones ?? entry ?? {};
    const discsActivas = Object.keys(sesiones).filter(d => (sesiones[d] || 0) > 0);

    if (discsActivas.length === 0) return;

    const limitesDiarios = {};
    discsActivas.forEach(d => { limitesDiarios[d] = 2; });

    p.limitesDiarios = limitesDiarios;
    modificados++;
  });

  localStorage.setItem('rehab_pacientes', JSON.stringify(pacientes));

  if (typeof onDataChanged === 'function') onDataChanged();
  if (typeof renderVista   === 'function') renderVista();

  console.log(`✓ Límites configurados para ${modificados} pacientes (2 sesiones/día por disciplina):`);
  pacientes.forEach(p => {
    const discs = Object.keys(p.limitesDiarios || {});
    if (discs.length) console.log(`  ${p.apellido}: ${discs.join(', ')}`);
  });
})();
