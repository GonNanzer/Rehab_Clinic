// ─── Exportación PDF ─────────────────────────────────────────────────────────

function _pdf_buildDoc(sesiones, fecha, titulo, opciones) {
  opciones = opciones || {};

  const pacientes = Pacientes.activos()
    .sort(function(a, b) { return Pacientes.scorePrioridad(b) - Pacientes.scorePrioridad(a); });

  const estado = DiasState.delDia(fecha);

  // Profesionales libres por slot
  var libresBySlot = {};
  SLOTS.forEach(function(s) { libresBySlot[s.id] = []; });

  if (opciones.mostrarDisponibles !== false) {
    var idsPresentes = estado.profesionalesPresentes || [];
    var idsExcluidos = estado.profesionalesExcluidos  || [];
    var diaNum = _weekday(fecha);
    var profsPresentes = Profesionales.todos().filter(function(p) {
      return p.activo !== false && idsPresentes.includes(p.id) && !idsExcluidos.includes(p.id);
    });
    var busyBySlot = {};
    SLOTS.forEach(function(s) {
      busyBySlot[s.id] = new Set(sesiones.filter(function(x) { return x.slotId === s.id; }).map(function(x) { return x.profesionalId; }));
    });
    SLOTS.forEach(function(slot) {
      if (slot.esAlmuerzo) return;
      libresBySlot[slot.id] = profsPresentes.filter(function(p) {
        if (busyBySlot[slot.id].has(p.id)) return false;
        var horarios = (p.horariosPorDia || {})[diaNum];
        if (horarios && horarios.length > 0 && !horarios.includes(slot.id)) return false;
        return true;
      });
    });
  }
  var hayDisponibles = Object.values(libresBySlot).some(function(arr) { return arr.length > 0; });

  // Déficits
  var alertas = [];
  pacientes.forEach(function(p) {
    var mis = sesiones.filter(function(s) { return s.pacienteId === p.id; });
    if (mis.length < HORAS_OBJETIVO_DIA) {
      alertas.push(esc(p.apellido) + ': ' + mis.length + '/' + HORAS_OBJETIVO_DIA + 'h');
    }
  });

  // ── Construir tabla ───────────────────────────────────────────────────────

  var thSlots = SLOTS.map(function(s) {
    if (s.esAlmuerzo) return '<th style="background:#f0f4f8;color:#94a3b8">' + esc(s.label) + '</th>';
    return '<th>' + esc(s.label) + '</th>';
  }).join('');

  var tbody = '';

  // Fila disponibles
  if (hayDisponibles) {
    var dispCeldas = SLOTS.map(function(slot) {
      var libres = libresBySlot[slot.id] || [];
      var bg = 'background:#f8fafc;';
      if (libres.length === 0) return '<td style="' + bg + '"></td>';
      var chips = libres.map(function(p) {
        var disc0 = (p.disciplinas || [])[0];
        var dc = disc0 ? DISCIPLINAS[disc0] : null;
        var st = dc
          ? 'background:' + dc.bg + ';color:' + dc.color + ';border-color:' + dc.border
          : 'background:#e0f2fe;color:#0369a1;border-color:#7dd3fc';
        return '<span style="' + st + ';display:inline-block;border:1px solid;border-radius:3px;font-size:6px;font-weight:700;padding:1px 2px;margin:1px;line-height:1.3">'
          + esc(Profesionales.iniciales(p)) + '</span>';
      }).join('');
      return '<td style="' + bg + '">' + chips + '</td>';
    }).join('');
    tbody += '<tr>'
      + '<td style="text-align:left;padding:3px 5px;font-style:italic;color:#64748b;font-size:7px">Disponibles</td>'
      + dispCeldas
      + '<td style="background:#f8fafc"></td>'
      + '</tr>';
  }

  // Filas de pacientes
  pacientes.forEach(function(pac) {
    var misSes = sesiones.filter(function(s) { return s.pacienteId === pac.id; });
    var grupo = GRUPOS_DIAGNOSTICOS && GRUPOS_DIAGNOSTICOS[pac.grupo];
    var bloqueados = new Set(
      ((estado.bloquesPacientes || {})[pac.id] || []).map(function(b) { return b.slotId; }).concat(
      (pac.bloqueosPermanentes || []).map(function(b) { return b.slotId; }))
    );

    var grupoSpan = grupo
      ? '<span style="display:inline-block;font-size:6px;padding:1px 3px;border-radius:3px;background:'
        + grupo.bg + ';color:' + grupo.color + ';border:1px solid ' + grupo.border + ';margin-top:1px">'
        + esc(grupo.label) + '</span>'
      : '';

    var celdas = SLOTS.map(function(slot) {
      var ses = misSes.find(function(s) { return s.slotId === slot.id; });
      if (ses) {
        var disc  = DISCIPLINAS[ses.disciplina];
        var prof  = Profesionales.porId(ses.profesionalId);
        var bg    = disc ? disc.bg    : '#f0f0f0';
        var color = disc ? disc.color : '#333';
        var corto = disc ? disc.corto : ses.disciplina;
        return '<td style="background:' + bg + ';border-left:3px solid ' + color + ';padding:2px 3px">'
          + '<span style="color:' + color + ';font-weight:700;font-size:8px;display:block;line-height:1.2">' + esc(corto) + '</span>'
          + '<span style="font-size:6.5px;display:block;opacity:0.75;line-height:1.2">' + esc(prof ? Profesionales.iniciales(prof) : '?') + '</span>'
          + '</td>';
      }
      if (bloqueados.has(slot.id)) {
        return '<td style="color:#dc2626;font-size:10px;text-align:center">✕</td>';
      }
      if (slot.esAlmuerzo && (pac.almuerza ?? (pac.requiereAlmuerzoTerapeutico || false)) && !pac.requiereAlmuerzoTerapeutico) {
        return '<td style="color:#94a3b8;background:#f8fafc;font-size:8px">—</td>';
      }
      return '<td></td>';
    }).join('');

    tbody += '<tr>'
      + '<td style="text-align:left;padding:3px 5px;vertical-align:middle">'
      +   '<div style="font-weight:600;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(pac.apellido) + ', ' + esc(pac.nombre) + '</div>'
      +   grupoSpan
      + '</td>'
      + celdas
      + '<td style="font-weight:700;font-size:8px;color:#334155;text-align:center">' + misSes.length + '</td>'
      + '</tr>';
  });

  var tabla = '<table>'
    + '<thead><tr>'
    + '<th style="text-align:left;min-width:80px">Paciente</th>'
    + thSlots
    + '<th style="width:24px">H</th>'
    + '</tr></thead>'
    + '<tbody>' + tbody + '</tbody>'
    + '</table>';

  var alertasHtml = alertas.length > 0
    ? '<div style="margin-top:8px;font-size:8px;color:#92400e;background:#fffbeb;border:1px solid #fbbf24;padding:5px 8px;border-radius:4px">'
      + '⚠ Déficit de horas: ' + alertas.join(' · ') + '</div>'
    : '';

  var ahora = new Date().toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  var extraHtml = opciones.extraHtml || '';
  var nSes = sesiones.length;

  return '<!DOCTYPE html>\n'
    + '<html lang="es">\n<head>\n'
    + '  <meta charset="UTF-8">\n'
    + '  <title>' + titulo + '</title>\n'
    + '  <style>\n'
    + '    @page { size: A4 portrait; margin: 12mm 10mm; }\n'
    + '    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; margin: 0; padding: 0; }\n'
    + '    body { font-family: \'Segoe UI\', system-ui, -apple-system, sans-serif; font-size: 9px; color: #1e293b; background: #fff; }\n'
    + '    h1 { font-size: 13px; font-weight: 700; margin: 0 0 2px; color: #1e293b; }\n'
    + '    .meta { font-size: 7.5px; color: #64748b; margin: 0 0 6px; }\n'
    + '    table { width: 100%; border-collapse: collapse; }\n'
    + '    th { background: #f1f5f9; color: #475569; font-weight: 600; padding: 4px 3px; border: 1px solid #cbd5e1; text-align: center; font-size: 7px; white-space: nowrap; }\n'
    + '    td { border: 1px solid #e2e8f0; vertical-align: middle; text-align: center; }\n'
    + '    tr:nth-child(even) td:first-child { background: #fafafa; }\n'
    + '  </style>\n'
    + '</head>\n<body>\n'
    + '  <h1>' + titulo + '</h1>\n'
    + '  <p class="meta">Generado el ' + ahora + ' &nbsp;·&nbsp; ' + nSes + ' sesiones</p>\n'
    + (extraHtml ? '  <div style="margin-bottom:6px">' + extraHtml + '</div>\n' : '')
    + '  ' + tabla + '\n'
    + '  ' + alertasHtml + '\n'
    + '  <script>window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };<\/script>\n'
    + '</body>\n</html>';
}

