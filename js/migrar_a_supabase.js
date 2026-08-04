// migrar_a_supabase.js — Carga única de los datos exportados (JSON) a Supabase
//
// Se usa una sola vez, desde migrar.html, para subir el backup exportado con
// el botón "⬇ Exportar" de la app actual (basada en localStorage) hacia las
// tablas de Supabase. Después de esto, la app ya trabaja 100% contra Supabase.

async function migrarJSONASupabase(exportacion, log) {
  const d = exportacion.datos ?? exportacion;
  log('Iniciando migración...');

  const pacientes     = d.pacientes     || [];
  const profesionales = d.profesionales || [];
  const planes        = d.planes        || {};
  const diasState     = d.diasState     || {};
  const asignaciones  = d.asignaciones   || {};
  const historial     = d.historial      || [];
  const auditoria     = d.auditoria      || [];

  if (pacientes.length) {
    const { error } = await supabaseClient.from('pacientes')
      .upsert(pacientes.map(p => ({ id: p.id, data: p })));
    if (error) throw new Error('pacientes: ' + error.message);
  }
  log(`Pacientes: ${pacientes.length} migrados.`);

  if (profesionales.length) {
    const { error } = await supabaseClient.from('profesionales')
      .upsert(profesionales.map(p => ({ id: p.id, data: p })));
    if (error) throw new Error('profesionales: ' + error.message);
  }
  log(`Profesionales: ${profesionales.length} migrados.`);

  const filasPlanes = Object.entries(planes).map(([pacienteId, v]) => ({
    paciente_id: pacienteId,
    sesiones: v.sesiones ?? v,
    meta: v.meta ?? null
  }));
  if (filasPlanes.length) {
    const { error } = await supabaseClient.from('planes').upsert(filasPlanes);
    if (error) throw new Error('planes: ' + error.message);
  }
  log(`Planes: ${filasPlanes.length} migrados.`);

  const filasDias = Object.entries(diasState).map(([fecha, data]) => ({ fecha, data }));
  if (filasDias.length) {
    const { error } = await supabaseClient.from('dias_state').upsert(filasDias);
    if (error) throw new Error('dias_state: ' + error.message);
  }
  log(`Estados de día: ${filasDias.length} migrados.`);

  const filasAsig = Object.entries(asignaciones).map(([fecha, sesiones]) => ({ fecha, sesiones }));
  if (filasAsig.length) {
    const { error } = await supabaseClient.from('asignaciones').upsert(filasAsig);
    if (error) throw new Error('asignaciones: ' + error.message);
  }
  log(`Días con agenda: ${filasAsig.length} migrados.`);

  if (historial.length) {
    const filasHist = historial.map(h => ({
      fecha: h.fecha, profesional_id: h.profesionalId, paciente_id: h.pacienteId, disciplina: h.disciplina
    }));
    // Insertar en tandas de 500 para no exceder límites del request
    for (let i = 0; i < filasHist.length; i += 500) {
      const { error } = await supabaseClient.from('historial').insert(filasHist.slice(i, i + 500));
      if (error) throw new Error('historial: ' + error.message);
    }
  }
  log(`Historial: ${historial.length} registros migrados.`);

  if (auditoria.length) {
    const { error } = await supabaseClient.from('auditoria')
      .upsert(auditoria.map(a => ({ id: a.id, timestamp: a.timestamp, data: a })));
    if (error) throw new Error('auditoria: ' + error.message);
  }
  log(`Auditoría: ${auditoria.length} registros migrados.`);

  log('✔ Migración completa.');
}
