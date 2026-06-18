/* ═══════════════════════════════════════════════════════════════════════
   adf-import.js — Lector multiformato de archivos ADF (Excel)
   Reconoce automáticamente:
     • Plantilla Sopraval / cualquier tabla con encabezados (carga masiva)
     • Formato ANTIGUO  → hoja "Registro" (bitácora tabular)  y  hoja "ADF" (ficha A3 SIGAS)
     • Formato NUEVO    → "REPORTE DE AVERÍA" + "PLANES DE ACCIÓN" (ficha A3 estándar v3)
   Devuelve registros normalizados; app.js los convierte al esquema Firestore.
   Expone: window.ADFImport.leer(workbook) -> { formato, registros, aviso }
   ═══════════════════════════════════════════════════════════════════════ */
(function(global){
  'use strict';
  var XLSX = global.XLSX;

  function norm(s){ return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }
  function splitMulti(v){ return String(v==null?'':v).split('|').map(function(s){return s.trim();}).filter(Boolean); }

  function parseFecha(v){
    if(v==null || v==='') return '';
    if(typeof v==='number'){ var d=new Date(Math.round((v-25569)*86400000)); return isNaN(d.getTime())?'':d.toISOString().slice(0,10); }
    var s=String(v).trim();
    var m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if(m) return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
    m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if(m) return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
    return '';
  }
  function parseHora(v){
    if(v==null || v==='') return '';
    if(typeof v==='number'){ var mins=Math.round(v*1440); return ('0'+Math.floor(mins/60)).slice(-2)+':'+('0'+(mins%60)).slice(-2); }
    var m=String(v).trim().match(/(\d{1,2}):(\d{2})/);
    return m ? ('0'+m[1]).slice(-2)+':'+m[2] : '';
  }

  // Valor que NO puede ser un nombre real (número puro, serial Excel o fecha) -> basura de plantilla
  function esBasura(v){
    var s=String(v==null?'':v).trim(); if(!s) return true;
    if(/^\d+([.,]\d+)?$/.test(s)) return true;                          // número/serial
    if(/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(s)) return true;    // fecha dd/mm/aa
    if(/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return true;                   // fecha iso
    return false;
  }
  function aoa(ws){ return XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:'' }); }
  function cel(grid,r,c){ var row=grid[r]; return (row && row[c]!=null) ? String(row[c]).trim() : ''; }
  // Busca la primera celda cuyo texto normalizado cumple el regex
  function buscar(grid, re, desdeFila){
    desdeFila = desdeFila||0;
    for(var r=desdeFila; r<grid.length; r++){ var row=grid[r]||[]; for(var c=0;c<row.length;c++){ if(re.test(norm(row[c]))) return {r:r,c:c}; } }
    return null;
  }
  // ¿La celda es una etiqueta del formulario (no un valor)?  Evita que valDer
  // capture la siguiente etiqueta cuando el campo está en blanco.
  function esEtiqueta(txt){
    var n=norm(txt); if(!n) return false;
    if(/[:?]$/.test(n)) return true;
    for(var i=0;i<SINONIMOS.length;i++){ var s=SINONIMOS[i][1]; for(var j=0;j<s.length;j++){ if(n===s[j]) return true; } }
    if(/^participante\s*\d+$/.test(n)) return true;
    return ['si','no','esporadico','recurrente','inmediata','permanente','inicio','termino','detencion','area','nombre'].indexOf(n)>=0;
  }
  // Primer valor real a la derecha (misma fila). Si lo primero no vacío es otra
  // etiqueta, se considera que el campo está vacío.
  function valDer(grid, pos, span){
    if(!pos) return ''; span=span||16; var row=grid[pos.r]||[];
    for(var c=pos.c+1; c<=pos.c+span && c<row.length; c++){ var v=(row[c]!=null?String(row[c]).trim():''); if(v) return esEtiqueta(v)?'':v; }
    return '';
  }
  function valPorEtiqueta(grid, re, span){ return valDer(grid, buscar(grid, re), span); }
  // Valor que puede venir escrito DENTRO de la misma celda de la etiqueta
  // (ej. "Descripción de la Avería:\n<texto>") o a la derecha si la celda solo tiene la etiqueta.
  function valCeldaOEtiqueta(grid, re, span){
    var pos=buscar(grid,re); if(!pos) return '';
    var full=cel(grid,pos.r,pos.c);
    var m=full.match(/[:?]\s*([\s\S]+)$/);
    if(m && m[1].trim()) return m[1].replace(/\s+/g,' ').trim();
    return valDer(grid,pos,span);
  }

  /* ── Diccionario de sinónimos para tablas (campo -> variantes de encabezado) ── */
  var SINONIMOS = [
    ['fechaInicio',      ['fecha inicio','fecha de inicio','inicio falla','inicio de falla']],
    ['horaInicio',       ['hora inicio','hora de inicio']],
    ['fechaMarcha',      ['fecha puesta en marcha','fecha de puesta en marcha','fecha marcha','puesta en marcha']],
    ['horaMarcha',       ['hora puesta en marcha','hora marcha','hora de puesta en marcha']],
    ['minutosPerdidos',  ['minutos perdidos de produccion','minutos perdidos','min perdidos','tiempo detencion','tiempo de detencion','tiempo detencion']],
    ['fecha',            ['fecha de ingreso','fecha ingreso','fecha registro','fecha de registro','fecha adf','fecha']],
    ['fechaCierre',      ['fecha de cierre','fecha cierre','fecha de termino']],
    ['codSap',           ['cod. sap equipo','cod sap equipo','codigo sap','cod. sap','cod sap','n sap','sap']],
    ['linea',            ['linea']],
    ['area',             ['area']],
    ['equipo',           ['equipo','maquina']],
    ['componente',       ['componente']],
    ['ot',               ['n ot','n o.t.','orden de trabajo','ot']],
    ['tipoProblema',     ['tipo de problema','tipo problema']],
    ['afectoProduccion', ['afecto produccion','afecta produccion','afecto la produccion']],
    ['sintoma',          ['descripcion de la averia','descripcion falla','desripcion falla','descripcion de falla','sintoma','averia','falla']],
    ['modoFalla',        ['modo de falla','modo falla']],
    ['accionCorrectiva', ['accion correctiva']],
    ['causaRaiz',        ['causa raiz','causa principal','causa']],
    ['causa6M',          ['6m causa','6m','categoria 6m','categoria']],
    ['planAccion',       ['plan de accion/actividades','plan de accion','acciones para atacar la causa raiz','actividades','acciones']],
    ['planResponsable',  ['responsable plan','responsable del plan']],
    ['planFecha',        ['fecha compromiso plan','fecha de compromiso plan','fecha compromiso','fecha de compromiso']],
    ['planTipo',         ['tipo plan','tipo de plan','tipo de solucion']],
    ['responsable',      ['responsable de cierre','responsable de adf','responsable']],
    ['participantesTxt', ['participantes','equipo de trabajo']],
    ['estado',           ['estado','estatus']],
  ];

  // Para un encabezado dado, elige el campo de mejor calce
  function campoDeEncabezado(h){
    var nh = norm(h); if(!nh) return null;
    var best=null, bestScore=0;
    for(var i=0;i<SINONIMOS.length;i++){
      var campo=SINONIMOS[i][0], syns=SINONIMOS[i][1];
      for(var j=0;j<syns.length;j++){
        var s=syns[j], sc=0;
        if(nh===s) sc=1000+s.length;
        else if(nh.indexOf(s)>=0 && s.length>=3) sc=s.length;
        else if(s.indexOf(nh)>=0 && nh.length>=4) sc=nh.length-1;
        if(sc>bestScore){ bestScore=sc; best=campo; }
      }
    }
    return bestScore>=3 ? best : null;
  }

  // Detecta la mejor fila-encabezado de una hoja (tabular)
  function detectarEncabezado(grid){
    var mejor=null;
    for(var r=0; r<Math.min(grid.length, 30); r++){
      var row=grid[r]||[]; var mapa={}, hits=0;
      for(var c=0;c<row.length;c++){
        var campo=campoDeEncabezado(row[c]);
        if(campo && mapa[campo]==null){ mapa[campo]=c; hits++; }
      }
      var tieneClave = (mapa.equipo!=null || mapa.sintoma!=null);
      if(hits>=4 && tieneClave && (!mejor || hits>mejor.hits)) mejor={fila:r, mapa:mapa, hits:hits};
    }
    return mejor;
  }

  /* ── Lectores por formato ─────────────────────────────────────────── */
  function leerTabular(grid, enc){
    var m=enc.mapa, regs=[];
    for(var r=enc.fila+1; r<grid.length; r++){
      var get=function(k){ return m[k]!=null ? cel(grid,r,m[k]) : ''; };
      var equipo=get('equipo'), sintoma=get('sintoma');
      if(esBasura(equipo)) equipo=''; // un número/fecha no es un nombre de equipo válido
      if(esBasura(sintoma)) sintoma='';
      if(!equipo && !sintoma) continue; // sin datos clave reales -> omitir
      var causasTxt=splitMulti(get('causaRaiz')), causas6M=splitMulti(get('causa6M'));
      var planTxt=splitMulti(get('planAccion')), planResp=splitMulti(get('planResponsable')),
          planFec=splitMulti(get('planFecha')), planTipo=splitMulti(get('planTipo'));
      var parts=splitMulti(get('participantesTxt'));
      if(get('responsable')) parts.push(get('responsable'));
      regs.push({
        folio:'', fecha:parseFecha(get('fecha')), area:get('area'), linea:get('linea'),
        equipo:equipo, codSap:get('codSap'), componente:get('componente'),
        fechaInicio:parseFecha(get('fechaInicio')), horaInicio:parseHora(get('horaInicio')),
        fechaMarcha:parseFecha(get('fechaMarcha')), horaMarcha:parseHora(get('horaMarcha')),
        minutosPerdidos:get('minutosPerdidos'), ot:get('ot'),
        afectoProduccion:get('afectoProduccion'),
        tipoProblema:get('tipoProblema'),
        sintoma:sintoma, modoFalla:get('modoFalla'), accionCorrectiva:get('accionCorrectiva'),
        causas:causasTxt.map(function(t,i){return {txt:t, cat:causas6M[i]||''};}),
        porques:[], planes:planTxt.map(function(a,i){return {actividad:a, responsable:planResp[i]||'', fecha:parseFecha(planFec[i]||''), tipo:planTipo[i]||''};}),
        participantes:parts.map(function(n){return {nombre:n, area:''};}),
        estado:get('estado'),
      });
    }
    return regs;
  }

  // Ficha A3 antiguo (hoja "ADF" SIGAS) -> 1 registro
  function leerFichaA3(grid){
    var reg={
      folio:valPorEtiqueta(grid,/folio/),
      fecha:parseFecha(valPorEtiqueta(grid,/^fecha$/)),
      area:valPorEtiqueta(grid,/^area$/),
      linea:valPorEtiqueta(grid,/^linea$/),
      equipo:valPorEtiqueta(grid,/^equipo$/),
      codSap:valPorEtiqueta(grid,/sap/),
      componente:valPorEtiqueta(grid,/componente/),
      fechaInicio:parseFecha(valPorEtiqueta(grid,/fecha inicio/)),
      horaInicio:parseHora(valPorEtiqueta(grid,/hora inicio/)),
      fechaMarcha:parseFecha(valPorEtiqueta(grid,/fecha puesta/)),
      horaMarcha:parseHora(valPorEtiqueta(grid,/hora puesta/)),
      minutosPerdidos:valPorEtiqueta(grid,/minutos perdidos/),
      ot:valPorEtiqueta(grid,/^ot$/),
      afectoProduccion:'', tipoProblema:'',
      sintoma:valPorEtiqueta(grid,/^sintoma$/),
      modoFalla:valPorEtiqueta(grid,/modo de falla/),
      accionCorrectiva:valPorEtiqueta(grid,/accion correctiva/),
      w_que:valPorEtiqueta(grid,/^.que.?$|^que\??$/),
      w_cuando:valPorEtiqueta(grid,/cuando/),
      w_donde:valPorEtiqueta(grid,/donde/),
      w_quien:valPorEtiqueta(grid,/quien/),
      w_cual:valPorEtiqueta(grid,/cual/),
      w_como:valPorEtiqueta(grid,/como/),
      causas:[], porques:[], planes:[], participantes:[], estado:'',
    };
    // Participantes ("Participante N")
    for(var r=0;r<grid.length;r++){ var row=grid[r]||[]; for(var c=0;c<row.length;c++){
      if(/^participante\s*\d+/.test(norm(row[c]))){ var v=valDer(grid,{r:r,c:c}); if(v) reg.participantes.push({nombre:v, area:''}); }
    }}
    // Causas (bloque "causas más probables") y 5 porqué
    var secCausas=buscar(grid,/causas mas probables/);
    var secPorque=buscar(grid,/analisis 5\s*porqu|5\s*porque de causa/);
    var secPlanes=buscar(grid,/planes de accion/);
    if(secCausas){
      var hasta=(secPorque?secPorque.r:grid.length);
      for(var rr=secCausas.r+1; rr<hasta; rr++){ var rw=grid[rr]||[];
        for(var cc=0; cc<rw.length; cc++){ var t=(rw[cc]!=null?String(rw[cc]).trim():'');
          if(t && !/^\d+$/.test(t) && norm(t).length>3 && !/causa mas probable/.test(norm(t))) reg.causas.push({txt:t}); }
      }
    }
    if(secPorque){
      var pc=valDer(grid,buscar(grid,/causa.*s.*mas probable/)); if(pc) {} // causa raíz textual (informativa)
      var lim=(secPlanes?secPlanes.r:grid.length);
      for(var pr=secPorque.r+1; pr<lim; pr++){ var prow=grid[pr]||[];
        if(/por que|porque/.test(norm(prow[0]))){ var pv=valDer(grid,{r:pr,c:0}); if(pv) reg.porques.push(pv); }
      }
    }
    if(secPlanes){
      var encFecha=buscar(grid,/fecha compromiso/, secPlanes.r);
      var encResp=buscar(grid,/^responsable$/, secPlanes.r);
      for(var qr=secPlanes.r+1; qr<grid.length; qr++){ var qrow=grid[qr]||[];
        if(/^\d+$/.test(String(qrow[0]||'').trim())){
          var act=valDer(grid,{r:qr,c:0}, 6);
          if(act && norm(act)!=='actividades'){ reg.planes.push({
            actividad:act,
            responsable: encResp? cel(grid,qr,encResp.c) : '',
            fecha: encFecha? parseFecha(cel(grid,qr,encFecha.c)) : '',
            tipo:'' }); }
        }
      }
    }
    return reg;
  }

  // Ficha NUEVO ("REPORTE DE AVERÍA" + "PLANES DE ACCIÓN") -> 1 registro
  function leerFichaNuevo(wb, rep){
    var g=aoa(rep);
    var folio=valCeldaOEtiqueta(g,/folio/);
    if(/reporte de averia|planilla|intervencion/.test(norm(folio))) folio=''; // evita tomar el título
    var reg={
      folio:folio,
      fecha:parseFecha(valCeldaOEtiqueta(g,/^fecha/)),
      area:'', linea:valCeldaOEtiqueta(g,/^linea/),
      equipo:valCeldaOEtiqueta(g,/^maquina/),
      codSap:valCeldaOEtiqueta(g,/n.*sap/),
      componente:valCeldaOEtiqueta(g,/^componente/),
      fechaInicio:'', horaInicio:'', fechaMarcha:'', horaMarcha:'',
      minutosPerdidos:valCeldaOEtiqueta(g,/tiempo parada/),
      ot:valCeldaOEtiqueta(g,/o\.?t\.?/),
      afectoProduccion:'', tipoProblema:'',
      sintoma:valCeldaOEtiqueta(g,/descripcion de la averia/),
      modoFalla:'', accionCorrectiva:'',
      causas:[], porques:[], planes:[], participantes:[], estado:'',
    };
    // Participantes del análisis
    var secPart=buscar(g,/quienes participaron en el analisis/);
    if(secPart){ for(var r=secPart.r; r<Math.min(g.length,secPart.r+18); r++){ var row=g[r]||[];
      for(var c=0;c<row.length;c++){ if(/^nombre:?$/.test(norm(row[c]))){ var v=valDer(g,{r:r,c:c}); if(v) reg.participantes.push({nombre:v, area:''}); } }
    }}
    // Planes desde hoja "PLANES DE ACCIÓN"
    var hp=null; (wb.SheetNames||[]).forEach(function(n){ if(/planes? de acci/.test(norm(n))) hp=n; });
    if(hp){ var gp=aoa(wb.Sheets[hp]);
      reg.causas = []; var cr=valPorEtiqueta(gp,/causa raiz/); if(cr) reg.causas.push({txt:cr});
      var encA=buscar(gp,/acciones para atacar la causa raiz/);
      var encR=buscar(gp,/responsable/);
      var encF=buscar(gp,/fecha de compromiso/);
      if(encA){ for(var pr=encA.r+1; pr<gp.length; pr++){ var prow=gp[pr]||[];
        var act=(encA.c<prow.length?String(prow[encA.c]||'').trim():'');
        if(act && norm(act).length>2){ reg.planes.push({
          actividad:act,
          responsable: encR?String(prow[encR.c]||'').trim():'',
          fecha: encF?parseFecha(prow[encF.c]):'',
          tipo:'' }); }
      }}
    }
    return reg;
  }

  /* ── Detección + lectura principal ───────────────────────────────── */
  function leer(wb){
    var nombres = wb.SheetNames || [];
    var candidatos = []; // {formato, registros}
    var vacios = [];     // formatos reconocidos pero sin datos

    // 1) Tabular en cualquier hoja (elige la de más encabezados reconocidos)
    var mejorTab=null;
    for(var i=0;i<nombres.length;i++){
      var grid=aoa(wb.Sheets[nombres[i]]);
      var enc=detectarEncabezado(grid);
      if(enc && (!mejorTab || enc.hits>mejorTab.enc.hits)) mejorTab={hoja:nombres[i], grid:grid, enc:enc};
    }
    if(mejorTab){
      var regsT=leerTabular(mejorTab.grid, mejorTab.enc);
      var fT='Tabla / bitácora ("'+mejorTab.hoja+'")';
      if(regsT.length) candidatos.push({formato:fT, registros:regsT});
      else vacios.push({formato:fT, aviso:'Reconocí la tabla "'+mejorTab.hoja+'" pero no tiene filas con datos (Equipo/Síntoma).'});
    }
    // 2) Ficha A3 antiguo (hoja con "DATOS GENERALES" / "CAUSAS MÁS PROBABLES")
    for(var a=0;a<nombres.length;a++){ var g1=aoa(wb.Sheets[nombres[a]]);
      if(buscar(g1,/datos generales/) || buscar(g1,/causas mas probables/)){
        var r1=leerFichaA3(g1);
        if(r1.equipo||r1.sintoma) candidatos.push({formato:'Ficha A3 — formato antiguo (SIGAS)', registros:[r1]});
        else vacios.push({formato:'Ficha A3 — formato antiguo (SIGAS)', aviso:'Reconocí la ficha A3 antigua, pero Equipo/Síntoma están vacíos.'});
        break;
      }
    }
    // 3) Ficha NUEVO ("REPORTE DE AVERÍA")
    for(var b=0;b<nombres.length;b++){ var g2=aoa(wb.Sheets[nombres[b]]);
      if(/reporte de averia/.test(norm(nombres[b])) || buscar(g2,/reporte de averia/) || buscar(g2,/descripcion de la averia/)){
        var r2=leerFichaNuevo(wb, wb.Sheets[nombres[b]]);
        if(r2.equipo||r2.sintoma) candidatos.push({formato:'Ficha A3 — nuevo estándar (v3)', registros:[r2]});
        else vacios.push({formato:'Ficha A3 — nuevo estándar (v3)', aviso:'Reconocí la ficha A3 (nuevo estándar), pero Máquina/Descripción de avería están vacíos.'});
        break;
      }
    }

    // Gana el que tenga más registros con datos
    if(candidatos.length){
      candidatos.sort(function(x,y){ return y.registros.length - x.registros.length; });
      return { formato:candidatos[0].formato, registros:candidatos[0].registros, aviso:'' };
    }
    if(vacios.length){
      return { formato:vacios[0].formato, registros:[], aviso:vacios[0].aviso+' Complétalo y vuelve a subirlo.' };
    }
    return { formato:null, registros:[], aviso:'No reconocí el formato del archivo. Usa la plantilla, el formato antiguo (hoja "ADF" o "Registro") o el nuevo estándar.' };
  }

  global.ADFImport = { leer:leer, _norm:norm, _parseFecha:parseFecha, _parseHora:parseHora };
})(typeof window!=='undefined' ? window : globalThis);