function exportarGrillaPDF() {
  var sesiones = Asignaciones.delDia(fechaActiva);
  var titulo   = 'Agenda · ' + formatFecha(fechaActiva);
  var doc      = _pdf_buildDoc(sesiones, fechaActiva, titulo, { mostrarDisponibles: true });
  var ventana  = window.open('', '_blank', 'width=900,height=700');
  ventana.document.open();
  ventana.document.write(doc);
  ventana.document.close();
}

function exportarOpcionPDF(idx) {
  var candidatos = window._compCandidatos;
  var fecha      = window._compFecha;
  if (!candidatos || !fecha) return;
  var c = candidatos[idx];
  var titulo = 'Opción ' + (idx + 1) + ' · Índice ' + c.indice.score + '% · ' + formatFecha(fecha);

  var detalles = (c.indice.detallesPacientes || []).map(function(d) {
    var color = d.pct >= 90 ? '#16a34a' : d.pct >= 60 ? '#d97706' : '#dc2626';
    return '<span style="color:' + color + ';margin-right:8px;font-size:8px">'
      + esc(d.nombre.split(' ')[0]) + ': ' + d.pct + '%</span>';
  }).join('');

  var doc = _pdf_buildDoc(c.sesiones, fecha, titulo, {
    mostrarDisponibles: false,
    extraHtml: detalles
  });
  var ventana = window.open('', '_blank', 'width=900,height=700');
  ventana.document.open();
  ventana.document.write(doc);
  ventana.document.close();
}

