// completar_apellidos.js
// Pegá este script en la consola del navegador (F12 → Console) con la app abierta y con sesión de admin.
// Reemplaza el apellido abreviado de cada paciente ("Ovi", "Dip", ...) por el apellido completo
// de la lista de abajo, con la primera letra en mayúscula y el resto en minúscula.
// Solo modifica el campo "apellido": el nombre (inicial) y el resto de los datos no se tocan.
//
// Cómo decide a qué paciente corresponde cada apellido:
//   1. Compara las primeras letras (sin tildes, mayúsculas ni espacios): "Dip" ↔ "DI PAOLA".
//   2. Si la lista trae inicial ("OVIEDO G"), solo considera pacientes cuyo nombre empiece con esa letra.
//   3. Si sigue habiendo más de un paciente posible, te pregunta cuál es.
// Antes de guardar muestra una tabla con los cambios y pide confirmación.

(function () {
  const lista = [
    'OVIEDO G', 'VILLARREAL', 'CUASSOLO', 'LAZARO', 'OMARINI', 'OVIEDO P', 'GALIANO',
    'MORILLA', 'DI PAOLA', 'STORERO', 'CEBALLOS', 'ABBA', 'CÁCERES', 'MARTINI', 'PAGES',
    'MUÑOZ', 'EIER', 'GRANDE', 'GASTALDI', 'MUZZIO', 'OLMOS', 'AQUINO', 'BIURRUN', 'PASCUAL',
  ];

  // minúsculas, sin tildes ni espacios/puntos. Un carácter roto (�) queda como '?' (comodín).
  const norm = s => (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s.]/g, '')
    .replace(/[^a-z?]/g, '?');

  const coincidePrefijo = (abreviado, completo) =>
    abreviado.length > 0 && abreviado.length <= completo.length &&
    [...abreviado].every((c, i) => c === '?' || c === completo[i]);

  const capitalizar = s => s.trim().toLowerCase().split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const pacientes = Pacientes.todos();
  const tomados = new Set();
  const cambios = [];
  const sinPaciente = [];

  // "OVIEDO G" → { completo: 'oviedo', inicial: 'g', visible: 'Oviedo' }; "DI PAOLA" no lleva inicial.
  const entradas = lista.map(raw => {
    const partes = raw.trim().split(/\s+/);
    const traeInicial = partes.length > 1 && partes[partes.length - 1].length === 1;
    const apellido = (traeInicial ? partes.slice(0, -1) : partes).join(' ');
    return {
      raw: raw.trim(),
      visible: capitalizar(apellido),
      completo: norm(apellido),
      inicial: traeInicial ? norm(partes[partes.length - 1]) : null,
    };
  });

  const describir = p => `${p.apellido} ${p.nombre || ''}`.trim() + (p.egresado ? ' (egresado)' : '');

  // Primero las entradas con menos candidatos, así las ambiguas se resuelven al final con más información.
  const candidatosDe = e => pacientes.filter(p =>
    coincidePrefijo(norm(p.apellido), e.completo) &&
    (!e.inicial || norm(p.nombre).charAt(0) === e.inicial));

  entradas
    .map(e => ({ e, n: candidatosDe(e).length }))
    .sort((a, b) => a.n - b.n)
    .forEach(({ e }) => {
      const candidatos = candidatosDe(e).filter(p => !tomados.has(p.id));
      let elegido = null;

      if (candidatos.length === 1) {
        elegido = candidatos[0];
      } else if (candidatos.length > 1) {
        const opciones = candidatos.map((p, i) => `  ${i + 1}) ${describir(p)}`).join('\n');
        const resp = prompt(`"${e.raw}" puede ser más de un paciente:\n${opciones}\n\nEscribí el número (o dejá vacío para saltearlo):`);
        const idx = parseInt(resp, 10) - 1;
        if (candidatos[idx]) elegido = candidatos[idx];
      }

      if (!elegido) { sinPaciente.push(e.raw); return; }
      tomados.add(elegido.id);
      cambios.push({ id: elegido.id, antes: describir(elegido), apellido: e.visible });
    });

  if (cambios.length === 0) { console.warn('No se encontró ningún paciente para actualizar.'); return; }

  console.table(cambios.map(c => ({ 'Perfil actual': c.antes, 'Apellido nuevo': c.apellido })));
  const sinCambio = pacientes.filter(p => !tomados.has(p.id)).map(describir);
  if (sinCambio.length) console.log('Pacientes que NO están en la lista (se dejan igual):', sinCambio.join(', '));
  if (sinPaciente.length) console.warn('Apellidos de la lista sin paciente asignado:', sinPaciente.join(', '));

  if (!confirm(`Se van a actualizar ${cambios.length} apellidos (ver tabla en la consola). ¿Aplicar?`)) {
    console.log('Cancelado, no se modificó nada.');
    return;
  }

  cambios.forEach(c => Pacientes.actualizar(c.id, { apellido: c.apellido }));
  if (typeof renderVista === 'function') renderVista();
  console.log(`✓ ${cambios.length} apellidos actualizados.`);
})();