function exportarListaProfPDF() {
  var prof = Profesionales.porId(profSeleccionadoLista);
  if (!prof) return;

  var sesiones = Asignaciones.delDia(fechaActiva).filter(function(s) { return s.profesionalId === prof.id; });
  var dw       = _weekday(fechaActiva);
  var horarios = (prof.horariosPorDia || {})[dw] || [];
  var enHorario = function(slot) { return horarios.length === 0 || horarios.includes(slot.id); };

  var discsLabel = (prof.disciplinas || []).map(function(d) { return DISCIPLINAS[d] ? DISCIPLINAS[d].label : d; }).join(', ');
  var fechaLabel = new Date(fechaActiva + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  var ahora = new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  var filas = '';
  SLOTS.forEach(function(slot) {
    var ses = sesiones.find(function(s) { return s.slotId === slot.id; });

    if (ses) {
      var pac   = Pacientes.porId(ses.pacienteId);
      var disc  = DISCIPLINAS[ses.disciplina];
      var grupo = GRUPOS_DIAGNOSTICOS && GRUPOS_DIAGNOSTICOS[pac && pac.grupo];
      var bg    = disc ? disc.bg    : '#f0f0f0';
      var color = disc ? disc.color : '#333';
      var corto = disc ? disc.corto : ses.disciplina;
      filas += '<tr style="border-bottom:1px solid #f1f5f9">'
        + '<td style="white-space:nowrap;font-size:9px;color:#64748b;padding:8px 10px;width:120px">' + esc(slot.label) + '</td>'
        + '<td style="padding:8px 6px;width:72px"><span style="background:' + bg + ';color:' + color + ';border:1px solid ' + color + ';border-radius:4px;font-size:8px;font-weight:700;padding:2px 6px">' + esc(corto) + '</span></td>'
        + '<td style="padding:8px 6px;font-size:11px;font-weight:600">' + (ses.esAlmuerzo ? '🍽 ' : '') + esc(pac ? pac.apellido + ', ' + pac.nombre : '?') + '</td>'
        + '<td style="padding:8px 6px;font-size:9px;color:#64748b">' + (grupo ? grupo.label : '') + '</td>'
        + '</tr>';
    } else if (slot.esAlmuerzo) {
      filas += '<tr style="background:#f8fafc;border-bottom:1px solid #f1f5f9">'
        + '<td style="font-size:9px;color:#94a3b8;padding:8px 10px">' + esc(slot.label) + '</td>'
        + '<td colspan="3" style="font-size:9px;color:#94a3b8;font-style:italic;padding:8px 6px">🍽 Almuerzo</td>'
        + '</tr>';
    } else if (enHorario(slot)) {
      filas += '<tr style="border-bottom:1px solid #f8fafc">'
        + '<td style="font-size:9px;color:#94a3b8;padding:7px 10px">' + esc(slot.label) + '</td>'
        + '<td colspan="3" style="font-size:9px;color:#cbd5e1;font-style:italic;padding:7px 6px">libre</td>'
        + '</tr>';
    }
  });

  var doc = '<!DOCTYPE html>\n<html lang="es">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<title>Agenda — ' + esc(prof.apellido) + '</title>\n'
    + '<style>\n'
    + '@page { size: A4 portrait; margin: 20mm 18mm; }\n'
    + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; margin: 0; padding: 0; }\n'
    + 'body { font-family: \'Segoe UI\', system-ui, sans-serif; color: #1e293b; background: #fff; }\n'
    + 'h1 { font-size: 17px; font-weight: 700; margin-bottom: 3px; }\n'
    + '.meta { font-size: 9px; color: #64748b; margin-bottom: 18px; line-height: 1.6; }\n'
    + 'table { width: 100%; border-collapse: collapse; }\n'
    + '</style>\n'
    + '</head>\n<body>\n'
    + '<h1>' + esc(prof.apellido) + ', ' + esc(prof.nombre) + '</h1>\n'
    + '<div class="meta">' + esc(discsLabel) + '<br>' + esc(fechaLabel) + '<br>Generado el ' + ahora + ' &nbsp;&middot;&nbsp; ' + sesiones.length + ' sesiones</div>\n'
    + '<table><tbody>' + filas + '</tbody></table>\n'
    + '<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>\n'
    + '</body>\n</html>';

  var ventana = window.open('', '_blank', 'width=700,height=900');
  ventana.document.open();
  ventana.document.write(doc);
  ventana.document.close();
}
