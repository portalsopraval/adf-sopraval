/* ═══════════════════════════════════════════════════════════
   SOPRAVAL / AGROSUPER – Portal ADF (Análisis de Falla)
   App independiente · Firestore · Motor de reglas (sin IA)
   ROLES:
     tecnico → crea ADF, ingresa falla, genera análisis
     lider   → ve todo, gestiona catálogo y usuarios, cierra ADF
   ═══════════════════════════════════════════════════════════ */

// ── Firebase (mismo proyecto, colecciones adf_*) ──
const firebaseConfig = {
  apiKey:            "AIzaSyDLA0GPjLrWJIDoPjo9vXPmnJLnUi-9jMY",
  authDomain:        "portal-necesidades-la-calera.firebaseapp.com",
  projectId:         "portal-necesidades-la-calera",
  storageBucket:     "portal-necesidades-la-calera.firebasestorage.app",
  messagingSenderId: "945581573169",
  appId:             "1:945581573169:web:09dbd4804ca4acddaf0110"
};
firebase.initializeApp(firebaseConfig);
const fdb   = firebase.firestore();
const fauth = firebase.auth();

const COL_USERS  = 'adf_users';
const COL_ADF    = 'adf_registros';
const COL_CFG    = 'adf_config';
const COL_PLANES = 'adf_planes_mp';

// ── Estado global ──
let CU = null;                       // usuario actual
const _cache = { users: [], adfs: [], planes: [] };
let _activeTab = 'inicio';
let _wizard = null;                  // borrador en construcción
let _openId = null;                  // ADF abierto en modal
let _openPlanId = null;              // Plan PM abierto en modal

// ── Helpers ──
const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const esc  = s  => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtD = iso => iso ? new Date(iso).toLocaleDateString('es-CL') : '—';
const fmtDT= iso => iso ? new Date(iso).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const initials = n => String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const $  = id => document.getElementById(id);
const esLider = () => CU && CU.role === 'lider';
// Administradores con acceso a Indicadores y Reporte semanal
const ADMINS = ['gvelizm@sopraval.cl','jgomezf@sopraval.cl'];
const esAdmin = () => CU && ADMINS.includes((CU.email||'').toLowerCase());

function toast(msg, type='info'){
  const t=document.createElement('div'); t.className='toast '+type; t.textContent=msg;
  $('toast-wrap').appendChild(t); setTimeout(()=>t.remove(),3600);
}

const AREAS = ['Producción','Faena','Despresado','Cámaras / Frío','Calderas','Tratamiento de Aguas',
  'Servicios / Utilities','Rendering','Despacho','Mantenimiento','Otra'];

const ESTADOS = {
  Borrador:    { lbl:'Borrador',      cls:'b-borrador'   },
  Analisis:    { lbl:'En Análisis',   cls:'b-analisis'   },
  PlanAccion:  { lbl:'Plan de Acción',cls:'b-planaccion' },
  Seguimiento: { lbl:'Seguimiento',   cls:'b-seguimiento'},
  Cerrado:     { lbl:'Cerrado',       cls:'b-cerrado'    },
};
const badge = est => { const e=ESTADOS[est]||ESTADOS.Borrador; return `<span class="badge ${e.cls}">${e.lbl}</span>`; };

/* ═══════════════════════════════════════════════════════════
   MOTOR DE REGLAS — Catálogo genérico industrial
   Cada modo de falla → causas probables, 5 porqués, acciones.
   Se detecta por palabras clave en síntoma + modo + 5W+1H.
   ═══════════════════════════════════════════════════════════ */
const CATALOGO = [
  {
    id:'sobrecalentamiento', nombre:'Sobrecalentamiento',
    keys:['sobrecalent','caliente','temperatura alta','recalent','calor','térmico','termico'],
    causas:['Falta o degradación de lubricación','Sobrecarga del equipo','Rodamiento desgastado',
      'Ventilación/refrigeración obstruida','Desalineación de ejes','Falla en sistema de enfriamiento',
      'Tensión eléctrica fuera de rango','Fricción excesiva por desgaste','Filtro de aire saturado',
      'Sensor de temperatura defectuoso','Ambiente con temperatura elevada','Falla en ventilador/bomba de enfriamiento',
      'Acumulación de suciedad/polvo'],
    probable:0,
    porques:['¿Por qué se sobrecalentó el equipo? → Falta de lubricación en los puntos críticos',
      '¿Por qué faltó lubricación? → No se ejecutó el plan de lubricación programado',
      '¿Por qué no se ejecutó? → No existe ruta de lubricación definida para el equipo',
      '¿Por qué no existe la ruta? → El equipo no fue incorporado al plan de mantenimiento preventivo',
      '¿Por qué no se incorporó? → Falta de gestión de altas de equipos en el sistema de mantenimiento'],
    acciones:[
      {a:'Lubricar y enfriar el equipo para restablecer operación',t:'INMEDIATA'},
      {a:'Verificar y limpiar sistema de ventilación/refrigeración',t:'INMEDIATA'},
      {a:'Incorporar el equipo al plan de lubricación preventiva',t:'PERMANENTE'},
      {a:'Definir ruta de lubricación con frecuencia y responsable',t:'PERMANENTE'}],
  },
  {
    id:'vibracion', nombre:'Vibración excesiva',
    keys:['vibrac','vibra','tembl','oscilac','desbalance'],
    causas:['Desbalanceo de componente rotativo','Desalineación de acoplamiento','Rodamiento desgastado',
      'Pernos de anclaje sueltos','Eje doblado','Holgura mecánica','Resonancia estructural',
      'Acoplamiento dañado','Base/fundación deteriorada','Desgaste de engranajes',
      'Falla en soportes/amortiguadores','Carga desigual','Elemento rotativo dañado'],
    probable:0,
    porques:['¿Por qué hay vibración excesiva? → Desbalanceo del componente rotativo',
      '¿Por qué se desbalanceó? → Desgaste/acumulación de material en el rotor',
      '¿Por qué se desgastó/acumuló material? → No se realizó inspección ni limpieza periódica',
      '¿Por qué no se inspeccionó? → No hay análisis de vibraciones en el plan predictivo',
      '¿Por qué no hay análisis predictivo? → Falta implementar mantenimiento basado en condición'],
    acciones:[
      {a:'Detener equipo y verificar anclajes/acoplamiento',t:'INMEDIATA'},
      {a:'Balancear/alinear el componente rotativo',t:'INMEDIATA'},
      {a:'Implementar análisis de vibraciones periódico',t:'PERMANENTE'},
      {a:'Definir parámetros de alerta y ruta de inspección predictiva',t:'PERMANENTE'}],
  },
  {
    id:'fuga', nombre:'Fuga / Pérdida de fluido',
    keys:['fuga','goteo','derrame','pérdida de aceite','perdida de aceite','filtrac','escape','pérdida de aire','perdida de aire','pérdida de presión','perdida de presion'],
    causas:['Sello/retén desgastado','Junta o empaquetadura deteriorada','Manguera o cañería fisurada',
      'Conexión floja','Corrosión en línea','Sobrepresión del sistema','O-ring dañado',
      'Soldadura defectuosa','Vibración que afloja uniones','Material incompatible con el fluido',
      'Golpe/daño mecánico externo','Falla en válvula','Desgaste por antigüedad'],
    probable:0,
    porques:['¿Por qué hay fuga? → Sello/retén desgastado',
      '¿Por qué se desgastó el sello? → Superó su vida útil sin reemplazo',
      '¿Por qué no se reemplazó a tiempo? → No hay control de vida útil de sellos',
      '¿Por qué no hay control? → No están catalogados como repuesto crítico',
      '¿Por qué no están catalogados? → Falta análisis de criticidad de componentes'],
    acciones:[
      {a:'Contener la fuga y reemplazar sello/junta afectada',t:'INMEDIATA'},
      {a:'Inspeccionar líneas y conexiones cercanas',t:'INMEDIATA'},
      {a:'Catalogar sellos como repuesto crítico con stock mínimo',t:'PERMANENTE'},
      {a:'Definir frecuencia de reemplazo preventivo de sellos',t:'PERMANENTE'}],
  },
  {
    id:'electrica', nombre:'Falla eléctrica / No arranca',
    keys:['no arranca','no parte','no enciende','eléctric','electric','corto','fusible','disyuntor','variador','tablero','contactor','motor quemado','protección','proteccion'],
    causas:['Falla en motor eléctrico','Protección térmica activada','Fusible/disyuntor abierto',
      'Contactor dañado','Conexión suelta o sulfatada','Variador de frecuencia con falla',
      'Sobrecarga de corriente','Cableado deteriorado','Falta de fase','Sensor/relé defectuoso',
      'Tablero con humedad','Tierra deficiente','PLC/control con falla'],
    probable:1,
    porques:['¿Por qué no arranca el equipo? → Protección térmica activada',
      '¿Por qué se activó la protección? → Sobrecorriente por sobrecarga mecánica',
      '¿Por qué hubo sobrecarga mecánica? → Resistencia anormal por falta de lubricación/atascamiento',
      '¿Por qué hubo esa resistencia? → No se detectó en inspección previa',
      '¿Por qué no se detectó? → No hay monitoreo de consumo eléctrico del equipo'],
    acciones:[
      {a:'Revisar protecciones, rearmar y medir consumo',t:'INMEDIATA'},
      {a:'Inspeccionar conexiones y estado del motor',t:'INMEDIATA'},
      {a:'Instalar monitoreo de corriente en equipos críticos',t:'PERMANENTE'},
      {a:'Programar termografía periódica de tableros',t:'PERMANENTE'}],
  },
  {
    id:'atasco', nombre:'Atascamiento / Obstrucción',
    keys:['atasc','obstru','tranc','bloque','tap','acumul','traba','colmat','congesti',
      'embanc','embanque','apelmaz','compact','pegado','adheri','no fluye','no avanza',
      'no descarga','se detiene el flujo','material acumulado','pluma','cuerpo extraño','atorad'],
    causas:['Acumulación de producto/material','Cuerpo extraño en el sistema','Falta de limpieza',
      'Desgaste que reduce holguras','Producto fuera de especificación','Velocidad/flujo inadecuado',
      'Diseño con zonas de retención','Falla en sistema de descarga','Humedad que apelmaza material',
      'Falta de mantenimiento de transportadores','Sobrealimentación del equipo','Elemento mecánico roto',
      'Sensor de nivel/flujo defectuoso'],
    probable:0,
    porques:['¿Por qué se atascó? → Acumulación de material en la zona de paso',
      '¿Por qué se acumuló material? → Falta de limpieza en la frecuencia requerida',
      '¿Por qué no se limpió? → No está definida la frecuencia/responsable de limpieza',
      '¿Por qué no está definida? → No se incluyó en el estándar operacional del equipo',
      '¿Por qué no se incluyó? → Falta levantamiento de tareas de limpieza por equipo'],
    acciones:[
      {a:'Desobstruir y restablecer el flujo del equipo',t:'INMEDIATA'},
      {a:'Inspeccionar desgaste de componentes de paso',t:'INMEDIATA'},
      {a:'Definir estándar de limpieza con frecuencia y responsable',t:'PERMANENTE'},
      {a:'Evaluar mejora de diseño para evitar retención',t:'PERMANENTE'}],
  },
  {
    id:'rotura', nombre:'Rotura / Desgaste mecánico',
    keys:['rotura','rompi','quebr','fractur','desgast','fisur','grieta','partid','trizad','rotur'],
    causas:['Fatiga del material','Sobrecarga puntual','Desgaste por antigüedad','Falta de lubricación',
      'Material/repuesto de baja calidad','Montaje incorrecto','Corrosión que debilita','Golpe o impacto',
      'Vibración prolongada','Desalineación','Error operacional','Diseño subdimensionado',
      'Falta de mantenimiento preventivo'],
    probable:0,
    porques:['¿Por qué se rompió el componente? → Fatiga del material',
      '¿Por qué llegó a fatiga? → Operó más allá de su vida útil',
      '¿Por qué operó sobre su vida útil? → No hay control de horas/ciclos del componente',
      '¿Por qué no hay control? → El componente no está en el plan de reemplazo preventivo',
      '¿Por qué no está en el plan? → Falta análisis de criticidad y vida útil de partes'],
    acciones:[
      {a:'Reemplazar el componente roto y restablecer operación',t:'INMEDIATA'},
      {a:'Verificar componentes asociados por daño secundario',t:'INMEDIATA'},
      {a:'Incorporar componente al plan de reemplazo preventivo',t:'PERMANENTE'},
      {a:'Evaluar mejora de material/diseño del componente',t:'PERMANENTE'}],
  },
  {
    id:'corrosion', nombre:'Corrosión / Deterioro',
    keys:['corros','óxido','oxido','herrumbr','deterioro','picadura','oxidac'],
    causas:['Exposición a humedad','Ambiente salino/agresivo','Pérdida de recubrimiento protector',
      'Contacto con agentes químicos','Falta de pintura/galvanizado','Condensación','Drenaje deficiente',
      'Material inadecuado para el ambiente','Limpieza con productos corrosivos','Aislación dañada',
      'Falta de inspección estructural','Fugas que generan humedad','Antigüedad del activo'],
    probable:0,
    porques:['¿Por qué hay corrosión? → Exposición prolongada a humedad',
      '¿Por qué hubo exposición a humedad? → Pérdida del recubrimiento protector',
      '¿Por qué se perdió el recubrimiento? → No se renovó la protección superficial',
      '¿Por qué no se renovó? → No hay plan de inspección/pintura de estructuras',
      '¿Por qué no hay plan? → Falta gestión de integridad de activos'],
    acciones:[
      {a:'Limpiar zona corroída y aplicar protección temporal',t:'INMEDIATA'},
      {a:'Evaluar integridad estructural del componente',t:'INMEDIATA'},
      {a:'Establecer plan de inspección y pintura de estructuras',t:'PERMANENTE'},
      {a:'Evaluar cambio de material por uno resistente al ambiente',t:'PERMANENTE'}],
  },
  {
    id:'instrumentacion', nombre:'Falla de sensor / Instrumentación',
    keys:['sensor','instrument','medic','lectura','señal','senal','transmisor','calibr','indicador','no mide','medición','medicion'],
    causas:['Sensor descalibrado','Sensor dañado/sucio','Cableado de señal deteriorado','Conexión floja',
      'Interferencia eléctrica','Falla en fuente de alimentación','Configuración incorrecta','Antigüedad del instrumento',
      'Humedad en el instrumento','Falla en PLC/entrada','Sensor fuera de rango','Daño mecánico al sensor',
      'Falta de mantenimiento de instrumentos'],
    probable:0,
    porques:['¿Por qué falló la medición? → Sensor descalibrado',
      '¿Por qué se descalibró? → No se realizó calibración periódica',
      '¿Por qué no se calibró? → No hay plan de calibración de instrumentos',
      '¿Por qué no hay plan? → Los instrumentos no están inventariados como críticos',
      '¿Por qué no están inventariados? → Falta gestión metrológica de la planta'],
    acciones:[
      {a:'Calibrar/reemplazar el sensor afectado',t:'INMEDIATA'},
      {a:'Verificar cableado y conexión de señal',t:'INMEDIATA'},
      {a:'Implementar plan de calibración periódica',t:'PERMANENTE'},
      {a:'Inventariar instrumentos críticos y su frecuencia metrológica',t:'PERMANENTE'}],
  },
  {
    id:'ruido', nombre:'Ruido anormal',
    keys:['ruido','golpeteo','chirrid','rechin','zumbid','sonido'],
    causas:['Rodamiento dañado','Falta de lubricación','Holgura mecánica','Componente suelto',
      'Desgaste de engranajes','Roce entre piezas','Desalineación','Cuerpo extraño',
      'Cavitación en bomba','Correa deteriorada','Acoplamiento dañado','Vibración asociada',
      'Pieza fisurada'],
    probable:0,
    porques:['¿Por qué hay ruido anormal? → Rodamiento dañado',
      '¿Por qué se dañó el rodamiento? → Falta de lubricación adecuada',
      '¿Por qué faltó lubricación? → No se respetó la frecuencia/tipo de lubricante',
      '¿Por qué no se respetó? → No hay estándar de lubricación documentado',
      '¿Por qué no hay estándar? → Falta definición técnica de lubricación por equipo'],
    acciones:[
      {a:'Inspeccionar y reemplazar rodamiento/componente ruidoso',t:'INMEDIATA'},
      {a:'Lubricar según especificación del fabricante',t:'INMEDIATA'},
      {a:'Documentar estándar de lubricación por equipo',t:'PERMANENTE'},
      {a:'Capacitar al personal en rutas de lubricación',t:'PERMANENTE'}],
  },
  // ── Modos agregados desde taxonomía OREDA (offshore reliability data) ──
  {
    id:'paro_inesperado', nombre:'Paro inesperado en marcha (FWR/UST)',
    keys:['paro inesper','se detuvo','se apagó','trip','parada no program','paró solo','se paró','detención espontán','paro imprevisto','parada súbita'],
    causas:['Protección de sobrecarga activada','Falla de tensión o falta de fase',
      'Sobrecalentamiento del motor','Falla en variador de frecuencia',
      'Sensor de seguridad activado erróneamente','Acumulación de material que bloquea mecanismo',
      'Falla en sistema de control/PLC','Cortocircuito en cableado',
      'Lubricación insuficiente que genera traba','Falla en acoplamiento o transmisión',
      'Vibración excesiva que activa protección','Contactor o relé defectuoso',
      'Falla de comunicación en red de control'],
    probable:0,
    porques:['¿Por qué se detuvo el equipo inesperadamente? → Protección de sobrecarga activada',
      '¿Por qué se activó la protección? → Corriente anormalmente alta por resistencia mecánica',
      '¿Por qué había resistencia mecánica? → Acumulación de material / falta de lubricación',
      '¿Por qué se acumuló material o faltó lubricación? → Sin plan de limpieza ni lubricación preventiva',
      '¿Por qué no hay plan preventivo? → El equipo no fue incluido en el programa de mantenimiento'],
    acciones:[
      {a:'Identificar protección activada, revisar causa y rearmar',t:'INMEDIATA'},
      {a:'Medir consumo eléctrico y temperatura del motor',t:'INMEDIATA'},
      {a:'Incorporar equipo a plan de mantenimiento preventivo',t:'PERMANENTE'},
      {a:'Instalar monitoreo de corriente y temperatura en tiempo real',t:'PERMANENTE'}],
  },
  {
    id:'bajo_rendimiento', nombre:'Bajo rendimiento / Sin caudal (LOO/VLO)',
    keys:['bajo rendim','sin caudal','caudal reducido','baja presión','sin presión','presión baja',
      'sin flujo','flujo bajo','bomba no entrega','compresor sin presión','motor sin torque',
      'velocidad baja','rpm bajo','bajo caudal'],
    causas:['Desgaste interno de bomba/compresor','Cavitación por baja presión de succión',
      'Filtro de succión obstruido','Fuga interna por desgaste de sellos',
      'Válvula de by-pass abierta accidentalmente','Línea obstruida por depósito/incrustación',
      'Velocidad de giro reducida (variador mal configurado)','Desgaste de impelente',
      'Válvula de descarga parcialmente cerrada','Cavitación por temperatura alta del fluido',
      'Rotura/desgaste de correa de transmisión','Espacio libre excesivo por desgaste',
      'Diseño subdimensionado para el caudal requerido'],
    probable:2,
    porques:['¿Por qué hay bajo caudal/presión? → Filtro de succión obstruido',
      '¿Por qué se obstruyó el filtro? → Superó su período de limpieza/reemplazo',
      '¿Por qué no se limpió a tiempo? → No hay frecuencia definida de mantención de filtros',
      '¿Por qué no hay frecuencia definida? → Filtros no incluidos en plan de mantenimiento',
      '¿Por qué no están incluidos? → Falta levantamiento de componentes críticos del equipo'],
    acciones:[
      {a:'Revisar y limpiar filtros de succión/descarga',t:'INMEDIATA'},
      {a:'Medir caudal y presión; verificar válvulas y líneas',t:'INMEDIATA'},
      {a:'Definir frecuencia de limpieza y reemplazo de filtros',t:'PERMANENTE'},
      {a:'Implementar medición periódica de rendimiento de equipos de fluido',t:'PERMANENTE'}],
  },
  {
    id:'fuga_interna', nombre:'Fuga interna (INL/LCP/SIL)',
    keys:['fuga interna','bypass interno','válvula no cierra','no sella','sello interno','by-pass',
      'fuga en válvula','válvula pasa','pierde internamente','fuga por asiento','asiento desgastado'],
    causas:['Asiento de válvula desgastado','Sello interno erosionado por partículas',
      'Obturador/disco dañado','Material incompatible con el fluido',
      'Golpe de ariete que daña el asiento','Temperatura fuera de rango que deforma sellos',
      'Depósitos que impiden cierre total','Corrosión del asiento o del vástago',
      'Vibración que daña empaquetaduras','Ajuste incorrecto en válvula de control',
      'Sobre-presión que deforma el cuerpo','Desgaste por antigüedad sin reemplazo',
      'Partículas abrasivas en el fluido'],
    probable:0,
    porques:['¿Por qué hay fuga interna? → Asiento de válvula desgastado',
      '¿Por qué se desgastó el asiento? → Partículas en el fluido erosionaron el asiento',
      '¿Por qué hay partículas? → Filtración deficiente en la línea de proceso',
      '¿Por qué la filtración es deficiente? → Filtros sin mantenimiento o diseño inadecuado',
      '¿Por qué no se mantienen los filtros? → No incluidos en el plan de mantenimiento preventivo'],
    acciones:[
      {a:'Aislar válvula/equipo y verificar fuga interna con prueba de estanqueidad',t:'INMEDIATA'},
      {a:'Reparar o reemplazar asiento/sello interno',t:'INMEDIATA'},
      {a:'Instalar o mejorar filtración aguas arriba del equipo',t:'PERMANENTE'},
      {a:'Definir período de prueba de estanqueidad para válvulas críticas',t:'PERMANENTE'}],
  },
  {
    id:'erratico', nombre:'Funcionamiento errático / Salida irregular (ERO/EOP)',
    keys:['errátic','irregular','inestable','oscila','fluctú','variador','dosif','no mantiene','varía la velocidad',
      'velocidad irregular','presión fluctuante','caudal inestable','señal errática','respuesta errática'],
    causas:['Variador de frecuencia con falla intermitente','Sensor de retroalimentación defectuoso',
      'Interferencia eléctrica en señal de control','PLC con falla o programa incorrecto',
      'Carga variable no compensada en el sistema','Desgaste de componente que genera holgura',
      'Alimentación eléctrica inestable (tensión fluctuante)','Parámetro PID mal configurado',
      'Temperatura excesiva en tablero de control','Conexiones flojas en circuito de control',
      'Actuador con desgaste interno','Contaminación en fluido hidráulico/neumático',
      'Cavitación intermitente en bomba'],
    probable:0,
    porques:['¿Por qué funciona de forma errática? → Variador de frecuencia con falla intermitente',
      '¿Por qué falla el variador? → Temperatura excesiva en el tablero de control',
      '¿Por qué hay temperatura excesiva? → Filtro de ventilación del tablero obstruido',
      '¿Por qué no se limpió el filtro? → No está incluido en rutina de mantenimiento eléctrico',
      '¿Por qué no está en la rutina? → Falta definición de mantenimiento de tableros de control'],
    acciones:[
      {a:'Revisar señales de control, parámetros del variador y retroalimentación',t:'INMEDIATA'},
      {a:'Verificar temperatura en tablero y limpiar ventilación',t:'INMEDIATA'},
      {a:'Incluir revisión de tableros en rutina de mantenimiento preventivo eléctrico',t:'PERMANENTE'},
      {a:'Instalar monitoreo de temperatura en tableros críticos',t:'PERMANENTE'}],
  },
  {
    id:'estructural', nombre:'Deficiencia estructural / Fatiga (STD)',
    keys:['fisura','grieta en soporte','fractura en base','chasis','bancada','soldadura rota','soldadura fisur',
      'deformación','pandeo','estructura dañada','soporte cedió','base fisurada','fatiga estructural'],
    causas:['Fatiga por vibración prolongada','Sobrecarga puntual que supera límite de diseño',
      'Corrosión que debilita la sección resistente','Soldadura defectuosa o sin tratamiento',
      'Base/fundación deteriorada','Diseño original subdimensionado',
      'Modificación del equipo sin recalcular estructura','Impacto mecánico externo',
      'Desgaste por fricción en puntos de contacto','Temperatura cíclica que genera fatiga térmica',
      'Falta de refuerzo en zonas de concentración de esfuerzo','Material no apto para el ambiente',
      'Falta de inspección de integridad estructural'],
    probable:0,
    porques:['¿Por qué hay deficiencia estructural? → Fatiga por vibración prolongada',
      '¿Por qué hay vibración prolongada? → Desbalanceo/desalineación no corregida',
      '¿Por qué no se corrigió? → No se detectó en inspección',
      '¿Por qué no se detectó? → No hay programa de análisis de vibraciones',
      '¿Por qué no hay programa? → Falta implementar mantenimiento predictivo en el equipo'],
    acciones:[
      {a:'Evaluar integridad de la estructura, reforzar o aislar el equipo',t:'INMEDIATA'},
      {a:'Identificar y corregir la fuente de vibración/sobrecarga',t:'INMEDIATA'},
      {a:'Implementar inspección periódica de integridad estructural',t:'PERMANENTE'},
      {a:'Incorporar equipo a análisis de vibraciones predictivo',t:'PERMANENTE'}],
  },
  {
    id:'incrustacion', nombre:'Incrustación / Fouling (PCL/FOU)',
    keys:['incrustac','fouling','deposit','sarro','caliza','biofilm','tapón','obstruido por depósit',
      'acumulación de grasa','acumul','costra','calcificac','taponado','sedimento','suciedad interna'],
    causas:['Agua con alta dureza (sarro cálcico)','Temperatura alta que precipita minerales',
      'Fluido con partículas en suspensión','Velocidad de flujo baja que favorece depósito',
      'Materiales orgánicos (grasas, proteínas) en proceso alimentario',
      'Biofilm por falta de limpieza CIP','pH fuera de rango que precipita compuestos',
      'Diseño con zonas de baja velocidad','Falta de filtración del agua de proceso',
      'Frecuencia de limpieza insuficiente','Material del equipo que favorece adherencia',
      'Interrupción de flujo que deja residuos','Corrosión que genera rugosidad y retención'],
    probable:4,
    porques:['¿Por qué hay incrustación? → Agua con alta dureza y temperatura elevada',
      '¿Por qué no se trata el agua? → Sin sistema de tratamiento o dosificación de inhibidor',
      '¿Por qué no hay tratamiento? → No se realizó análisis de calidad del agua de proceso',
      '¿Por qué no se analizó? → Falta programa de control de calidad del agua en planta',
      '¿Por qué no hay programa? → Gestión de agua no definida como proceso crítico de mantenimiento'],
    acciones:[
      {a:'Realizar limpieza química (CIP o descalcificación) del equipo',t:'INMEDIATA'},
      {a:'Verificar y ajustar parámetros del agua de proceso',t:'INMEDIATA'},
      {a:'Definir frecuencia de limpieza CIP y control de dureza del agua',t:'PERMANENTE'},
      {a:'Implementar dosificación de inhibidor de incrustaciones',t:'PERMANENTE'}],
  },
  {
    id:'contaminacion', nombre:'Contaminación de producto (específico industria alimentaria)',
    keys:['contaminac','cuerpo extraño','producto contaminado','olor extraño','sabor extraño',
      'material extraño','peligro alimentario','inocuidad','fuga al producto','aceite en producto',
      'metal en product','plástico en product','grasa en product'],
    causas:['Fuga de lubricante/fluido hacia línea de producto','Pieza mecánica rota dentro del equipo',
      'Falta de limpieza y sanitización del equipo','Material de empaque deteriorado',
      'Sello de contacto alimentario desgastado','Temperatura de proceso fuera de rango',
      'Cross-contamination por diseño inadecuado','Mantenimiento sin control de piezas',
      'Material no apto para contacto alimentario','Biofilm por limpieza insuficiente',
      'Condensación en superficies no drenadas','Residuos de producto anterior (alérgeno)',
      'Error en procedimiento de sanitización'],
    probable:0,
    porques:['¿Por qué hubo contaminación del producto? → Fuga de lubricante hacia la línea de proceso',
      '¿Por qué hubo fuga? → Sello de contacto alimentario desgastado',
      '¿Por qué estaba desgastado? → Superó su vida útil sin reemplazo',
      '¿Por qué no se reemplazó? → No hay control de vida útil de sellos en contacto alimentario',
      '¿Por qué no hay control? → Falta programa de gestión de componentes críticos de inocuidad'],
    acciones:[
      {a:'Detener línea, aislar lote afectado y notificar a calidad',t:'INMEDIATA'},
      {a:'Inspeccionar y reparar fuente de contaminación',t:'INMEDIATA'},
      {a:'Crear registro de componentes en contacto alimentario con vida útil',t:'PERMANENTE'},
      {a:'Implementar verificaciones de inocuidad en mantenimiento (use solo lubricantes H1)',t:'PERMANENTE'}],
  },
  {
    id:'desalineacion', nombre:'Desalineación / Desbalanceo',
    keys:['desalin','desbalance','descentrad','excentric','aline','balanceo','mal alineado','eje torcido','acople mal','vibra por aline'],
    causas:['Desalineación entre motor y equipo conducido','Desbalanceo del rotor/impulsor',
      'Montaje incorrecto tras intervención','Base/anclaje suelto o deformado',
      'Acoplamiento desgastado o dañado','Eje deformado o pandeado',
      'Dilatación térmica no compensada','Fundación deteriorada que mueve el equipo',
      'Pernos de fijación flojos','Tolerancias de montaje fuera de norma',
      'Falta de alineación láser en el montaje','Desgaste desigual de componentes',
      'Acumulación de material en partes rotativas'],
    probable:0,
    porques:['¿Por qué vibra/se desalinea? → Desalineación entre motor y equipo conducido',
      '¿Por qué está desalineado? → Montaje sin alineación de precisión tras la última intervención',
      '¿Por qué no se alineó con precisión? → No se usó alineación láser ni se verificó tolerancia',
      '¿Por qué no se verificó? → No existe procedimiento estándar de alineación en montaje',
      '¿Por qué no hay procedimiento? → Falta estandarizar prácticas de montaje mecánico'],
    acciones:[
      {a:'Alinear y balancear el conjunto motor-equipo',t:'INMEDIATA'},
      {a:'Verificar y apretar anclajes/acoplamiento',t:'INMEDIATA'},
      {a:'Implementar alineación láser estándar en montajes',t:'PERMANENTE'},
      {a:'Incorporar análisis de vibraciones para detección temprana',t:'PERMANENTE'}],
  },
  {
    id:'lubricacion', nombre:'Falla de lubricación',
    keys:['lubrica','engrase','grasa','aceite','sin lubric','falta de aceite','nivel de aceite','reseco','fricci','agarrotamiento','roce'],
    causas:['Falta de lubricación (frecuencia insuficiente)','Lubricante inadecuado para la aplicación',
      'Lubricante degradado o contaminado','Nivel de aceite bajo por fuga',
      'Exceso de lubricante que genera sobrecalentamiento','Punto de engrase obstruido',
      'Sistema de lubricación automático con falla','Mezcla de lubricantes incompatibles',
      'Falta de relubricación tras mantenimiento','Sello que permite entrada de contaminantes',
      'Temperatura que degrada el lubricante','Intervalo de cambio no definido',
      'Vida útil del lubricante superada'],
    probable:0,
    porques:['¿Por qué falló por lubricación? → Falta de lubricación en la frecuencia requerida',
      '¿Por qué faltó lubricación? → No estaba definida la frecuencia/responsable de engrase',
      '¿Por qué no estaba definida? → El punto no se incluyó en la rutina de lubricación',
      '¿Por qué no se incluyó? → No se levantó la carta de lubricación del equipo',
      '¿Por qué no hay carta de lubricación? → Falta gestión de lubricación como tarea crítica'],
    acciones:[
      {a:'Lubricar/relubricar con el lubricante correcto',t:'INMEDIATA'},
      {a:'Verificar nivel, estado y puntos de engrase',t:'INMEDIATA'},
      {a:'Definir carta de lubricación (punto, lubricante, frecuencia)',t:'PERMANENTE'},
      {a:'Implementar control de lubricación y análisis de aceite',t:'PERMANENTE'}],
  },
  {
    id:'rodamiento', nombre:'Falla de rodamiento / cojinete',
    keys:['rodamiento','cojinete','balero','descanso','bearing','pista','rolinera','chumacera','rodaje','juego en el eje','calentamiento de descanso'],
    causas:['Falta de lubricación del rodamiento','Contaminación del rodamiento (polvo/agua)',
      'Sobrecarga radial o axial','Desalineación que carga el rodamiento',
      'Montaje incorrecto (golpe en pista)','Fatiga por vida útil superada',
      'Corriente eléctrica circulante (fluting)','Vibración transmitida desde otro componente',
      'Lubricante inadecuado o degradado','Sello dañado que deja entrar contaminante',
      'Holgura/ajuste fuera de tolerancia','Temperatura excesiva que degrada la grasa',
      'Falsa brinelación por equipo detenido con vibración'],
    probable:0,
    porques:['¿Por qué falló el rodamiento? → Falta de lubricación / contaminación',
      '¿Por qué faltó lubricación o se contaminó? → Sello dañado y sin relubricación programada',
      '¿Por qué no se relubricó? → El rodamiento no está en la carta de lubricación',
      '¿Por qué no está? → No se levantaron los componentes críticos del equipo',
      '¿Por qué no se levantaron? → Falta análisis de criticidad de componentes'],
    acciones:[
      {a:'Reemplazar rodamiento y verificar sellos',t:'INMEDIATA'},
      {a:'Revisar alineación, carga y lubricación',t:'INMEDIATA'},
      {a:'Incluir rodamiento en carta de lubricación y plan preventivo',t:'PERMANENTE'},
      {a:'Implementar monitoreo de vibración/temperatura de descansos',t:'PERMANENTE'}],
  },
  {
    id:'transmision', nombre:'Falla de transmisión (correa/cadena/engranaje)',
    keys:['correa','cadena','engranaje','piñon','polea','catalina','reductor','transmisi','banda','dentado','patina la correa','correa rota','cadena salt','acople'],
    causas:['Correa/cadena desgastada o destensada','Desalineación de poleas/sprockets',
      'Tensión incorrecta de la transmisión','Diente de engranaje roto o desgastado',
      'Falta de lubricación en cadena/reductor','Sobrecarga que supera la capacidad',
      'Contaminación con material abrasivo','Polea/catalina desgastada',
      'Reductor con falla interna','Antigüedad del elemento de transmisión',
      'Montaje incorrecto del elemento','Vibración que acelera el desgaste',
      'Material/repuesto de transmisión inadecuado'],
    probable:0,
    porques:['¿Por qué falló la transmisión? → Correa/cadena desgastada y destensada',
      '¿Por qué se desgastó/destensó? → No se inspeccionó tensión ni estado',
      '¿Por qué no se inspeccionó? → No hay rutina de revisión de transmisiones',
      '¿Por qué no hay rutina? → Componente no incluido en plan preventivo',
      '¿Por qué no se incluyó? → Falta levantamiento de componentes críticos'],
    acciones:[
      {a:'Reemplazar / tensionar correa o cadena',t:'INMEDIATA'},
      {a:'Alinear poleas/sprockets y revisar reductor',t:'INMEDIATA'},
      {a:'Definir inspección periódica de tensión y desgaste',t:'PERMANENTE'},
      {a:'Incorporar transmisiones al plan de mantenimiento preventivo',t:'PERMANENTE'}],
  },
  {
    id:'neumatica_hidraulica', nombre:'Falla neumática / hidráulica',
    keys:['neumat','hidraul','aire comprimido','presion de aire','cilindro','piston','actuador','electrovalv','solenoide','manguera','aceite hidraul','sin aire','fuga de aire'],
    causas:['Fuga de aire/aceite en línea o conexión','Electroválvula/solenoide con falla',
      'Cilindro/actuador con sellos desgastados','Presión de suministro insuficiente',
      'Filtro/regulador (FRL) obstruido','Manguera fisurada o reventada',
      'Aceite hidráulico contaminado','Bomba hidráulica con bajo rendimiento',
      'Aire con humedad/condensado','Válvula de control mal ajustada',
      'Acumulador descargado','Conexión floja o mal sellada',
      'Temperatura que degrada los sellos'],
    probable:0,
    porques:['¿Por qué falló el sistema neumático/hidráulico? → Fuga que reduce la presión',
      '¿Por qué hay fuga? → Sello/manguera desgastado por vida útil',
      '¿Por qué no se reemplazó? → No hay control de vida útil de sellos/mangueras',
      '¿Por qué no hay control? → Componentes no incluidos en plan preventivo',
      '¿Por qué no se incluyeron? → Falta levantamiento de componentes neumáticos/hidráulicos'],
    acciones:[
      {a:'Detectar y reparar la fuga; restablecer la presión',t:'INMEDIATA'},
      {a:'Revisar electroválvulas, FRL y estado del aceite',t:'INMEDIATA'},
      {a:'Definir reemplazo programado de sellos/mangueras',t:'PERMANENTE'},
      {a:'Implementar control de humedad y calidad del aceite hidráulico',t:'PERMANENTE'}],
  },
  {
    id:'control_automatizacion', nombre:'Falla de control / automatización (PLC/HMI)',
    keys:['plc','hmi','scada','programa','software','automatiz','tarjeta','entrada/salida','comunicaci','red industrial','profibus','profinet','ethernet','pantalla congelada','logica','variador no responde'],
    causas:['Falla en PLC o tarjeta de E/S','Pérdida de comunicación en red industrial',
      'Programa/lógica con error o corrupción','HMI/pantalla congelada o sin respuesta',
      'Sensor de entrada entregando dato erróneo','Falla de alimentación al controlador',
      'Configuración de parámetros incorrecta','Actualización de software no validada',
      'Interferencia eléctrica en señales','Conector/cableado de red dañado',
      'Variador sin respuesta a la orden de control','Pérdida del respaldo del programa',
      'Falta de respaldo de la lógica de control'],
    probable:0,
    porques:['¿Por qué falló el control? → Pérdida de comunicación en la red industrial',
      '¿Por qué se perdió comunicación? → Conector/cable de red dañado o interferencia',
      '¿Por qué se dañó/interfirió? → Cableado sin mantenimiento ni apantallamiento adecuado',
      '¿Por qué no se mantiene? → No hay rutina de inspección de redes y tableros de control',
      '¿Por qué no hay rutina? → Falta plan de mantenimiento de sistemas de automatización'],
    acciones:[
      {a:'Diagnosticar PLC/comunicación y restablecer el control',t:'INMEDIATA'},
      {a:'Verificar tarjetas de E/S, cableado de red y parámetros',t:'INMEDIATA'},
      {a:'Mantener respaldo actualizado de la lógica de control',t:'PERMANENTE'},
      {a:'Incluir redes y tableros de control en el plan preventivo',t:'PERMANENTE'}],
  },
];

const GENERICO = {
  nombre:'Análisis general',
  causas:['Falta de mantenimiento preventivo','Error operacional','Desgaste de componente',
    'Falta de lubricación','Falla eléctrica','Material/repuesto inadecuado','Falta de inspección',
    'Sobrecarga del equipo','Condición ambiental adversa','Falta de capacitación',
    'Procedimiento inexistente o no seguido','Falla de diseño','Antigüedad del activo'],
  probable:0,
  porques:['¿Por qué ocurrió la falla? → (completar según análisis del equipo)',
    '¿Por qué ocurrió esa causa? → (profundizar)',
    '¿Por qué? → (profundizar)',
    '¿Por qué? → (profundizar)',
    '¿Por qué? → (causa raíz)'],
  acciones:[
    {a:'Acción correctiva inmediata para restablecer operación',t:'INMEDIATA'},
    {a:'Inspeccionar componentes asociados',t:'INMEDIATA'},
    {a:'Incorporar al plan de mantenimiento preventivo',t:'PERMANENTE'},
    {a:'Estandarizar el procedimiento y capacitar al personal',t:'PERMANENTE'}],
};

// Categorías 6M (Ishikawa) para clasificar cada causa
const CATS_6M = ['Máquina','Mano de obra','Método','Material','Medición','Medio ambiente'];
// Normaliza texto para comparar: minúsculas y sin tildes/diacríticos
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }

// Asigna una categoría 6M sugerida según el texto de la causa (editable luego)
function categoria6M(txt){
  const t = norm(txt);
  const has = (...ks)=> ks.some(k=>t.includes(norm(k)));
  if(has('sensor','calibr','medici','señal','transmisor','medida','lectura')) return 'Medición';
  if(has('humedad','salino','ambient','temperatura','corros','cuerpo extra','sarro','incrusta','agua')) return 'Medio ambiente';
  if(has('operacional','operador','capacit','manipula','error humano','maniobra','mala operac')) return 'Mano de obra';
  if(has('procedimiento','preventiv','inspecc','mantenimiento','limpieza','lubrica','estándar','estandar','plan de','antigüedad','antiguedad')) return 'Método';
  if(has('repuesto','material','junta','empaquet','recubrim','sello','retén','reten','fusible','inadecuado','diseño','diseno')) return 'Material';
  return 'Máquina';
}

// Grupos de modos que comparten un mismo ORIGEN físico de falla.
// Permiten asociar "causas mixtas": cuando una falla (ej. obstrucción) puede
// originarse en varios mecanismos, se incluyen causas de todos los modos del grupo.
const GRUPOS_ORIGEN = [
  ['atasco','incrustacion','bajo_rendimiento','contaminacion'],                              // Obstrucción / flujo
  ['vibracion','rotura','estructural','ruido','desalineacion','rodamiento','transmision'],   // Mecánico / estructural
  ['electrica','instrumentacion','erratico','paro_inesperado','control_automatizacion'],     // Eléctrico / control
  ['fuga','fuga_interna','corrosion','neumatica_hidraulica'],                                // Sellado / integridad / presión
  ['sobrecalentamiento','bajo_rendimiento','lubricacion','rodamiento'],                      // Térmico / lubricación
];
// Devuelve los IDs de modos que comparten origen con el modo dado
function modosRelacionados(id){
  const set = new Set();
  for(const g of GRUPOS_ORIGEN){ if(g.includes(id)) g.forEach(x=>{ if(x!==id) set.add(x); }); }
  return [...set];
}

// Tipos de equipo: según el nombre del Equipo/Componente se priorizan los modos
// de falla típicos de ese activo y se inyectan sus causas características.
const EQUIPOS_TIPO = [
  { id:'bomba', nombre:'Bomba', keys:['bomba','bba','pump','centrifuga','impuls','recircula'],
    modos:['bajo_rendimiento','fuga','rodamiento','desalineacion','sobrecalentamiento','lubricacion'],
    causas:['Cavitación por baja presión de succión','Desgaste del impulsor/rodete',
      'Sello mecánico desgastado (fuga)','Filtro de succión obstruido','Aire en la succión'] },
  { id:'motor', nombre:'Motor eléctrico', keys:['motor','electromotor'],
    modos:['electrica','sobrecalentamiento','rodamiento','vibracion','desalineacion'],
    causas:['Bobinado quemado / aislación deteriorada','Rodamiento del motor dañado',
      'Sobrecarga eléctrica (corriente alta)','Falla de aislación a tierra','Ventilación del motor obstruida'] },
  { id:'valvula', nombre:'Válvula', keys:['valvula','actuador de valvula','globo','mariposa','compuerta'],
    modos:['fuga_interna','fuga','atasco','corrosion','neumatica_hidraulica'],
    causas:['Asiento de válvula desgastado (no sella)','Actuador neumático con falla',
      'Vástago agarrotado','Empaquetadura con fuga'] },
  { id:'compresor', nombre:'Compresor', keys:['compresor','compres'],
    modos:['sobrecalentamiento','fuga','bajo_rendimiento','vibracion','lubricacion','rodamiento'],
    causas:['Válvulas de compresión desgastadas','Bajo nivel / calidad de aceite',
      'Filtro de aspiración obstruido','Fuga en línea de descarga'] },
  { id:'reductor', nombre:'Reductor / Caja de engranajes', keys:['reductor','caja reductora','gearbox','engranaj'],
    modos:['transmision','lubricacion','rodamiento','sobrecalentamiento','vibracion'],
    causas:['Diente de engranaje picado o roto','Nivel / estado de aceite del reductor',
      'Rodamiento interno dañado','Sobrecarga del reductor'] },
  { id:'transportador', nombre:'Transportador / Cinta', keys:['transportador','cinta','correa transport','sinfin','sin fin','tornillo transport','elevador','redler','noria','rosca'],
    modos:['transmision','atasco','rotura','desalineacion','rodamiento'],
    causas:['Cinta / banda descentrada o rota','Atasco por acumulación de material',
      'Rodillo / polín trabado','Cadena del transportador desgastada'] },
  { id:'ventilador', nombre:'Ventilador / Soplador', keys:['ventilador','soplador','extractor','blower'],
    modos:['vibracion','desalineacion','rodamiento','sobrecalentamiento'],
    causas:['Desbalanceo del rotor / aspas','Acumulación de material en aspas','Rodamiento del ventilador dañado'] },
  { id:'intercambiador', nombre:'Intercambiador / Chiller', keys:['intercambiador','chiller','condensador','evaporador','enfriador','radiador','serpentin'],
    modos:['incrustacion','fuga','corrosion','bajo_rendimiento'],
    causas:['Incrustación / fouling en placas o tubos','Fuga de refrigerante',
      'Suciedad que reduce el intercambio térmico','Corrosión de tubos'] },
  { id:'tablero', nombre:'Tablero / Control eléctrico', keys:['tablero','variador','vfd','ccm','partidor','contactor'],
    modos:['electrica','control_automatizacion','instrumentacion','erratico'],
    causas:['Componente de control quemado (relé / contactor)','Sobretemperatura del tablero',
      'Falla de comunicación','Borne / conexión floja'] },
  { id:'estanque', nombre:'Estanque / Tanque / Silo', keys:['estanque','tanque','silo','tolva','deposito'],
    modos:['corrosion','fuga','atasco','estructural'],
    causas:['Corrosión de pared o fondo','Fuga por soldadura / unión',
      'Material adherido / apelmazado','Fisura estructural'] },
];
// Detecta el/los tipos de equipo a partir del Equipo y Componente
function tiposEquipo(adf){
  const t = norm([adf.equipo, adf.componente].join(' '));
  if(!t.trim()) return [];
  return EQUIPOS_TIPO.filter(e=> e.keys.some(k=> t.includes(norm(k))));
}

// Detecta TODOS los modos de falla que coinciden con el texto (ordenados por puntaje).
// `textoFuerte` (síntoma + modo de falla) pesa el doble para afinar el modo principal.
function detectarModos(texto, textoFuerte){
  const t  = norm(texto);
  const tf = norm(textoFuerte || '');
  const hits = [];
  for(const m of CATALOGO){
    let score=0;
    for(const k of m.keys){
      const nk = norm(k);
      if(t.includes(nk)){ score++; if(tf && tf.includes(nk)) score++; }
    }
    if(score>0) hits.push({ modo:m, score });
  }
  hits.sort((a,b)=> b.score - a.score);
  return hits;
}
// Compatibilidad: mejor modo individual
function detectarModo(texto){
  const hits = detectarModos(texto);
  return hits.length ? hits[0].modo : GENERICO;
}

// Genera análisis completo a partir de los datos de la falla.
// Asocia causas MIXTAS de acuerdo al origen de falla (varios modos a la vez).
function generarAnalisis(adf){
  const texto  = [adf.sintoma, adf.modoFalla, adf.w_que, adf.w_como, adf.w_cual, adf.accionCorrectiva].join(' ');
  const fuerte = [adf.sintoma, adf.modoFalla].join(' '); // pesa el doble en la detección
  const hits = detectarModos(texto, fuerte);

  // Inferencia por tipo de equipo/componente
  const tipos = tiposEquipo(adf);
  const tipoModoIds = new Set();
  tipos.forEach(tp=> tp.modos.forEach(id=> tipoModoIds.add(id)));
  // Bonus de puntaje a los modos propios del tipo de equipo y re-orden
  if(tipoModoIds.size){
    hits.forEach(h=>{ if(tipoModoIds.has(h.modo.id)) h.score += 2; });
    hits.sort((a,b)=> b.score - a.score);
  }

  // Modo principal: el mejor del texto; si no hubo coincidencia pero sí tipo de equipo,
  // se usa el primer modo típico de ese equipo en vez de "Análisis general".
  let primary;
  if(hits.length) primary = hits[0].modo;
  else if(tipoModoIds.size) primary = CATALOGO.find(m=> m.id===[...tipoModoIds][0]) || GENERICO;
  else primary = GENERICO;
  const primaryId = primary.id || '';

  const causas = [];
  const vistos = new Set();
  const push = (txt, probable, origen) => {
    const key = String(txt).toLowerCase().trim();
    if(!key || vistos.has(key)) return;
    vistos.add(key);
    causas.push({ txt, probable, cat: categoria6M(txt), origen });
  };

  // 1) Causas del modo principal (la sugerida queda marcada como probable)
  primary.causas.forEach((c,i)=> push(c, i===primary.probable, primary.nombre));
  // 1b) Causas características del tipo de equipo (alta relevancia)
  tipos.forEach(tp=> (tp.causas||[]).forEach(c=> push(c, false, 'Equipo: '+tp.nombre)));
  // 2) Causas de los demás modos detectados en el texto (causas mixtas)
  hits.slice(1).forEach(({modo})=> modo.causas.slice(0,6).forEach(c=> push(c, false, modo.nombre)));
  // 2b) Causas de los modos típicos del equipo aunque no salieran en el texto
  tipoModoIds.forEach(id=>{
    if(id===primaryId || hits.some(h=>h.modo.id===id)) return;
    const m = CATALOGO.find(x=>x.id===id);
    if(m) m.causas.slice(0,4).forEach(c=> push(c, false, m.nombre));
  });
  // 3) Causas de modos que comparten origen aunque no hayan aparecido en el texto
  modosRelacionados(primaryId).forEach(id=>{
    if(hits.some(h=>h.modo.id===id)) return; // ya incluido arriba
    const m = CATALOGO.find(x=>x.id===id);
    if(m) m.causas.slice(0,4).forEach(c=> push(c, false, m.nombre));
  });
  // 4) Causas generales transversales (siempre útiles como posibles fallas a descartar)
  GENERICO.causas.forEach(c=> push(c, false, 'General'));

  // Tope para no saturar la lista (las más relevantes quedan primero)
  const MAX_CAUSAS = 30;
  const causasFinal = causas.slice(0, MAX_CAUSAS);

  // Orígenes adicionales realmente presentes en las causas (excluye el principal)
  const otros = [...new Set(causasFinal.map(c=>c.origen))].filter(o=> o && o!==primary.nombre);
  return {
    modoDetectado: primary.nombre,
    tipoEquipo: tipos.map(t=>t.nombre),
    modosMixtos: otros,
    causas: causasFinal,
    porques: (primary.porques || GENERICO.porques).slice(),
    planes: (primary.acciones || GENERICO.acciones).map(a=>({ actividad:a.a, tipo:a.t, responsable:'', fecha:'' })),
  };
}

/* ═══════════════════════════════════════════════════════════
   AUTENTICACIÓN
   ═══════════════════════════════════════════════════════════ */
// Usuarios base del portal ADF (se crean en Auth al primer login)
const SEED_USERS = [
  { email:'jgomezf@sopraval.cl', name:'Jonathan Gómez',  role:'lider',   cargo:'Ingeniero en Confiabilidad' },
  { email:'gvelizm@sopraval.cl', name:'Gino Véliz',      role:'lider',   cargo:'Ingeniero en Mantenimiento' },
  { email:'tecnico@sopraval.cl', name:'Técnico Sopraval', role:'tecnico', cargo:'Técnico de Mantenimiento' },
];
const PASS_BASE = 'Sopraval2026';

$('form-login').addEventListener('submit', async e=>{
  e.preventDefault();
  const email=$('login-email').value.trim().toLowerCase();
  const pass =$('login-pass').value;
  const btn = e.target.querySelector('button[type=submit]');
  $('login-error').textContent='';
  if(!email||!pass){ $('login-error').textContent='Ingrese correo y contraseña.'; return; }
  btn.disabled=true; btn.textContent='Ingresando...';
  try{
    await fauth.signInWithEmailAndPassword(email, pass);
  }catch(err){
    if(['auth/user-not-found','auth/invalid-credential','auth/wrong-password'].includes(err.code)){
      const seed = SEED_USERS.find(s=>s.email===email);
      if(seed){
        // primer ingreso de un usuario base → crear cuenta en Auth
        try{ await fauth.createUserWithEmailAndPassword(email, pass); }
        catch(ce){ $('login-error').textContent = ce.code==='auth/email-already-in-use'
          ? 'Contraseña incorrecta.' : 'No se pudo crear la cuenta: '+ce.message; }
      }else{
        $('login-error').textContent='Correo o contraseña incorrectos.';
      }
    }else if(err.code==='auth/too-many-requests'){
      $('login-error').textContent='Demasiados intentos. Espere unos minutos.';
    }else{
      $('login-error').textContent='Error al iniciar sesión.';
    }
  }finally{ btn.disabled=false; btn.textContent='Ingresar al sistema'; }
});

$('btn-logout').addEventListener('click', ()=> fauth.signOut());

fauth.onAuthStateChanged(async fbUser=>{
  if(!fbUser){
    CU=null;
    $('screen-app').classList.remove('active');
    $('screen-login').classList.add('active');
    return;
  }
  await cargarUsuarios();
  const email=fbUser.email.toLowerCase();
  let u = _cache.users.find(x=>x.email===email);
  if(!u){
    // crear perfil: usar datos base si es usuario semilla, si no técnico genérico
    const seed = SEED_USERS.find(s=>s.email===email);
    u = seed
      ? { id:fbUser.uid, email, name:seed.name, role:seed.role, cargo:seed.cargo }
      : { id:fbUser.uid, email, name:email.split('@')[0], role:'tecnico', cargo:'Técnico de Mantenimiento' };
    await fdb.collection(COL_USERS).doc(u.id).set(u);
    _cache.users.push(u);
  }
  CU=u;
  $('screen-login').classList.remove('active');
  $('screen-app').classList.add('active');
  arrancarApp();
});

async function cargarUsuarios(){
  const snap=await fdb.collection(COL_USERS).get();
  _cache.users = snap.docs.map(d=>({ id:d.id, ...d.data() }));
}

/* ═══════════════════════════════════════════════════════════
   ARRANQUE APP
   ═══════════════════════════════════════════════════════════ */
const TABS = {
  tecnico: [['inicio','🏠 Inicio'],['nuevo','➕ Nuevo ADF'],['listado','📋 Mis ADF'],['seguimiento','📌 Seguimiento'],['tiempos','⏱ Control de Tiempos']],
  lider:   [['inicio','🏠 Inicio'],['nuevo','➕ Nuevo ADF'],['listado','📋 Todos los ADF'],['seguimiento','📌 Seguimiento'],['tiempos','⏱ Control de Tiempos'],['mantenimiento','🔧 Planes PM'],['catalogo','📚 Catálogo'],['usuarios','👥 Usuarios']],
};

function arrancarApp(){
  $('nav-avatar').textContent = initials(CU.name);
  $('nav-name').textContent = CU.name;
  $('nav-role').textContent = CU.cargo || (CU.role==='lider'?'Líder':'Técnico');
  renderTabs();
  escucharADFs();
  if(esLider()) escucharPlanesMP();
  irTab('inicio');
}

function renderTabs(){
  const tabs = (TABS[CU.role] || TABS.tecnico).slice();
  if(esAdmin()){
    const item = ['confiabilidad','📊 Indicadores'];
    const idx = tabs.findIndex(t=>t[0]==='tiempos');
    if(idx>=0) tabs.splice(idx+1,0,item); else tabs.push(item);
  }
  $('tabs-nav').innerHTML = tabs.map(([k,l])=>
    `<button class="tab-btn" data-tab="${k}">${l}</button>`).join('');
  $('tabs-nav').querySelectorAll('.tab-btn').forEach(b=>
    b.addEventListener('click', ()=>irTab(b.dataset.tab)));
}

function irTab(tab){
  if(tab==='confiabilidad' && !esAdmin()) tab='inicio';
  _activeTab=tab;
  $('tabs-nav').querySelectorAll('.tab-btn').forEach(b=>
    b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  const pane=$('pane-'+tab); if(pane) pane.classList.add('active');
  if(tab==='inicio') renderInicio();
  if(tab==='listado') renderListado();
  if(tab==='nuevo') renderNuevo();
  if(tab==='seguimiento') renderSeguimiento();
  if(tab==='tiempos') renderTiempos();
  if(tab==='confiabilidad') renderConfiabilidad();
  if(tab==='mantenimiento') renderMantenimiento();
  if(tab==='catalogo') renderCatalogo();
  if(tab==='usuarios') renderUsuarios();
}

// Listener en tiempo real
function escucharADFs(){
  fdb.collection(COL_ADF).onSnapshot(snap=>{
    _cache.adfs = snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
    if(['inicio','listado','seguimiento','tiempos','confiabilidad'].includes(_activeTab)) irTab(_activeTab);
  });
}

function misADFs(){
  return esLider() ? _cache.adfs : _cache.adfs.filter(a=> a.creadorId===CU.id || a.creadorEmail===CU.email);
}

/* ═══════════════════════════════════════════════════════════
   INICIO / DASHBOARD
   ═══════════════════════════════════════════════════════════ */
function renderInicio(){
  const data = misADFs();
  const c = est => data.filter(a=>a.estado===est).length;
  const abiertos = data.filter(a=>a.estado!=='Cerrado').length;
  const recurrentes = data.filter(a=>a.tipoProblema==='Recurrente' && a.estado!=='Cerrado').length;
  $('pane-inicio').innerHTML = `
    <div class="page-title">Bienvenido, ${esc(CU.name.split(' ')[0])} 👋</div>
    <div class="page-sub">Panel de Análisis de Falla · ${esLider()?'Vista global':'Tus análisis'}</div>
    <div class="kpi-grid">
      <div class="kpi accent"><div class="k-val">${data.length}</div><div class="k-lbl">ADF totales</div></div>
      <div class="kpi"><div class="k-val">${abiertos}</div><div class="k-lbl">Abiertos</div></div>
      <div class="kpi"><div class="k-val">${c('Seguimiento')}</div><div class="k-lbl">En seguimiento</div></div>
      <div class="kpi"><div class="k-val">${c('Cerrado')}</div><div class="k-lbl">Cerrados</div></div>
      <div class="kpi"><div class="k-val" style="color:var(--red)">${recurrentes}</div><div class="k-lbl">Recurrentes abiertos</div></div>
    </div>
    ${esAdmin()?miniIndicadoresMes():''}
    <div class="card">
      <div class="card-title">⚡ Acción rápida</div>
      <div class="card-sub">Ingresa una nueva falla y deja que el sistema proponga el análisis de causa raíz.</div>
      <button class="btn-primary" onclick="irTab('nuevo')">➕ Registrar nueva falla (ADF)</button>
    </div>
    <div class="section-head"><h3>Últimos análisis</h3></div>
    ${tablaADF(data.slice(0,6))}
  `;
}

// Mini-panel de indicadores del mes actual (solo admins)
function miniIndicadoresMes(){
  const mesActual = new Date().toISOString().slice(0,7);
  const data = misADFs().filter(a=>(a.fecha||'').slice(0,7)===mesActual);
  const m = calcConfiabilidad(data);
  const dc = DISP_COLOR(m.dispGlobal);
  const nombreMes = new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'});
  return `
    <div class="card mini-ind-card">
      <div class="card-title">📊 Indicadores del mes — ${nombreMes}</div>
      <div class="mini-ind-grid">
        <div class="mini-ind"><div class="mi-val">${data.length}</div><div class="mi-lbl">Fallas del mes</div></div>
        <div class="mini-ind"><div class="mi-val">${fmtDur(m.mttrGlobal)}</div><div class="mi-lbl">MTTR</div></div>
        <div class="mini-ind"><div class="mi-val">${fmtDur(m.mtbfGlobal)}</div><div class="mi-lbl">MTBF</div></div>
        <div class="mini-ind"><div class="mi-val" style="color:${dc}">${m.dispGlobal!=null?m.dispGlobal.toFixed(1)+'%':'—'}</div><div class="mi-lbl">Disponibilidad</div></div>
        <div class="mini-ind"><div class="mi-val">${fmtDur(m.horasGlobal)}</div><div class="mi-lbl">Horas detenido</div></div>
      </div>
      <button class="btn-ghost btn-sm" onclick="irTab('confiabilidad')" style="margin-top:12px">Ver indicadores completos →</button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   LISTADO
   ═══════════════════════════════════════════════════════════ */
function renderListado(){
  const data=misADFs();
  $('pane-listado').innerHTML = `
    <div class="page-title">${esLider()?'Todos los ADF':'Mis ADF'}</div>
    <div class="page-sub">${data.length} registro(s) de análisis de falla</div>
    ${tablaADF(data)}
  `;
}

function tablaADF(list){
  if(!list.length) return `<div class="empty"><div class="e-icon">📭</div>No hay ADF registrados aún.</div>`;
  return `<div class="tbl-wrap"><table class="data">
    <thead><tr><th>Folio</th><th>Fecha</th><th>Área</th><th>Equipo</th><th>Síntoma</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
    <tbody>${list.map(a=>`
      <tr class="row-click" onclick="abrirADF('${a.id}')">
        <td class="nowrap"><b>${esc(a.folio||'—')}</b></td>
        <td class="nowrap">${fmtD(a.fecha)}</td>
        <td>${esc(a.area||'—')}</td>
        <td>${esc(a.equipo||'—')}</td>
        <td>${esc((a.sintoma||'—').slice(0,40))}</td>
        <td>${a.tipoProblema==='Recurrente'?'<span class="badge b-recurrente">Recurrente</span>':'<span class="badge b-esporadico">Esporádico</span>'}</td>
        <td>${badge(a.estado)}</td>
        <td><button class="btn-ghost btn-sm">Abrir</button></td>
      </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ═══════════════════════════════════════════════════════════
   NUEVO ADF (wizard)
   ═══════════════════════════════════════════════════════════ */
function nuevoBorrador(){
  return {
    fecha:new Date().toISOString().slice(0,10), area:'', folio:'', linea:'', equipo:'', codSap:'', componente:'',
    fechaInicio:'', horaInicio:'', fechaMarcha:'', horaMarcha:'', minutosPerdidos:'',
    ot:'', afectoProduccion:'No', tipoProblema:'Esporádico',
    sintoma:'', modoFalla:'', accionCorrectiva:'',
    participantes:[],
    equipoAnalisis:[],
    w_que:'', w_cuando:'', w_donde:'', w_quien:'', w_cual:'', w_como:'',
    imagen:'',
    condiciones:{ estado:'', estadoOtro:'', turno:'', pmVencido:'No', intervencion:'No', intervencionDet:'', fueraParam:'No', fueraParamDet:'' },
    analisis:null,
  };
}

function renderNuevo(){
  if(!_wizard) _wizard = nuevoBorrador();
  const w=_wizard;
  // El equipo de análisis incluye por defecto a quien levanta el ADF
  if(!w.equipoAnalisis || !w.equipoAnalisis.length){
    w.equipoAnalisis = [{ nombre: CU?.name || '', area: '', autor:true }];
  }
  const co = w.condiciones || {};
  $('pane-nuevo').innerHTML = `
    <div class="page-title">➕ Nuevo Análisis de Falla</div>
    <div class="page-sub">Ingresa lo que observaste. El análisis de causa raíz se propone automáticamente.</div>

    <div class="card">
      <div class="card-title">1 · Datos Generales</div>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="field"><label>Fecha</label><input type="date" id="f-fecha" value="${w.fecha}"></div>
        <div class="field"><label>N° Folio (opcional)</label><input id="f-folio" value="${esc(w.folio)}" placeholder="auto si vacío"></div>
      </div>
      <div class="maq-lookup-box">
        <div class="maq-lookup-title">🏭 Máquina / Equipo</div>
        <div class="field">
          <label>Buscar por Cód. SAP o nombre de equipo</label>
          <div class="sap-wrap">
            <input id="sap-buscar" type="text" autocomplete="off" placeholder="Ej: 10044276  ó  TRANSP ACUMULADOR..." value="">
            <div id="sap-drop" class="sap-drop" style="display:none"></div>
          </div>
        </div>
        <div class="grid-3 maq-cascade">
          <div class="field">
            <label>Área</label>
            <select id="sel-area">
              <option value="">— Área —</option>
              ${[...new Set(MAQUINAS_PLANTA.map(m=>m.area))].sort().map(a=>`<option value="${esc(a)}" ${w.area===a?'selected':''}>${esc(a)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Línea</label>
            <select id="sel-linea"><option value="">— Línea —</option></select>
          </div>
          <div class="field">
            <label>Equipo</label>
            <select id="sel-equipo"><option value="">— Equipo —</option></select>
          </div>
        </div>
        <div id="maq-badge" class="maq-badge" style="display:${w.equipo?'flex':'none'}">
          <span class="maq-badge-ico">✅</span>
          <div class="maq-badge-info">
            <strong id="maq-badge-nombre">${esc(w.equipo||'')}</strong>
            <span id="maq-badge-meta">${w.area||''} · ${w.linea||''} · SAP: ${w.codSap||''}</span>
          </div>
          <button type="button" id="maq-clear" class="maq-clear-btn">✕ Limpiar</button>
        </div>
        <div class="field" style="margin-top:10px">
          <label>Componente afectado <small style="color:var(--gray)">(opcional — permite analizar qué componentes fallan más)</small></label>
          <input id="f-componente" value="${esc(w.componente||'')}" placeholder="Ej: rodamiento lado motor, correa, sensor inductivo, sello...">
        </div>
      </div>
      <input type="hidden" id="f-area" value="${esc(w.area)}">
      <input type="hidden" id="f-linea" value="${esc(w.linea)}">
      <input type="hidden" id="f-equipo" value="${esc(w.equipo)}">
      <input type="hidden" id="f-sap" value="${esc(w.codSap)}">

      <div class="field" style="margin-top:6px">
        <label>👥 Participantes en la atención de la falla <small style="color:var(--gray);font-weight:400">(opcional — supervisor y técnicos que repararon)</small></label>
        <div id="part-list">${(w.participantes||[]).map((p,i)=>partRowHTML(p,i)).join('')}</div>
        <button type="button" class="btn-ghost btn-sm" onclick="agregarParticipante()">+ Agregar participante</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">2 · Datos de la Avería</div>
      <div class="grid-3">
        <div class="field"><label>Fecha inicio <span class="req">*</span></label><input type="date" id="f-finicio" value="${w.fechaInicio}"></div>
        <div class="field"><label>Hora inicio <span class="req">*</span></label><input type="time" id="f-hinicio" value="${w.horaInicio}"></div>
        <div class="field"><label>Minutos perdidos producción <small style="color:var(--gray)">(automático)</small></label><input type="number" id="f-min" value="${esc(w.minutosPerdidos)}" readonly style="background:var(--gray-lt)"></div>
        <div class="field"><label>Fecha puesta en marcha <span class="req">*</span></label><input type="date" id="f-fmarcha" value="${w.fechaMarcha}"></div>
        <div class="field"><label>Hora puesta en marcha <span class="req">*</span></label><input type="time" id="f-hmarcha" value="${w.horaMarcha}"></div>
        <div class="field"><label>OT</label><input id="f-ot" value="${esc(w.ot)}"></div>
        <div class="field"><label>¿Afectó producción?</label><select id="f-afecto"><option ${w.afectoProduccion==='Sí'?'selected':''}>Sí</option><option ${w.afectoProduccion==='No'?'selected':''}>No</option></select></div>
        <div class="field"><label>Tipo de problema</label><select id="f-tipo"><option ${w.tipoProblema==='Esporádico'?'selected':''}>Esporádico</option><option ${w.tipoProblema==='Recurrente'?'selected':''}>Recurrente</option></select></div>
      </div>
      <div class="field"><label>Síntoma observado *</label><textarea id="f-sintoma" placeholder="¿Qué se observó? Ej: motor con sobrecalentamiento y ruido">${esc(w.sintoma)}</textarea></div>
      <div class="field"><label>Modo de falla *</label><textarea id="f-modo" placeholder="Ej: detención por protección térmica">${esc(w.modoFalla)}</textarea></div>
      <div class="field"><label>Acción correctiva aplicada</label><textarea id="f-accion" placeholder="¿Qué se hizo para restablecer?">${esc(w.accionCorrectiva)}</textarea></div>
    </div>

    <div class="card cond-card">
      <div class="card-title">🔎 Condiciones al momento de la falla <small style="color:var(--gray);font-weight:400">— ayudan a identificar la causa</small></div>
      <div class="grid-3">
        <div class="field"><label>Estado del equipo al fallar</label>
          <select id="c-estado"><option value="">— Seleccionar —</option>
            ${['Marcha normal','Arranque','Parada / detención','En mantención','Cambio de formato','Otro'].map(o=>`<option ${co.estado===o?'selected':''}>${o}</option>`).join('')}
          </select></div>
        <div class="field"><label>Turno</label>
          <select id="c-turno"><option value="">— Turno —</option>
            ${['Día','Noche'].map(o=>`<option ${co.turno===o?'selected':''}>${o}</option>`).join('')}
          </select></div>
        <div class="field"><label>¿Plan PM vencido?</label>
          <select id="c-pm">${['No','Sí','No aplica'].map(o=>`<option ${co.pmVencido===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field" id="c-estado-otro-wrap" style="grid-column:span 3;display:${co.estado==='Otro'?'block':'none'}">
          <label>Describe en qué condición estaba la máquina <small style="color:var(--gray)">(al elegir "Otro")</small></label>
          <input id="c-estado-otro" value="${esc(co.estadoOtro||'')}" placeholder="Ej: en lavado CIP, en vacío sin carga, en pruebas de puesta a punto...">
        </div>
        <div class="field"><label>¿Intervención reciente en el equipo?</label>
          <select id="c-int">${['No','Sí'].map(o=>`<option ${co.intervencion===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:span 2"><label>¿Qué intervención? (si aplica)</label><input id="c-int-det" value="${esc(co.intervencionDet||'')}" placeholder="Ej: cambio de rodamiento hace 2 días"></div>
        <div class="field"><label>¿Operando fuera de parámetro?</label>
          <select id="c-fp">${['No','Sí'].map(o=>`<option ${co.fueraParam===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:span 2"><label>¿Qué parámetro? (si aplica)</label><input id="c-fp-det" value="${esc(co.fueraParamDet||'')}" placeholder="Ej: presión 8 bar sobre el límite de 6 bar"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">👥 Quiénes participaron en el análisis <small style="color:var(--gray);font-weight:400">— equipo multidisciplinario (incluye al autor del ADF y a quienes aportan ideas)</small></div>
      <div id="equipo-list">${(w.equipoAnalisis||[]).map((p,i)=>equipoRowHTML(p,i)).join('')}</div>
      <button type="button" class="btn-ghost btn-sm" onclick="agregarIntegrante()">+ Agregar integrante</button>
    </div>

    <div class="card">
      <div class="card-title">3 · Descripción del Fenómeno (5W + 1H)</div>
      <div class="grid-2">
        <div class="field"><label>¿Qué? (fenómeno)</label><textarea id="f-que">${esc(w.w_que)}</textarea></div>
        <div class="field"><label>¿Cómo?</label><textarea id="f-como">${esc(w.w_como)}</textarea></div>
        <div class="field"><label>¿Dónde?</label><textarea id="f-donde">${esc(w.w_donde)}</textarea></div>
        <div class="field"><label>¿Cuándo?</label><textarea id="f-cuando">${esc(w.w_cuando)}</textarea></div>
        <div class="field"><label>¿Quién?</label><textarea id="f-quien">${esc(w.w_quien)}</textarea></div>
        <div class="field"><label>¿Cuál?</label><textarea id="f-cual">${esc(w.w_cual)}</textarea></div>
      </div>
      <div class="field"><label>Imagen de la falla (opcional)</label>
        <div class="img-drop" onclick="document.getElementById('f-img').click()">📷 Clic para adjuntar imagen</div>
        <input type="file" id="f-img" accept="image/*" class="hidden">
        <div id="img-prev">${w.imagen?`<img class="img-preview" src="${w.imagen}">`:''}</div>
      </div>
    </div>

    <div class="auto-banner">
      <div class="ab-icon">🤖</div>
      <div class="ab-txt"><b>Análisis automático</b><p>El sistema detecta el modo de falla y propone causas, 5 porqués y plan de acción. Podrás revisarlos y ajustarlos.</p></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-secondary" id="btn-generar">⚙️ Generar análisis automático</button>
      <button class="btn-ghost" id="btn-reset">Limpiar formulario</button>
    </div>

    <div id="analisis-zone"></div>
  `;

  // listeners de captura
  const cap = ()=>capturarWizard();
  ['f-fecha','f-folio','f-componente','f-finicio','f-hinicio','f-min',
   'f-fmarcha','f-hmarcha','f-ot','f-afecto','f-tipo','f-sintoma','f-modo','f-accion',
   'c-estado','c-estado-otro','c-turno','c-pm','c-int','c-int-det','c-fp','c-fp-det',
   'f-que','f-cuando','f-donde','f-quien','f-cual','f-como'].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('change', cap);
  });
  // Muestra el campo de texto "Otro" solo cuando se elige esa condición
  const elEst=$('c-estado');
  if(elEst) elEst.addEventListener('change', ()=>{ const wrap=$('c-estado-otro-wrap'); if(wrap) wrap.style.display = elEst.value==='Otro'?'block':'none'; });
  $('f-img').addEventListener('change', async e=>{
    const file=e.target.files[0]; if(!file) return;
    _wizard.imagen = await comprimirImg(file);
    $('img-prev').innerHTML=`<img class="img-preview" src="${_wizard.imagen}">`;
  });
  $('btn-generar').addEventListener('click', ()=>{ capturarWizard(); hacerAnalisis(); });
  $('btn-reset').addEventListener('click', ()=>{ _wizard=nuevoBorrador(); renderNuevo(); });

  // Cálculo automático de minutos perdidos a partir de inicio y puesta en marcha
  ['f-finicio','f-hinicio','f-fmarcha','f-hmarcha','f-afecto'].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('change', recalcularMinutos);
  });

  bindMaquinaSearch();
  if(w.analisis) renderAnalisisZone();
}

function recalcularMinutos(){
  const ini = fechaHoraMs($('f-finicio')?.value, $('f-hinicio')?.value);
  const fin = fechaHoraMs($('f-fmarcha')?.value, $('f-hmarcha')?.value);
  const afecto = $('f-afecto')?.value;
  const elMin = $('f-min');
  if(!elMin) return;
  if(afecto === 'No'){ elMin.value = 0; capturarWizard(); return; }
  if(ini!=null && fin!=null && fin>ini){
    elMin.value = Math.round((fin - ini)/60000); // minutos
  } else {
    elMin.value = '';
  }
  capturarWizard();
}

function bindMaquinaSearch(){
  const selArea   = $('sel-area');
  const selLinea  = $('sel-linea');
  const selEquipo = $('sel-equipo');
  const sapBuscar = $('sap-buscar');
  const sapDrop   = $('sap-drop');

  function populateLineas(area){
    const lineas = [...new Set(MAQUINAS_PLANTA.filter(m=>m.area===area).map(m=>m.linea))].sort();
    selLinea.innerHTML = '<option value="">— Línea —</option>' +
      lineas.map(l=>`<option value="${esc(l)}" ${_wizard.linea===l?'selected':''}>${esc(l)}</option>`).join('');
  }
  function populateEquipos(area,linea){
    const equips = MAQUINAS_PLANTA.filter(m=>m.area===area && m.linea===linea);
    selEquipo.innerHTML = '<option value="">— Equipo —</option>' +
      equips.map(m=>`<option value="${esc(m.nombre)}" data-sap="${esc(m.sap)}" ${_wizard.equipo===m.nombre?'selected':''}>${esc(m.nombre)}</option>`).join('');
  }
  function seleccionarMaquina(m){
    $('f-area').value   = m.area;
    $('f-linea').value  = m.linea;
    $('f-equipo').value = m.nombre;
    $('f-sap').value    = m.sap;
    $('maq-badge').style.display = 'flex';
    $('maq-badge-nombre').textContent = m.nombre;
    $('maq-badge-meta').textContent   = `${m.area} · ${m.linea} · SAP: ${m.sap}`;
    selArea.value = m.area;
    populateLineas(m.area);
    selLinea.value = m.linea;
    populateEquipos(m.area, m.linea);
    selEquipo.value = m.nombre;
    sapBuscar.value = '';
    sapDrop.style.display = 'none';
    capturarWizard();
  }
  function limpiarMaquina(){
    ['f-area','f-linea','f-equipo','f-sap'].forEach(id=>{ $(id).value=''; });
    $('maq-badge').style.display = 'none';
    selArea.value = '';
    selLinea.innerHTML  = '<option value="">— Línea —</option>';
    selEquipo.innerHTML = '<option value="">— Equipo —</option>';
    sapBuscar.value = '';
    capturarWizard();
  }

  // Pre-cargar selects si el wizard ya tiene valores
  if(_wizard.area)  { populateLineas(_wizard.area); }
  if(_wizard.area && _wizard.linea) { populateEquipos(_wizard.area, _wizard.linea); }

  // Búsqueda por SAP o nombre
  sapBuscar.addEventListener('input', ()=>{
    const q = sapBuscar.value.trim().toUpperCase();
    if(q.length < 2){ sapDrop.style.display='none'; return; }
    const matches = MAQUINAS_PLANTA.filter(m=>
      m.sap.includes(q) || m.nombre.toUpperCase().includes(q)
    ).slice(0,15);
    if(!matches.length){ sapDrop.style.display='none'; return; }
    sapDrop.innerHTML = matches.map((m,i)=>`
      <div class="sap-item" data-i="${i}">
        <span class="sap-item-sap">${esc(m.sap)}</span>
        <span class="sap-item-nombre">${esc(m.nombre)}</span>
        <span class="sap-item-meta">${esc(m.area)} · ${esc(m.linea)}</span>
      </div>`).join('');
    sapDrop.style.display = 'block';
    sapDrop.querySelectorAll('.sap-item').forEach((el,i)=>{
      el.addEventListener('mousedown', e=>{ e.preventDefault(); seleccionarMaquina(matches[i]); });
    });
  });
  sapBuscar.addEventListener('blur', ()=>{ setTimeout(()=>{ sapDrop.style.display='none'; },150); });

  // Selects en cascada
  selArea.addEventListener('change', ()=>{
    const area = selArea.value;
    selLinea.innerHTML  = '<option value="">— Línea —</option>';
    selEquipo.innerHTML = '<option value="">— Equipo —</option>';
    if(area) populateLineas(area);
    $('f-area').value=''; $('f-linea').value=''; $('f-equipo').value=''; $('f-sap').value='';
    $('maq-badge').style.display='none';
    capturarWizard();
  });
  selLinea.addEventListener('change', ()=>{
    const area=selArea.value, linea=selLinea.value;
    selEquipo.innerHTML = '<option value="">— Equipo —</option>';
    if(area && linea) populateEquipos(area, linea);
    $('f-linea').value=linea; $('f-equipo').value=''; $('f-sap').value='';
    $('maq-badge').style.display='none';
    capturarWizard();
  });
  selEquipo.addEventListener('change', ()=>{
    const opt = selEquipo.options[selEquipo.selectedIndex];
    if(!opt || !opt.value) return;
    const m = MAQUINAS_PLANTA.find(x=>x.nombre===opt.value && x.area===selArea.value && x.linea===selLinea.value);
    if(m) seleccionarMaquina(m);
  });

  $('maq-clear').addEventListener('click', limpiarMaquina);
}

function capturarWizard(){
  const g=(id)=> { const e=$(id); return e?e.value:''; };
  Object.assign(_wizard,{
    fecha:g('f-fecha'), area:g('f-area'), folio:g('f-folio'), linea:g('f-linea'),
    equipo:g('f-equipo'), codSap:g('f-sap'), componente:g('f-componente'), fechaInicio:g('f-finicio'), horaInicio:g('f-hinicio'),
    minutosPerdidos:g('f-min'), fechaMarcha:g('f-fmarcha'), horaMarcha:g('f-hmarcha'), ot:g('f-ot'),
    afectoProduccion:g('f-afecto'), tipoProblema:g('f-tipo'), sintoma:g('f-sintoma'),
    modoFalla:g('f-modo'), accionCorrectiva:g('f-accion'),
    w_que:g('f-que'), w_cuando:g('f-cuando'), w_donde:g('f-donde'), w_quien:g('f-quien'),
    w_cual:g('f-cual'), w_como:g('f-como'),
  });
  if($('c-estado')){
    _wizard.condiciones = {
      estado:g('c-estado'), estadoOtro:g('c-estado-otro'), turno:g('c-turno'), pmVencido:g('c-pm'),
      intervencion:g('c-int'), intervencionDet:g('c-int-det'),
      fueraParam:g('c-fp'), fueraParamDet:g('c-fp-det'),
    };
  }
}

function hacerAnalisis(){
  if(!_wizard.sintoma && !_wizard.modoFalla){
    toast('Ingresa al menos el síntoma o modo de falla.','err'); return;
  }
  _wizard.analisis = generarAnalisis(_wizard);
  renderAnalisisZone();
  toast('Análisis generado: '+_wizard.analisis.modoDetectado,'ok');
  $('analisis-zone').scrollIntoView({behavior:'smooth'});
}

function renderAnalisisZone(){
  const an=_wizard.analisis;
  $('analisis-zone').innerHTML = `
    <div class="section-head"><h3>Análisis propuesto — modo detectado: ${esc(an.modoDetectado)}</h3>
      <p>${(an.tipoEquipo&&an.tipoEquipo.length)?`<b>Tipo de equipo:</b> ${esc(an.tipoEquipo.join(' · '))} · `:''}Revisa y ajusta. Marca todas las causas probables.${(an.modosMixtos&&an.modosMixtos.length)?` <b>Causas mixtas por origen:</b> ${esc(an.modosMixtos.join(' · '))}.`:''}</p></div>

    <div class="card">
      <div class="card-title">4 · Causas Probables (marca todas las que apliquen)</div>
      <p class="muted" style="margin:-4px 0 10px;font-size:.85rem">Puedes marcar <b>más de una</b> causa probable y clasificar cada una según las <b>6M</b> (Máquina · Mano de obra · Método · Material · Medición · Medio ambiente).</p>
      <div class="causa-list" id="causa-list">
        ${an.causas.map((c,i)=>causaRowHTML(c,i)).join('')}
      </div>
      <button class="btn-ghost btn-sm" onclick="agregarCausa()">+ Agregar causa</button>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-blue btn-sm" onclick="generarSintesis()">🔎 Generar análisis de causas seleccionadas</button>
      </div>
      <div id="sintesis-zone">${an.sintesis?sintesisHTML(an.sintesis):''}</div>
    </div>

    <div class="card">
      <div class="card-title">5 · Análisis 5 Porqués (profundiza la causa raíz)</div>
      <div class="porque-chain">
        ${an.porques.map((p,i)=>`
          <div class="porque-step">
            <span class="p-badge">¿Por qué? ${i+1}</span>
            <textarea rows="1" onchange="editPorque(${i},this.value)">${esc(p)}</textarea>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">6 · Planes de Acción</div>
      <div id="plan-list">
        ${an.planes.map((pl,i)=>planRowHTML(pl,i)).join('')}
      </div>
      <button class="btn-ghost btn-sm" onclick="agregarPlan()">+ Agregar actividad</button>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
      <button class="btn-green" id="btn-guardar-adf">💾 Guardar ADF</button>
    </div>
  `;
  $('btn-guardar-adf').addEventListener('click', guardarADF);
}

function planRowHTML(pl,i){
  return `<div class="plan-row" id="plan-${i}">
    <textarea rows="1" placeholder="Actividad" onchange="editPlan(${i},'actividad',this.value)">${esc(pl.actividad)}</textarea>
    <input placeholder="Responsable" value="${esc(pl.responsable)}" onchange="editPlan(${i},'responsable',this.value)">
    <input type="date" value="${pl.fecha||''}" onchange="editPlan(${i},'fecha',this.value)">
    <select onchange="editPlan(${i},'tipo',this.value)">
      <option ${pl.tipo==='INMEDIATA'?'selected':''}>INMEDIATA</option>
      <option ${pl.tipo==='PERMANENTE'?'selected':''}>PERMANENTE</option>
    </select>
    <button type="button" class="plan-del" onclick="quitarPlan(${i})" title="Eliminar actividad">✕</button>
  </div>`;
}
function quitarPlan(i){
  _wizard.analisis.planes.splice(i,1);
  $('plan-list').innerHTML = _wizard.analisis.planes.map((pl,j)=>planRowHTML(pl,j)).join('');
}

// Participantes en la atención de la falla (aparte del que ingresa el ADF)
function partRowHTML(p,i){
  return `<div class="part-row" id="part-${i}">
    <input class="part-nombre" value="${esc(p.nombre||'')}" placeholder="Nombre y apellido" onchange="editParticipante(${i},'nombre',this.value)">
    <select class="part-rol" onchange="editParticipante(${i},'rol',this.value)">
      ${['Técnico','Supervisor','Operador','Externo','Otro'].map(o=>`<option ${(p.rol||'Técnico')===o?'selected':''}>${o}</option>`).join('')}
    </select>
    <button type="button" class="part-del" onclick="quitarParticipante(${i})" title="Quitar">✕</button>
  </div>`;
}
function agregarParticipante(){
  if(!_wizard.participantes) _wizard.participantes=[];
  _wizard.participantes.push({nombre:'',rol:'Técnico'});
  const i=_wizard.participantes.length-1;
  $('part-list').insertAdjacentHTML('beforeend', partRowHTML(_wizard.participantes[i], i));
}
function editParticipante(i,f,v){ _wizard.participantes[i][f]=v; }
function quitarParticipante(i){
  _wizard.participantes.splice(i,1);
  $('part-list').innerHTML = _wizard.participantes.map((p,j)=>partRowHTML(p,j)).join('');
}

// Equipo multidisciplinario del análisis (Nombre + Área) — incluye al autor del ADF
function equipoRowHTML(p,i){
  return `<div class="part-row" id="equipo-${i}">
    <input class="part-nombre" value="${esc(p.nombre||'')}" placeholder="Nombre y apellido" onchange="editIntegrante(${i},'nombre',this.value)">
    <input class="eq-area" value="${esc(p.area||'')}" placeholder="Área (ej: Mantenimiento, Producción, Calidad)" onchange="editIntegrante(${i},'area',this.value)">
    ${p.autor?`<span class="autor-tag" title="Autor del ADF">autor</span>`:`<button type="button" class="part-del" onclick="quitarIntegrante(${i})" title="Quitar">✕</button>`}
  </div>`;
}
function agregarIntegrante(){
  if(!_wizard.equipoAnalisis) _wizard.equipoAnalisis=[];
  _wizard.equipoAnalisis.push({nombre:'',area:''});
  const i=_wizard.equipoAnalisis.length-1;
  $('equipo-list').insertAdjacentHTML('beforeend', equipoRowHTML(_wizard.equipoAnalisis[i], i));
}
function editIntegrante(i,f,v){ _wizard.equipoAnalisis[i][f]=v; }
function quitarIntegrante(i){
  _wizard.equipoAnalisis.splice(i,1);
  $('equipo-list').innerHTML = _wizard.equipoAnalisis.map((p,j)=>equipoRowHTML(p,j)).join('');
}

// Fila de causa: checkbox (varias probables) + texto + origen + categoría 6M
function causaRowHTML(c,i){
  return `<label class="causa-item ${c.probable?'probable':''}" id="causa-${i}">
    <input type="checkbox" ${c.probable?'checked':''} onchange="toggleProbable(${i},this.checked)">
    <span class="c-num">${i+1}</span>
    <span class="c-txt">
      <textarea rows="1" onchange="editCausa(${i},this.value)">${esc(c.txt)}</textarea>
      ${c.origen?`<span class="origen-tag" title="Origen de falla asociado">${esc(c.origen)}</span>`:''}
    </span>
    <select class="c-cat" onchange="editCausaCat(${i},this.value)" title="Categoría 6M (Ishikawa)">
      ${CATS_6M.map(k=>`<option ${(c.cat||'Máquina')===k?'selected':''}>${k}</option>`).join('')}
    </select>
  </label>`;
}

// Editores in-place del análisis
function toggleProbable(i,on){ _wizard.analisis.causas[i].probable=on;
  document.getElementById('causa-'+i)?.classList.toggle('probable',on); }
function editCausaCat(i,v){ _wizard.analisis.causas[i].cat=v; }
function agregarCausa(){
  _wizard.analisis.causas.push({txt:'',probable:true,cat:'Máquina',origen:'Manual'});
  const i=_wizard.analisis.causas.length-1;
  $('causa-list').insertAdjacentHTML('beforeend', causaRowHTML(_wizard.analisis.causas[i], i));
}
function editCausa(i,v){ _wizard.analisis.causas[i].txt=v; }

// Genera un análisis posterior (síntesis) a partir de las causas MARCADAS como probables
function generarSintesis(){
  const an = _wizard.analisis;
  const sel = (an.causas||[]).filter(c=>c.probable && String(c.txt).trim());
  if(!sel.length){ toast('Marca al menos una causa probable para generar el análisis.','err'); return; }

  // Distribución por 6M y por origen
  const por6M = {}, porOrigen = {};
  sel.forEach(c=>{
    const k = c.cat || 'Máquina';   por6M[k] = (por6M[k]||0)+1;
    const o = c.origen || an.modoDetectado; porOrigen[o] = (porOrigen[o]||0)+1;
  });
  const top = obj => Object.entries(obj).sort((a,b)=>b[1]-a[1]);
  const dom6M = top(por6M)[0];
  const domOri = top(porOrigen);

  const s = {
    n: sel.length,
    causas: sel.map(c=>c.txt),
    por6M: top(por6M),
    porOrigen: domOri,
    foco: dom6M[0],
    conclusion: `La falla por "${an.modoDetectado}" concentra ${dom6M[1]} de ${sel.length} causas seleccionadas en la dimensión `+
      `6M "${dom6M[0]}"${domOri.length>1?`, con origen mixto (${domOri.map(o=>o[0]).join(' · ')})`:`, con origen en "${domOri[0][0]}"`}. `+
      `Se recomienda priorizar las acciones PERMANENTES sobre la dimensión "${dom6M[0]}" para atacar la causa raíz.`,
  };
  an.sintesis = s;
  $('sintesis-zone').innerHTML = sintesisHTML(s);
  toast('Análisis de causas seleccionadas generado.','ok');
}

// Render de la síntesis de causas seleccionadas
function sintesisHTML(s){
  const barras = s.por6M.map(([k,n])=>{
    const pct = Math.round(n/s.n*100);
    return `<div class="sx-bar"><span class="sx-lbl">${esc(k)}</span>
      <span class="sx-track"><span class="sx-fill" style="width:${pct}%"></span></span>
      <span class="sx-val">${n}</span></div>`;
  }).join('');
  return `<div class="sintesis-box">
    <div class="sx-title">📊 Análisis de las ${s.n} causas seleccionadas</div>
    <div class="sx-grid">
      <div>
        <div class="sx-sub">Distribución 6M (Ishikawa)</div>
        ${barras}
      </div>
      <div>
        <div class="sx-sub">Orígenes de falla involucrados</div>
        ${s.porOrigen.map(([o,n])=>`<div class="sx-ori"><span class="origen-tag">${esc(o)}</span> <b>${n}</b></div>`).join('')}
        <div class="sx-foco">Foco principal: <b>${esc(s.foco)}</b></div>
      </div>
    </div>
    <p class="sx-concl">${esc(s.conclusion)}</p>
  </div>`;
}
function editPorque(i,v){ _wizard.analisis.porques[i]=v; }
function editPlan(i,f,v){ _wizard.analisis.planes[i][f]=v; }
function agregarPlan(){ _wizard.analisis.planes.push({actividad:'',tipo:'PERMANENTE',responsable:'',fecha:''});
  $('plan-list').insertAdjacentHTML('beforeend', planRowHTML(_wizard.analisis.planes.at(-1), _wizard.analisis.planes.length-1)); }

async function guardarADF(){
  const w=_wizard;
  if(!w.equipo || !w.sintoma){ toast('Completa al menos Equipo y Síntoma.','err'); return; }
  if(!w.fechaInicio || !w.horaInicio || !w.fechaMarcha || !w.horaMarcha){
    toast('Ingresa fecha y hora de inicio de falla y de puesta en marcha (necesarias para los indicadores).','err'); return;
  }
  const _ini = fechaHoraMs(w.fechaInicio, w.horaInicio), _fin = fechaHoraMs(w.fechaMarcha, w.horaMarcha);
  if(_ini!=null && _fin!=null && _fin<=_ini){
    toast('La puesta en marcha debe ser posterior al inicio de la falla.','err'); return;
  }
  const folio = w.folio || await generarFolio();
  const id=uid();
  const adf={
    id, ...w, folio,
    estado:'PlanAccion',
    creadorId:CU.id, creadorEmail:CU.email, creadorNombre:CU.name,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    seguimiento: w.analisis.planes.map(p=>({ actividad:p.actividad, fechaSolucion:'', realizado:'', hecho:false, imagen:'', comentario:'' })),
    evidencias:'', cerradoPor:'', cerradoAt:'',
    historial:[{ accion:'Creado', usuario:CU.name, fecha:new Date().toISOString() }],
  };
  try{
    await fdb.collection(COL_ADF).doc(id).set(adf);
    toast('ADF '+folio+' guardado correctamente.','ok');
    _wizard=null;
    irTab('listado');
  }catch(e){ toast('Error al guardar: '+e.message,'err'); }
}

async function generarFolio(){
  const year=new Date().getFullYear();
  const ref=fdb.collection(COL_CFG).doc('folio_counter');
  let folio='ADF-'+year+'-001';
  try{
    await fdb.runTransaction(async tx=>{
      const doc=await tx.get(ref);
      const n=(doc.exists?(doc.data().n||0):0)+1;
      tx.set(ref,{ n, year });
      folio='ADF-'+year+'-'+String(n).padStart(3,'0');
    });
  }catch(e){ folio='ADF-'+year+'-'+Date.now().toString().slice(-3); }
  return folio;
}

async function comprimirImg(file){
  return new Promise(res=>{
    const r=new FileReader();
    r.onload=e=>{ const img=new Image(); img.onload=()=>{
      const max=1000, sc=Math.min(1,max/Math.max(img.width,img.height));
      const cv=document.createElement('canvas'); cv.width=img.width*sc; cv.height=img.height*sc;
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      res(cv.toDataURL('image/jpeg',0.7)); }; img.src=e.target.result; };
    r.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════════════════
   SEGUIMIENTO
   ═══════════════════════════════════════════════════════════ */
function renderSeguimiento(){
  const data=misADFs().filter(a=>['PlanAccion','Seguimiento'].includes(a.estado));
  $('pane-seguimiento').innerHTML = `
    <div class="page-title">📌 Seguimiento de Soluciones</div>
    <div class="page-sub">ADF con planes de acción en curso (${data.length})</div>
    ${data.length? tablaADF(data) : `<div class="empty"><div class="e-icon">✅</div>No hay planes de acción pendientes.</div>`}
  `;
}

/* ═══════════════════════════════════════════════════════════
   CONTROL DE TIEMPOS (semáforo por plan de acción)
   ═══════════════════════════════════════════════════════════ */
function renderTiempos(){
  const today = new Date(); today.setHours(0,0,0,0);
  const activos = _cache.adfs.filter(a=>['PlanAccion','Seguimiento'].includes(a.estado));

  const rows = [];
  for(const a of activos){
    const planes = a.analisis?.planes || [];
    const seg = a.seguimiento || [];
    planes.forEach((pl,i)=>{
      if(!pl.fecha) return;
      const s = seg[i] || {};
      const fechaComp = new Date(pl.fecha+'T00:00:00');
      const creado = new Date(a.createdAt); creado.setHours(0,0,0,0);
      const totalDias = Math.max(1, Math.round((fechaComp-creado)/86400000));
      const transcurrido = Math.round((today-creado)/86400000);
      const diasRest = Math.round((fechaComp-today)/86400000); // >0 faltan · 0 vence hoy · <0 vencido
      let pct = Math.round(transcurrido/totalDias*100);
      if(pct<0) pct=0;
      let semaforo, semCls, estadoTiempo;
      if(s.hecho){ semaforo='✅'; semCls='sem-done'; estadoTiempo='Concluido'; }
      else if(diasRest<0){ semaforo='🔴'; semCls='sem-over'; estadoTiempo=`Vencido (${Math.abs(diasRest)} día(s))`; pct=100; }
      else if(diasRest===0){ semaforo='🟠'; semCls='sem-limit'; estadoTiempo='Vence hoy'; pct=Math.max(pct,100); }
      else if(pct>=90){ semaforo='🟠'; semCls='sem-limit'; estadoTiempo=`Límite (faltan ${diasRest} día(s))`; }
      else if(pct>=50){ semaforo='🟡'; semCls='sem-warn'; estadoTiempo=`En riesgo (faltan ${diasRest} día(s))`; }
      else { semaforo='🟢'; semCls='sem-ok'; estadoTiempo=`A tiempo (faltan ${diasRest} día(s))`; }
      rows.push({ a, i, pl, s, pct, transcurrido, diasRest, totalDias, semaforo, semCls, estadoTiempo });
    });
  }
  // Más urgentes primero (vencidos arriba); concluidos al final
  rows.sort((a,b)=> (a.s.hecho?1:0)-(b.s.hecho?1:0) || a.diasRest-b.diasRest);
  const nVencidos = rows.filter(r=>!r.s.hecho && r.diasRest<0).length;

  $('pane-tiempos').innerHTML = `
    <div class="page-title">⏱ Control de Tiempos</div>
    <div class="page-sub">Planes de acción con fecha compromiso — ${rows.length} item(s) activo(s)</div>
    ${nVencidos ? `<div class="alerta-vencidos">🔴 <b>${nVencidos}</b> plan(es) de acción <b>vencido(s)</b> sin concluir. Requieren atención inmediata.</div>` : ''}
    <div class="tiempos-leyenda">
      <span>🟢 A tiempo (&lt;50%)</span>
      <span>🟡 En riesgo (50–90%)</span>
      <span>🟠 Límite (90–100%)</span>
      <span>🔴 Vencido (&gt;100%)</span>
      <span>✅ Concluido</span>
    </div>
    ${rows.length ? tiemposTabla(rows) : `<div class="empty"><div class="e-icon">⏱</div>No hay planes con fecha compromiso activos.</div>`}
  `;
}

function tiemposTabla(rows){
  return `<div class="tbl-wrap"><table class="data">
    <thead><tr>
      <th>Estado</th><th>Folio</th><th>Equipo</th><th>Actividad (plan)</th>
      <th>Responsable</th><th>F. Compromiso</th><th>Plazo</th>
      <th>Semáforo</th><th>Avance</th><th>Respaldo</th><th>Concluido</th>
    </tr></thead>
    <tbody>
      ${rows.map(r=>`<tr class="${r.s.hecho?'row-done':''}">
        <td>${badge(r.a.estado)}</td>
        <td class="nowrap"><b>${esc(r.a.folio||'—')}</b></td>
        <td>${esc(r.a.equipo||'—')}</td>
        <td style="max-width:220px">${esc(r.pl.actividad)}</td>
        <td>${esc(r.pl.responsable||'—')}</td>
        <td class="nowrap">${fmtD(r.pl.fecha)}</td>
        <td class="nowrap"><span class="plazo-tag ${r.semCls}">${esc(r.estadoTiempo)}</span></td>
        <td style="text-align:center;font-size:1.3rem">${r.semaforo}</td>
        <td class="avance-cell">
          <div class="avance-bar"><div class="avance-fill ${r.semCls}" style="width:${Math.min(100,r.pct)}%"></div></div>
          <span class="avance-pct">${r.pct}%</span>
        </td>
        <td style="text-align:center" class="nowrap">
          ${r.s.respaldo?`<a class="resp-link" onclick="verRespaldo('${r.a.id}',${r.i})" title="${esc(r.s.respaldo.name||'respaldo')}">📎 Ver</a><br>`:''}
          <button class="btn-ghost btn-sm" onclick="document.getElementById('resp-${r.a.id}-${r.i}').click()">${r.s.respaldo?'Cambiar':'➕ Adjuntar'}</button>
          <input type="file" id="resp-${r.a.id}-${r.i}" class="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            onchange="subirRespaldo('${r.a.id}',${r.i},this)">
        </td>
        <td style="text-align:center">
          <input type="checkbox" class="chk-concluido" ${r.s.hecho?'checked':''}
            onchange="concluirPlan('${r.a.id}',${r.i},this.checked)">
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function concluirPlan(adfId, planIdx, checked){
  const a=_cache.adfs.find(x=>x.id===adfId); if(!a) return;
  const seg=(a.seguimiento||[]).map((s,i)=> i===planIdx ? {...s,hecho:checked} : {...s});
  const algunHecho=seg.some(s=>s.realizado?.trim()||s.hecho);
  await fdb.collection(COL_ADF).doc(adfId).update({
    seguimiento:seg,
    estado: a.estado==='PlanAccion'&&algunHecho ? 'Seguimiento' : a.estado,
    updatedAt:new Date().toISOString(),
  });
  toast(checked?'Plan marcado como concluido.':'Plan desmarcado.','ok');
}

// Adjunta un respaldo (foto o archivo) al plan de acción, desde Control de Tiempos
async function subirRespaldo(adfId, idx, input){
  const file=input.files[0]; if(!file) return;
  const MAXB=900*1024; // límite por archivo (doc Firestore ~1MB)
  const type=file.type||'', name=file.name||'respaldo';
  let data;
  if(type.startsWith('image/')){
    data=await comprimirImg(file);
  } else {
    if(file.size>MAXB){ toast('Archivo muy grande (máx ~900 KB). Comprime el archivo o adjunta una foto.','err'); input.value=''; return; }
    data=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
  }
  const a=_cache.adfs.find(x=>x.id===adfId); if(!a) return;
  const planes=a.analisis?.planes||[];
  const prev=a.seguimiento||[];
  const len=Math.max(planes.length, prev.length, idx+1);
  const seg=[];
  for(let k=0;k<len;k++){
    seg[k]={ ...(prev[k]||{}) };
    if(!seg[k].actividad && planes[k]) seg[k].actividad=planes[k].actividad;
  }
  seg[idx]={ ...seg[idx], respaldo:{ data, name, type, subidoPor:CU.name, fecha:new Date().toISOString() } };
  await fdb.collection(COL_ADF).doc(adfId).update({ seguimiento:seg, updatedAt:new Date().toISOString() });
  toast('Respaldo adjuntado.','ok');
}

// Abre/descarga el respaldo del plan
function verRespaldo(adfId, idx){
  const a=_cache.adfs.find(x=>x.id===adfId); if(!a) return;
  const r=(a.seguimiento||[])[idx]?.respaldo; if(!r?.data) return;
  if((r.type||'').startsWith('image/')){
    const w=window.open('','_blank','width=860,height=720');
    w.document.write(`<!DOCTYPE html><html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh">
      <img src="${r.data}" style="max-width:100%;max-height:95vh;border-radius:8px"></body></html>`);
  } else {
    const link=document.createElement('a');
    link.href=r.data; link.download=r.name||'respaldo';
    document.body.appendChild(link); link.click(); link.remove();
  }
}

/* ═══════════════════════════════════════════════════════════
   CONFIABILIDAD · MTTR / MTBF / DISPONIBILIDAD
   ═══════════════════════════════════════════════════════════ */
// Convierte fecha (YYYY-MM-DD) + hora (HH:MM) a milisegundos
function fechaHoraMs(fecha, hora){
  if(!fecha) return null;
  const h = (hora && /^\d{1,2}:\d{2}/.test(hora)) ? hora : '00:00';
  const d = new Date(fecha + 'T' + h + ':00');
  return isNaN(d.getTime()) ? null : d.getTime();
}
// Tiempo de reparación de una falla, en horas (null si faltan datos)
function downtimeHoras(a){
  const ini = fechaHoraMs(a.fechaInicio, a.horaInicio);
  const fin = fechaHoraMs(a.fechaMarcha, a.horaMarcha);
  if(ini==null || fin==null || fin<=ini) return null;
  return (fin - ini) / 3600000;
}
// Formatea una duración en horas a texto legible
function fmtDur(h){
  if(h==null || isNaN(h)) return '—';
  if(h < 1)  return Math.round(h*60) + ' min';
  if(h < 48) return (Math.round(h*10)/10) + ' h';
  return (Math.round(h/24*10)/10) + ' días';
}

// Calcula métricas por equipo (agrupa por SAP; si no hay, por nombre)
function calcConfiabilidad(list){
  const grupos = {};
  for(const a of list){
    const key = a.codSap || a.equipo || '—';
    if(!grupos[key]) grupos[key] = { sap:a.codSap||'', equipo:a.equipo||'—', area:a.area||'—', fallas:[] };
    grupos[key].fallas.push({
      dt:  downtimeHoras(a),
      ini: fechaHoraMs(a.fechaInicio, a.horaInicio),
      fin: fechaHoraMs(a.fechaMarcha, a.horaMarcha),
    });
  }
  const equipos = [];
  for(const k in grupos){
    const g = grupos[k];
    const dts = g.fallas.map(f=>f.dt).filter(v=>v!=null);
    const mttr = dts.length ? dts.reduce((s,v)=>s+v,0)/dts.length : null;
    const horasDetenido = dts.reduce((s,v)=>s+v,0);

    // MTBF: tiempo operativo entre fallas consecutivas (requiere ≥2 fallas con fechas)
    const conFechas = g.fallas.filter(f=>f.ini!=null && f.fin!=null).sort((a,b)=>a.ini-b.ini);
    let mtbf = null;
    if(conFechas.length >= 2){
      const uptimes = [];
      for(let i=1;i<conFechas.length;i++){
        const up = (conFechas[i].ini - conFechas[i-1].fin) / 3600000;
        if(up > 0) uptimes.push(up);
      }
      if(uptimes.length) mtbf = uptimes.reduce((s,v)=>s+v,0)/uptimes.length;
    }
    const disp = (mttr!=null && mtbf!=null && (mtbf+mttr)>0) ? (mtbf/(mtbf+mttr))*100 : null;

    equipos.push({
      sap:g.sap, equipo:g.equipo, area:g.area,
      nFallas:g.fallas.length, nConDatos:dts.length,
      mttr, mtbf, disp, horasDetenido,
    });
  }
  equipos.sort((a,b)=> (b.nFallas-a.nFallas) || (b.horasDetenido-a.horasDetenido));

  // Globales
  const todosDts = list.map(downtimeHoras).filter(v=>v!=null);
  const mttrGlobal = todosDts.length ? todosDts.reduce((s,v)=>s+v,0)/todosDts.length : null;
  const horasGlobal = todosDts.reduce((s,v)=>s+v,0);
  const mtbfs = equipos.map(e=>e.mtbf).filter(v=>v!=null);
  const mtbfGlobal = mtbfs.length ? mtbfs.reduce((s,v)=>s+v,0)/mtbfs.length : null;
  const dispGlobal = (mttrGlobal!=null && mtbfGlobal!=null && (mtbfGlobal+mttrGlobal)>0)
    ? (mtbfGlobal/(mtbfGlobal+mttrGlobal))*100 : null;

  return { equipos, mttrGlobal, mtbfGlobal, dispGlobal, horasGlobal, nFallasConDatos:todosDts.length };
}

let _indFiltro = { area:'', desde:'', hasta:'' };
let _indCharts = [];
const DISP_COLOR = d => d==null ? '#9CA3AF' : d>=90 ? '#15803D' : d>=75 ? '#B45309' : '#B91C1C';
const PALETA = ['#1B3580','#F07B1B','#2A4A9B','#15803D','#B91C1C','#B45309','#0284C7','#7C3AED','#0891B2','#DB2777','#65A30D','#475569'];

// Aplica los filtros activos (área + rango de fechas) sobre los ADF
function indADFsFiltrados(){
  let data = misADFs();
  if(_indFiltro.area)  data = data.filter(a=>a.area===_indFiltro.area);
  if(_indFiltro.desde) data = data.filter(a=>(a.fecha||'') >= _indFiltro.desde);
  if(_indFiltro.hasta) data = data.filter(a=>(a.fecha||'') <= _indFiltro.hasta);
  return data;
}

// Métricas extra: minutos perdidos, cumplimiento de planes, modo más frecuente, etc.
function indMetricasExtra(data){
  const minPerdidos = data.reduce((s,a)=>s + (parseFloat(a.minutosPerdidos)||0), 0);
  const recurrentes = data.filter(a=>a.tipoProblema==='Recurrente').length;
  let planesTotal=0, planesHechos=0;
  data.forEach(a=>{
    const planes = a.analisis?.planes || [];
    const seg = a.seguimiento || [];
    planes.forEach((pl,i)=>{ planesTotal++; if(seg[i]?.hecho || seg[i]?.realizado?.trim()) planesHechos++; });
  });
  const cumplimiento = planesTotal ? (planesHechos/planesTotal)*100 : null;
  return { minPerdidos, recurrentes, planesTotal, planesHechos, cumplimiento };
}

// Cuenta agrupada por un campo (devuelve [{k,v}] ordenado desc)
function contarPor(data, fn){
  const map = {};
  data.forEach(a=>{ const k = fn(a) || '—'; map[k] = (map[k]||0)+1; });
  return Object.entries(map).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v);
}

function renderConfiabilidad(){
  _indCharts.forEach(c=>{ try{c.destroy();}catch(e){} }); _indCharts=[];
  const data = indADFsFiltrados();
  const m = calcConfiabilidad(data);
  const ex = indMetricasExtra(data);
  const areas = [...new Set(misADFs().map(a=>a.area).filter(Boolean))].sort();

  $('pane-confiabilidad').innerHTML = `
    <div class="page-title">📊 Indicadores de Mantenimiento</div>
    <div class="page-sub">Análisis de fallas, confiabilidad y disponibilidad — ${data.length} ADF en el filtro actual</div>

    <div class="ind-toolbar">
      <div class="ind-filtros">
        <div class="field"><label>Área</label>
          <select id="ind-area"><option value="">Todas</option>${areas.map(a=>`<option value="${esc(a)}" ${_indFiltro.area===a?'selected':''}>${esc(a)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Desde</label><input type="date" id="ind-desde" value="${_indFiltro.desde}"></div>
        <div class="field"><label>Hasta</label><input type="date" id="ind-hasta" value="${_indFiltro.hasta}"></div>
        <button class="btn-ghost btn-sm" id="ind-limpiar">Limpiar</button>
      </div>
      <div class="ind-export">
        <button class="btn-primary btn-sm" id="ind-semanal">🗓 Reporte semanal</button>
        <button class="btn-secondary btn-sm" id="ind-xls">📑 Exportar Excel</button>
        <button class="btn-secondary btn-sm" id="ind-pdf">📄 Exportar PDF</button>
      </div>
    </div>

    <div id="ind-capture">
      <div class="kpi-grid">
        <div class="kpi accent"><div class="k-val">${fmtDur(m.mttrGlobal)}</div><div class="k-lbl">MTTR<br><small>tiempo medio reparación</small></div></div>
        <div class="kpi"><div class="k-val">${fmtDur(m.mtbfGlobal)}</div><div class="k-lbl">MTBF<br><small>tiempo medio entre fallas</small></div></div>
        <div class="kpi"><div class="k-val" style="color:${DISP_COLOR(m.dispGlobal)}">${m.dispGlobal!=null?m.dispGlobal.toFixed(1)+'%':'—'}</div><div class="k-lbl">Disponibilidad</div></div>
        <div class="kpi"><div class="k-val">${data.length}</div><div class="k-lbl">Total fallas (ADF)</div></div>
        <div class="kpi"><div class="k-val" style="color:var(--red)">${ex.recurrentes}</div><div class="k-lbl">Recurrentes</div></div>
        <div class="kpi"><div class="k-val">${fmtDur(m.horasGlobal)}</div><div class="k-lbl">Horas detenido</div></div>
        <div class="kpi"><div class="k-val">${Math.round(ex.minPerdidos)}</div><div class="k-lbl">Min. perdidos prod.</div></div>
        <div class="kpi"><div class="k-val" style="color:${ex.cumplimiento==null?'var(--gray)':ex.cumplimiento>=80?'var(--green)':'var(--amber)'}">${ex.cumplimiento!=null?ex.cumplimiento.toFixed(0)+'%':'—'}</div><div class="k-lbl">Cumplim. planes<br><small>${ex.planesHechos}/${ex.planesTotal}</small></div></div>
      </div>

      <div class="ind-charts">
        <div class="chart-card"><div class="chart-title">Fallas por área</div><div class="chart-box"><canvas id="ch-area"></canvas></div></div>
        <div class="chart-card"><div class="chart-title">Top 10 equipos por horas detenido</div><div class="chart-box"><canvas id="ch-equipos"></canvas></div></div>
        <div class="chart-card"><div class="chart-title">Distribución por modo de falla</div><div class="chart-box"><canvas id="ch-modo"></canvas></div></div>
        <div class="chart-card"><div class="chart-title">Tendencia mensual (fallas vs MTTR)</div><div class="chart-box"><canvas id="ch-tend"></canvas></div></div>
        <div class="chart-card"><div class="chart-title">Tipo de problema</div><div class="chart-box"><canvas id="ch-tipo"></canvas></div></div>
        <div class="chart-card"><div class="chart-title">Estado de los ADF</div><div class="chart-box"><canvas id="ch-estado"></canvas></div></div>
        <div class="chart-card"><div class="chart-title">Causas por categoría 6M (Ishikawa)</div><div class="chart-box"><canvas id="ch-6m"></canvas></div></div>
        <div class="chart-card chart-wide"><div class="chart-title">Pareto de causas raíz — prioriza qué corregir primero</div><div class="chart-box"><canvas id="ch-pareto"></canvas></div></div>
      </div>

      <div class="conf-nota">
        ℹ️ <b>MTTR</b> = promedio de (puesta en marcha − inicio de falla). <b>MTBF</b> y <b>Disponibilidad</b> requieren ≥2 fallas con fechas del mismo equipo. <b>Cumplimiento</b> = planes de acción concluidos / total.
      </div>

      <div class="section-head"><h3>Detalle por equipo</h3></div>
      ${confiabilidadTabla(m.equipos, d=>DISP_COLOR(d))}
    </div>
  `;

  // Filtros
  const refrescar = ()=>{ renderConfiabilidad(); };
  $('ind-area').addEventListener('change', e=>{ _indFiltro.area=e.target.value; refrescar(); });
  $('ind-desde').addEventListener('change', e=>{ _indFiltro.desde=e.target.value; refrescar(); });
  $('ind-hasta').addEventListener('change', e=>{ _indFiltro.hasta=e.target.value; refrescar(); });
  $('ind-limpiar').addEventListener('click', ()=>{ _indFiltro={area:'',desde:'',hasta:''}; refrescar(); });
  $('ind-xls').addEventListener('click', ()=>exportarIndicadoresExcel(data, m, ex));
  $('ind-pdf').addEventListener('click', ()=>exportarIndicadoresPDF());
  $('ind-semanal').addEventListener('click', reporteSemanal);

  construirGraficos(data, m);
}

// Causa raíz = TODAS las causas marcadas como probables en cada ADF
function paretoCausas(data){
  const map = {};
  data.forEach(a=>{
    (a.analisis?.causas || []).filter(c=>c.probable).forEach(c=>{
      const txt = (c.txt || '').trim();
      if(txt) map[txt] = (map[txt]||0)+1;
    });
  });
  const arr = Object.entries(map).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v).slice(0,12);
  const total = arr.reduce((s,x)=>s+x.v,0);
  let acc = 0;
  arr.forEach(x=>{ acc += x.v; x.cum = total ? Math.round(acc/total*1000)/10 : 0; });
  return arr;
}

function construirGraficos(data, m){
  if(typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'Open Sans', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.animation = false; // captura inmediata para PDF
  const mk = (id, cfg)=>{ const el=$(id); if(el){ _indCharts.push(new Chart(el, cfg)); } };

  // Fallas por área
  const pa = contarPor(data, a=>a.area);
  mk('ch-area', { type:'bar', data:{ labels:pa.map(x=>x.k),
    datasets:[{ data:pa.map(x=>x.v), backgroundColor:'#1B3580' }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} } });

  // Top 10 equipos por horas detenido
  const topEq = [...m.equipos].sort((a,b)=>b.horasDetenido-a.horasDetenido).slice(0,10);
  mk('ch-equipos', { type:'bar', data:{ labels:topEq.map(e=>(e.equipo||'—').slice(0,24)),
    datasets:[{ data:topEq.map(e=>Math.round(e.horasDetenido*10)/10), backgroundColor:'#F07B1B' }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>c.parsed.x+' h detenido'}} } } });

  // Modo de falla
  const pm = contarPor(data, a=>a.analisis?.modoDetectado || a.modoFalla || 'Sin clasificar');
  mk('ch-modo', { type:'doughnut', data:{ labels:pm.map(x=>x.k),
    datasets:[{ data:pm.map(x=>x.v), backgroundColor:PALETA }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{boxWidth:12}}} } });

  // Tendencia mensual: fallas (barra) + MTTR (línea)
  const meses = {};
  data.forEach(a=>{ const mk2=(a.fecha||'').slice(0,7); if(!mk2) return;
    if(!meses[mk2]) meses[mk2]={n:0,dt:[]}; meses[mk2].n++;
    const dt=downtimeHoras(a); if(dt!=null) meses[mk2].dt.push(dt); });
  const labelsM = Object.keys(meses).sort();
  mk('ch-tend', { data:{ labels:labelsM,
    datasets:[
      { type:'bar', label:'N° fallas', data:labelsM.map(k=>meses[k].n), backgroundColor:'#2A4A9B', yAxisID:'y' },
      { type:'line', label:'MTTR (h)', data:labelsM.map(k=>{const d=meses[k].dt; return d.length?Math.round(d.reduce((s,v)=>s+v,0)/d.length*10)/10:null;}), borderColor:'#F07B1B', backgroundColor:'#F07B1B', tension:.3, yAxisID:'y1' } ] },
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ y:{position:'left',title:{display:true,text:'Fallas'},beginAtZero:true},
        y1:{position:'right',title:{display:true,text:'MTTR (h)'},grid:{drawOnChartArea:false},beginAtZero:true} } } });

  // Tipo de problema
  const pt = contarPor(data, a=>a.tipoProblema || 'Esporádico');
  mk('ch-tipo', { type:'doughnut', data:{ labels:pt.map(x=>x.k),
    datasets:[{ data:pt.map(x=>x.v), backgroundColor:['#15803D','#B91C1C'] }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} } });

  // Estado
  const pe = contarPor(data, a=>a.estado || '—');
  mk('ch-estado', { type:'doughnut', data:{ labels:pe.map(x=>x.k),
    datasets:[{ data:pe.map(x=>x.v), backgroundColor:PALETA }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} } });

  // Categoría 6M (Ishikawa) — sobre las causas marcadas como probables
  const c6 = {};
  data.forEach(a=>{ (a.analisis?.causas||[]).filter(c=>c.probable).forEach(c=>{ const k=c.cat||'Sin clasificar'; c6[k]=(c6[k]||0)+1; }); });
  const c6arr = Object.entries(c6).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v);
  mk('ch-6m', { type:'bar', data:{ labels:c6arr.map(x=>x.k),
    datasets:[{ data:c6arr.map(x=>x.v), backgroundColor:PALETA }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} } });

  // Pareto de causas raíz: barras (frecuencia) + línea (% acumulado)
  const par = paretoCausas(data);
  mk('ch-pareto', { data:{ labels:par.map(x=>x.k.length>30?x.k.slice(0,30)+'…':x.k),
    datasets:[
      { type:'bar', label:'N° de fallas', data:par.map(x=>x.v), backgroundColor:'#1B3580', yAxisID:'y', order:2 },
      { type:'line', label:'% acumulado', data:par.map(x=>x.cum), borderColor:'#F07B1B', backgroundColor:'#F07B1B', tension:.2, yAxisID:'y1', order:1 } ] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top'} },
      scales:{ y:{position:'left',beginAtZero:true,title:{display:true,text:'Frecuencia'}},
        y1:{position:'right',beginAtZero:true,max:100,grid:{drawOnChartArea:false},title:{display:true,text:'% acumulado'},ticks:{callback:v=>v+'%'}} } } });
}

/* ── Reporte semanal (semana anterior, lunes a domingo) ── */
function rangoSemanaAnterior(){
  const d = new Date(); d.setHours(0,0,0,0);
  const dow = (d.getDay()+6)%7;                 // 0 = lunes
  const lunesEsta = new Date(d); lunesEsta.setDate(d.getDate()-dow);
  const lunesPrev = new Date(lunesEsta); lunesPrev.setDate(lunesEsta.getDate()-7);
  const domingoPrev = new Date(lunesEsta); domingoPrev.setDate(lunesEsta.getDate()-1);
  const iso = x=> `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  return { desde:iso(lunesPrev), hasta:iso(domingoPrev) };
}
function reporteSemanal(){
  const r = rangoSemanaAnterior();
  _indFiltro = { area:'', desde:r.desde, hasta:r.hasta };
  renderConfiabilidad();
  toast(`Generando reporte de la semana ${r.desde} a ${r.hasta}…`,'info');
  setTimeout(()=>exportarIndicadoresPDF(`Reporte_Semanal_ADF_${r.desde}_a_${r.hasta}`), 450);
}

/* ── Exportar a Excel (.xlsx) ── */
function exportarIndicadoresExcel(data, m, ex){
  if(typeof XLSX === 'undefined'){ toast('No se cargó la librería de Excel. Revisa tu conexión.','err'); return; }
  const fnum = h => h==null ? '' : Math.round(h*100)/100;

  const resumen = [
    ['INDICADORES DE MANTENIMIENTO · ADF SOPRAVAL'],
    ['Generado', new Date().toLocaleString('es-CL')],
    ['Filtro área', _indFiltro.area || 'Todas'],
    ['Filtro período', (_indFiltro.desde||'inicio') + ' a ' + (_indFiltro.hasta||'hoy')],
    [],
    ['Indicador','Valor'],
    ['MTTR (h)', fnum(m.mttrGlobal)],
    ['MTBF (h)', fnum(m.mtbfGlobal)],
    ['Disponibilidad (%)', m.dispGlobal!=null?Math.round(m.dispGlobal*10)/10:''],
    ['Total fallas (ADF)', data.length],
    ['Recurrentes', ex.recurrentes],
    ['Horas totales detenido', fnum(m.horasGlobal)],
    ['Minutos perdidos producción', Math.round(ex.minPerdidos)],
    ['Planes concluidos', ex.planesHechos + ' de ' + ex.planesTotal],
    ['Cumplimiento planes (%)', ex.cumplimiento!=null?Math.round(ex.cumplimiento):''],
  ];

  const porEquipo = [['Equipo','Cód. SAP','Área','N° Fallas','Fallas c/datos','MTTR (h)','MTBF (h)','Disponibilidad (%)','Horas detenido']];
  m.equipos.forEach(e=>porEquipo.push([ e.equipo, e.sap||'', e.area, e.nFallas, e.nConDatos,
    fnum(e.mttr), fnum(e.mtbf), e.disp!=null?Math.round(e.disp*10)/10:'', fnum(e.horasDetenido) ]));

  const detalle = [['Folio','Fecha','Área','Línea','Equipo','Cód. SAP','Componente','OT','Inicio falla','Marcha','Min. perdidos','Tipo','Modo de falla','Síntoma','Causas probables (6M)','Equipo del análisis','Participantes reparación','Estado','T. reparación (h)']];
  data.forEach(a=>detalle.push([ a.folio||'', a.fecha||'', a.area||'', a.linea||'', a.equipo||'', a.codSap||'', a.componente||'',
    a.ot||'', (a.fechaInicio||'')+' '+(a.horaInicio||''), (a.fechaMarcha||'')+' '+(a.horaMarcha||''),
    a.minutosPerdidos||'', a.tipoProblema||'', a.analisis?.modoDetectado || a.modoFalla || '',
    (a.sintoma||'').slice(0,120),
    (a.analisis?.causas||[]).filter(c=>c.probable).map(c=>`${c.txt} (${c.cat||'—'})`).join(' | '),
    (a.equipoAnalisis||[]).filter(p=>p.nombre).map(p=>`${p.nombre}${p.area?' ('+p.area+')':''}`).join(' | '),
    (a.participantes||[]).filter(p=>p.nombre).map(p=>`${p.nombre} (${p.rol||''})`).join(' | '),
    a.estado||'', fnum(downtimeHoras(a)) ]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen),   'Resumen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(porEquipo), 'Por equipo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle),   'Detalle ADF');
  XLSX.writeFile(wb, `Indicadores_ADF_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel generado.','ok');
}

/* ── Exportar a PDF ── */
async function exportarIndicadoresPDF(nombreArchivo){
  const node = $('ind-capture');
  if(!node || typeof html2canvas==='undefined' || !window.jspdf){ toast('No se cargaron las librerías de PDF.','err'); return; }
  toast('Generando PDF…','info');
  try{
    const canvas = await html2canvas(node, { scale:2, backgroundColor:'#ffffff', useCORS:true });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p','mm','a4');
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pw - margin*2;
    const imgH = canvas.height * imgW / canvas.width;
    // Cabecera
    pdf.setFontSize(13); pdf.setTextColor(27,53,128);
    pdf.text('Indicadores de Mantenimiento · ADF Sopraval', margin, 10);
    pdf.setFontSize(8); pdf.setTextColor(110);
    pdf.text(`Generado: ${new Date().toLocaleString('es-CL')}  ·  Área: ${_indFiltro.area||'Todas'}  ·  Período: ${(_indFiltro.desde||'inicio')} a ${(_indFiltro.hasta||'hoy')}`, margin, 15);
    const top = 19;
    const img = canvas.toDataURL('image/jpeg', 0.92);
    let heightLeft = imgH;
    let position = top;
    pdf.addImage(img, 'JPEG', margin, position, imgW, imgH);
    heightLeft -= (ph - top);
    while(heightLeft > 0){
      pdf.addPage();
      position = margin - (imgH - heightLeft);
      pdf.addImage(img, 'JPEG', margin, position, imgW, imgH);
      heightLeft -= (ph - margin);
    }
    const fname = (nombreArchivo && typeof nombreArchivo==='string') ? nombreArchivo : `Indicadores_ADF_${new Date().toISOString().slice(0,10)}`;
    pdf.save(`${fname}.pdf`);
    toast('PDF generado. Adjúntalo al correo para enviarlo a jefaturas.','ok');
  }catch(e){ console.error(e); toast('Error al generar PDF: '+e.message,'err'); }
}

function confiabilidadTabla(equipos, dispColor){
  if(!equipos.length) return `<div class="empty"><div class="e-icon">📊</div>Aún no hay ADF con datos suficientes para calcular indicadores.</div>`;
  return `<div class="tbl-wrap"><table class="data">
    <thead><tr>
      <th>Equipo</th><th>Cód. SAP</th><th>Área</th><th>N° Fallas</th>
      <th>MTTR</th><th>MTBF</th><th>Disponibilidad</th><th>Horas detenido</th>
    </tr></thead>
    <tbody>
      ${equipos.map(e=>`<tr>
        <td>${esc(e.equipo)}</td>
        <td class="nowrap"><code>${esc(e.sap||'—')}</code></td>
        <td>${esc(e.area)}</td>
        <td style="text-align:center"><b>${e.nFallas}</b>${e.nConDatos<e.nFallas?` <small style="color:var(--gray)">(${e.nConDatos} c/datos)</small>`:''}</td>
        <td class="nowrap">${fmtDur(e.mttr)}</td>
        <td class="nowrap">${e.mtbf!=null?fmtDur(e.mtbf):'<small style="color:var(--gray)">—</small>'}</td>
        <td class="nowrap"><b style="color:${dispColor(e.disp)}">${e.disp!=null?e.disp.toFixed(1)+'%':'—'}</b></td>
        <td class="nowrap">${fmtDur(e.horasDetenido)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ═══════════════════════════════════════════════════════════
   MODAL DETALLE / INFORME
   ═══════════════════════════════════════════════════════════ */
$('modal-close').addEventListener('click', cerrarModal);
$('modal-detalle').addEventListener('click', e=>{ if(e.target.id==='modal-detalle') cerrarModal(); });
function cerrarModal(){ $('modal-detalle').classList.remove('open'); _openId=null; _openPlanId=null; }

function abrirADF(id){
  const a=_cache.adfs.find(x=>x.id===id); if(!a) return;
  _openId=id;
  const probable=(a.analisis?.causas||[]).find(c=>c.probable);
  $('modal-title').textContent = (a.folio||'ADF')+' · '+(a.equipo||'');
  $('modal-body').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
      ${badge(a.estado)}
      ${a.tipoProblema==='Recurrente'?'<span class="badge b-recurrente">Recurrente</span>':'<span class="badge b-esporadico">Esporádico</span>'}
      <span class="muted" style="margin-left:auto;font-size:.8rem">Creado por ${esc(a.creadorNombre||'—')} · ${fmtDT(a.createdAt)}</span>
    </div>

    <div class="section-head"><h3>1 · Datos generales</h3></div>
    <div class="grid-3">
      <div><b>Fecha:</b> ${fmtD(a.fecha)}</div><div><b>Área:</b> ${esc(a.area)}</div><div><b>Línea:</b> ${esc(a.linea||'—')}</div>
      <div><b>Equipo:</b> ${esc(a.equipo)}</div><div><b>Cód. SAP:</b> ${esc(a.codSap||'—')}</div><div><b>OT:</b> ${esc(a.ot||'—')}</div>
      <div><b>Componente:</b> ${esc(a.componente||'—')}</div>
    </div>
    <p style="margin-top:8px;font-size:.88rem"><b>👥 Equipo del análisis:</b> ${(a.equipoAnalisis&&a.equipoAnalisis.length)?a.equipoAnalisis.filter(p=>p.nombre).map(p=>`${esc(p.nombre)}${p.area?' <span class="cat-tag">'+esc(p.area)+'</span>':''}`).join(' · ')||'—':'—'}</p>
    <p style="font-size:.88rem"><b>🔧 Participantes en la reparación:</b> ${(a.participantes&&a.participantes.length)?a.participantes.filter(p=>p.nombre).map(p=>`${esc(p.nombre)} <span class="cat-tag">${esc(p.rol||'')}</span>`).join(' · ')||'—':'—'}</p>

    <div class="section-head"><h3>2 · Avería</h3></div>
    <p><b>Síntoma:</b> ${esc(a.sintoma||'—')}</p>
    <p><b>Modo de falla:</b> ${esc(a.modoFalla||'—')}</p>
    <p><b>Acción correctiva:</b> ${esc(a.accionCorrectiva||'—')}</p>
    <p><b>Min. perdidos:</b> ${esc(a.minutosPerdidos||'0')} · <b>¿Afectó producción?:</b> ${esc(a.afectoProduccion)}</p>
    ${a.condiciones?`<div class="grid-3" style="font-size:.85rem;background:var(--gray-lt);padding:10px 12px;border-radius:8px;margin-top:6px">
      <div><b>Estado al fallar:</b> ${esc(a.condiciones.estado||'—')}${a.condiciones.estado==='Otro'&&a.condiciones.estadoOtro?' — '+esc(a.condiciones.estadoOtro):''}</div>
      <div><b>Turno:</b> ${esc(a.condiciones.turno||'—')}</div>
      <div><b>PM vencido:</b> ${esc(a.condiciones.pmVencido||'—')}</div>
      <div><b>Intervención reciente:</b> ${esc(a.condiciones.intervencion||'—')}${a.condiciones.intervencionDet?' — '+esc(a.condiciones.intervencionDet):''}</div>
      <div style="grid-column:span 2"><b>Fuera de parámetro:</b> ${esc(a.condiciones.fueraParam||'—')}${a.condiciones.fueraParamDet?' — '+esc(a.condiciones.fueraParamDet):''}</div>
    </div>`:''}

    <div class="section-head"><h3>3 · Fenómeno (5W+1H)</h3></div>
    <div class="grid-2" style="font-size:.88rem">
      <div><b>¿Qué?</b> ${esc(a.w_que||'—')}</div><div><b>¿Cuándo?</b> ${esc(a.w_cuando||'—')}</div>
      <div><b>¿Dónde?</b> ${esc(a.w_donde||'—')}</div><div><b>¿Quién?</b> ${esc(a.w_quien||'—')}</div>
      <div><b>¿Cuál?</b> ${esc(a.w_cual||'—')}</div><div><b>¿Cómo?</b> ${esc(a.w_como||'—')}</div>
    </div>
    ${a.imagen?`<img class="img-preview" src="${a.imagen}" style="margin-top:10px;max-width:280px">`:''}

    <div class="section-head"><h3>4 · Causas probables ${a.analisis?`<small class="muted">(${esc(a.analisis.modoDetectado)}${(a.analisis.tipoEquipo&&a.analisis.tipoEquipo.length)?' · '+esc(a.analisis.tipoEquipo.join(' · ')):''})</small>`:''}</h3></div>
    <div class="causa-list">${(a.analisis?.causas||[]).map((c,i)=>
      `<div class="causa-item ${c.probable?'probable':''}"><span class="c-num">${i+1}</span><span class="c-txt">${esc(c.txt)} ${c.cat?`<span class="cat-tag">${esc(c.cat)}</span>`:''} ${c.origen?`<span class="origen-tag">${esc(c.origen)}</span>`:''} ${c.probable?'<b style="color:var(--orange-dk)"> ← probable</b>':''}</span></div>`).join('')}</div>
    ${a.analisis?.sintesis?sintesisHTML(a.analisis.sintesis):''}

    <div class="section-head"><h3>5 · 5 Porqués</h3></div>
    <div class="porque-chain">${(a.analisis?.porques||[]).map((p,i)=>
      `<div class="porque-step"><span class="p-badge">¿Por qué? ${i+1}</span><div style="padding:8px 0">${esc(p)}</div></div>`).join('')}</div>

    <div class="section-head"><h3>6 · Planes de acción</h3></div>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Actividad</th><th>Responsable</th><th>Fecha</th><th>Tipo</th></tr></thead>
      <tbody>${(a.analisis?.planes||[]).map(p=>`<tr><td>${esc(p.actividad)}</td><td>${esc(p.responsable||'—')}</td><td>${fmtD(p.fecha)}</td>
      <td>${p.tipo==='INMEDIATA'?'<span class="badge b-inmediata">Inmediata</span>':'<span class="badge b-permanente">Permanente</span>'}</td></tr>`).join('')}</tbody></table></div>

    <div class="section-head"><h3>7 · Seguimiento de soluciones</h3></div>
    <div id="seg-zone">${segHTML(a)}</div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
      ${a.estado!=='Cerrado'?`<button class="btn-green" onclick="guardarSeguimiento('${a.id}')">💾 Guardar seguimiento</button>`:''}
      ${(esLider() && a.estado!=='Cerrado')?`<button class="btn-primary" onclick="cerrarADF('${a.id}')">🔒 Validar y cerrar ADF</button>`:''}
      ${(esLider() || a.creadorId===CU.id)?`<button class="btn-danger" onclick="eliminarADF('${a.id}')">🗑 Eliminar</button>`:''}
      <button class="btn-ghost" onclick="window.print()">🖨 Imprimir</button>
    </div>
    ${a.estado==='Cerrado'?`<p class="muted" style="margin-top:12px">🔒 Cerrado por ${esc(a.cerradoPor)} · ${fmtDT(a.cerradoAt)}</p>`:''}
  `;
  $('modal-detalle').classList.add('open');
}

function segHTML(a){
  const seg=a.seguimiento||[];
  if(!seg.length) return '<p class="muted">Sin actividades de seguimiento.</p>';
  const ro = a.estado==='Cerrado';
  return seg.map((s,i)=>`
    <div class="seg-card" id="seg-card-${i}">
      <div class="seg-header">
        <span class="seg-num">${i+1}</span>
        <span class="seg-act">${esc(s.actividad)}</span>
        ${s.hecho?'<span class="badge b-cerrado" style="margin-left:auto">✓ Concluido</span>':''}
      </div>
      <div class="seg-body">
        <div class="seg-row-inner">
          <div class="field">
            <label>Fecha solución</label>
            <input type="date" value="${s.fechaSolucion||''}" ${ro?'disabled':''}
              onchange="editSeg('${a.id}',${i},'fechaSolucion',this.value)">
          </div>
          <div class="field" style="flex:2">
            <label>Actividad realizada</label>
            <textarea rows="2" placeholder="Describe la actividad realizada..." ${ro?'disabled':''}
              onchange="editSeg('${a.id}',${i},'realizado',this.value)">${esc(s.realizado||'')}</textarea>
          </div>
        </div>
        <div class="seg-row-inner">
          <div class="field" style="flex:1">
            <label>Comentario / observación</label>
            <textarea rows="2" placeholder="Observaciones adicionales..." ${ro?'disabled':''}
              onchange="editSeg('${a.id}',${i},'comentario',this.value)">${esc(s.comentario||'')}</textarea>
          </div>
          <div class="field seg-img-field">
            <label>Imagen de respaldo</label>
            ${s.imagen?`<img class="seg-img-thumb" src="${s.imagen}" onclick="verImagenSeg('${a.id}',${i})" title="Ver imagen">`:'' }
            ${!ro?`<div class="img-drop-sm" onclick="document.getElementById('seg-img-${a.id}-${i}').click()">
              📷 ${s.imagen?'Cambiar imagen':'Adjuntar imagen'}
            </div>
            <input type="file" id="seg-img-${a.id}-${i}" accept="image/*" class="hidden"
              onchange="subirImgSeg('${a.id}',${i},this)">`:'' }
          </div>
        </div>
      </div>
    </div>`).join('') +
    `<div class="field" style="margin-top:10px"><label>Evidencia general de las soluciones</label>
      <textarea ${ro?'disabled':''} id="seg-evid" onchange="this.dataset.v=this.value">${esc(a.evidencias||'')}</textarea></div>`;
}

async function subirImgSeg(adfId, idx, input){
  const file=input.files[0]; if(!file) return;
  const img64=await comprimirImg(file);
  editSeg(adfId, idx, 'imagen', img64);
  const card=document.getElementById('seg-card-'+idx);
  if(card){
    const imgField=card.querySelector('.seg-img-field');
    let thumb=imgField.querySelector('.seg-img-thumb');
    if(thumb){ thumb.src=img64; }
    else{
      thumb=document.createElement('img');
      thumb.className='seg-img-thumb'; thumb.src=img64;
      thumb.title='Ver imagen';
      thumb.onclick=()=>verImagenSeg(adfId,idx);
      const dropBtn=imgField.querySelector('.img-drop-sm');
      imgField.insertBefore(thumb, dropBtn);
    }
    const dropBtn=imgField.querySelector('.img-drop-sm');
    if(dropBtn) dropBtn.textContent='📷 Cambiar imagen';
  }
  toast('Imagen cargada.','ok');
}

function verImagenSeg(adfId, idx){
  const a=_cache.adfs.find(x=>x.id===adfId); if(!a) return;
  const s=(a.seguimiento||[])[idx]; if(!s?.imagen) return;
  const w=window.open('','_blank','width=840,height=700');
  w.document.write(`<!DOCTYPE html><html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh">
    <img src="${s.imagen}" style="max-width:100%;max-height:95vh;border-radius:8px"></body></html>`);
}

const _segEdit={};
function editSeg(id,i,f,v){ _segEdit[id]=_segEdit[id]||{}; _segEdit[id][i]=_segEdit[id][i]||{}; _segEdit[id][i][f]=v; }

async function guardarSeguimiento(id){
  const a=_cache.adfs.find(x=>x.id===id); if(!a) return;
  const seg=(a.seguimiento||[]).map((s,i)=>({ ...s, ...(_segEdit[id]?_segEdit[id][i]:{}) }));
  const evid = ($('seg-evid')?.value) ?? a.evidencias;
  const algunHecho = seg.some(s=>s.realizado && s.realizado.trim());
  await fdb.collection(COL_ADF).doc(id).update({
    seguimiento:seg, evidencias:evid,
    estado: a.estado==='PlanAccion' && algunHecho ? 'Seguimiento' : a.estado,
    updatedAt:new Date().toISOString(),
  });
  toast('Seguimiento guardado.','ok'); cerrarModal();
}

async function cerrarADF(id){
  await fdb.collection(COL_ADF).doc(id).update({
    estado:'Cerrado', cerradoPor:CU.name, cerradoAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    historial:firebase.firestore.FieldValue.arrayUnion({ accion:'Cerrado', usuario:CU.name, fecha:new Date().toISOString() }),
  });
  toast('ADF cerrado.','ok'); cerrarModal();
}

async function eliminarADF(id){
  if(!confirm('¿Eliminar este ADF? Esta acción no se puede deshacer.')) return;
  await fdb.collection(COL_ADF).doc(id).delete();
  toast('ADF eliminado.','info'); cerrarModal();
}

/* ═══════════════════════════════════════════════════════════
   PLANES DE MANTENIMIENTO PREVENTIVO (solo líderes)
   Colección: adf_planes_mp
   Derivados de análisis ADF para prevenir recurrencia.
   ═══════════════════════════════════════════════════════════ */
function escucharPlanesMP(){
  fdb.collection(COL_PLANES).onSnapshot(snap=>{
    _cache.planes = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    if(_activeTab==='mantenimiento') renderMantenimiento();
  });
}

function renderMantenimiento(){
  const planes = _cache.planes;
  const kAct  = planes.filter(p=>p.estado==='Activo').length;
  const kPend = planes.filter(p=>p.estado==='Pendiente').length;
  const kSusp = planes.filter(p=>p.estado==='Suspendido').length;
  $('pane-mantenimiento').innerHTML = `
    <div class="page-title">🔧 Planes de Mantenimiento Preventivo</div>
    <div class="page-sub">Derivados de análisis ADF — acciones estructurales para prevenir recurrencia de fallas</div>
    <div class="kpi-grid">
      <div class="kpi accent"><div class="k-val">${planes.length}</div><div class="k-lbl">Total planes PM</div></div>
      <div class="kpi"><div class="k-val">${kAct}</div><div class="k-lbl">Activos</div></div>
      <div class="kpi"><div class="k-val">${kPend}</div><div class="k-lbl">Pendientes</div></div>
      <div class="kpi"><div class="k-val">${kSusp}</div><div class="k-lbl">Suspendidos</div></div>
    </div>
    <div style="margin-bottom:18px">
      <button class="btn-primary" onclick="abrirNuevoPlan()">➕ Crear Plan PM desde ADF</button>
    </div>
    ${planes.length ? tablaPlanesMP(planes)
      : `<div class="empty"><div class="e-icon">🔧</div>No hay planes PM aún.<br><small>Crea el primero a partir de un ADF analizado.</small></div>`}
  `;
}

function tablaPlanesMP(list){
  return `<div class="tbl-wrap"><table class="data">
    <thead><tr><th>ADF origen</th><th>Equipo</th><th>Área</th><th>Causa raíz</th><th>Actividades</th><th>Estado</th><th></th></tr></thead>
    <tbody>${list.map(p=>`
      <tr class="row-click" onclick="abrirPlanMP('${p.id}')">
        <td class="nowrap"><b>${esc(p.adfFolio||'—')}</b></td>
        <td>${esc(p.equipo||'—')}</td>
        <td>${esc(p.area||'—')}</td>
        <td style="max-width:240px">${esc((p.causaRaiz||'—').slice(0,70))}${(p.causaRaiz||'').length>70?'…':''}</td>
        <td style="text-align:center"><b>${(p.actividades||[]).length}</b></td>
        <td>${badgePlanMP(p.estado)}</td>
        <td><button class="btn-ghost btn-sm">Ver</button></td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function badgePlanMP(est){
  if(est==='Activo')     return '<span class="badge b-cerrado">Activo</span>';
  if(est==='Suspendido') return '<span class="badge b-borrador">Suspendido</span>';
  return '<span class="badge b-analisis">Pendiente</span>';
}

// ── Abrir modal nuevo plan ──
function abrirNuevoPlan(){
  _openPlanId = '__nuevo__';
  $('modal-title').textContent = '➕ Nuevo Plan de Mantenimiento Preventivo';
  $('modal-body').innerHTML = formPlanMP(null);
  $('modal-detalle').classList.add('open');
  const sel = $('mp-adf-sel');
  if(sel) sel.addEventListener('change', e=>autoFillPlan(e.target.value));
}

// ── Abrir modal plan existente ──
function abrirPlanMP(id){
  const p = _cache.planes.find(x=>x.id===id); if(!p) return;
  _openPlanId = id;
  $('modal-title').textContent = '🔧 Plan PM · '+(p.adfFolio||'—')+' · '+(p.equipo||'');
  $('modal-body').innerHTML = formPlanMP(p);
  $('modal-detalle').classList.add('open');
}

function formPlanMP(p){
  const isNew = !p;
  const acts  = p?.actividades || [];
  const adfs  = _cache.adfs;
  return `
    ${isNew ? `
    <div class="field">
      <label>ADF de origen *</label>
      <select id="mp-adf-sel">
        <option value="">-- Seleccionar ADF para auto-completar --</option>
        ${adfs.map(a=>`<option value="${a.id}">${esc(a.folio||'S/F')} · ${esc(a.equipo||'—')} · ${esc(a.area||'')}</option>`).join('')}
      </select>
    </div>` :
    `<p class="muted" style="margin-bottom:14px">ADF origen: <b>${esc(p.adfFolio||'—')}</b> &nbsp;·&nbsp; Creado por ${esc(p.creadoPor||'—')} &nbsp;·&nbsp; ${fmtD(p.createdAt)}</p>`}

    <div class="grid-3">
      <div class="field"><label>Equipo</label><input id="mp-equipo" value="${esc(p?.equipo||'')}" placeholder="Equipo afectado"></div>
      <div class="field"><label>Área</label><input id="mp-area" value="${esc(p?.area||'')}" placeholder="Área de planta"></div>
      <div class="field"><label>Modo de falla origen</label><input id="mp-modo" value="${esc(p?.modoFalla||'')}" placeholder="Modo de falla"></div>
    </div>
    <div class="field">
      <label>Causa raíz identificada (5° ¿Por qué?)</label>
      <textarea id="mp-causa" rows="2" placeholder="Ej: Falta gestión de altas de equipos en sistema de mantenimiento">${esc(p?.causaRaiz||'')}</textarea>
    </div>
    <div class="field">
      <label>Objetivo del plan preventivo</label>
      <textarea id="mp-objetivo" rows="2" placeholder="Ej: Garantizar lubricación periódica y evitar recurrencia del fallo">${esc(p?.objetivo||'')}</textarea>
    </div>

    <div class="section-head" style="margin-top:20px"><h3>Actividades preventivas</h3><p>Define qué hacer, con qué frecuencia y quién es responsable.</p></div>
    <div id="mp-acts-list">
      ${acts.map((a,i)=>mpActRowHTML(a,i)).join('')}
      ${acts.length===0 ? '<p class="muted" style="margin-bottom:10px;font-size:.84rem">Sin actividades. Selecciona un ADF para auto-completar desde sus acciones PERMANENTES, o agrega manualmente.</p>' : ''}
    </div>
    <button class="btn-ghost btn-sm" style="margin-bottom:18px" onclick="agregarActMP()">+ Agregar actividad</button>

    <div class="field">
      <label>Estado del plan</label>
      <select id="mp-estado">
        <option ${(p?.estado||'Pendiente')==='Pendiente'?'selected':''}>Pendiente</option>
        <option ${p?.estado==='Activo'?'selected':''}>Activo</option>
        <option ${p?.estado==='Suspendido'?'selected':''}>Suspendido</option>
      </select>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
      <button class="btn-green" onclick="guardarPlanMP()">💾 Guardar plan PM</button>
      ${!isNew ? `<button class="btn-danger" onclick="eliminarPlanMP('${p.id}')">🗑 Eliminar</button>` : ''}
      <button class="btn-ghost" onclick="window.print()">🖨 Imprimir</button>
    </div>
  `;
}

function mpActRowHTML(a, i){
  const tipos = ['Inspección','Lubricación','Reemplazo','Limpieza','Calibración','Verificación','Capacitación','Ajuste'];
  const freqs = ['Diaria','Semanal','Quincenal','Mensual','Trimestral','Semestral','Anual','Por condición'];
  return `<div class="mp-act-row" id="mp-act-${i}">
    <div class="mp-act-num">${i+1}</div>
    <div class="mp-act-body">
      <div class="field" style="margin-bottom:8px">
        <textarea rows="2" placeholder="Descripción de la actividad preventiva...">${esc(a.descripcion||'')}</textarea>
      </div>
      <div class="mp-act-meta">
        <div class="field" style="margin-bottom:0">
          <label>Tipo</label>
          <select>${tipos.map(t=>`<option ${a.tipo===t?'selected':''}>${t}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Frecuencia</label>
          <select onchange="calcProximaAuto(${i})">${freqs.map(f=>`<option ${a.frecuencia===f?'selected':''}>${f}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Responsable</label>
          <input placeholder="Nombre o cargo" value="${esc(a.responsable||'')}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Última ejecución</label>
          <input type="date" value="${a.ultimaEjecucion||''}" onchange="calcProximaAuto(${i})">
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Próxima ejecución</label>
          <input type="date" value="${a.proximaEjecucion||''}">
        </div>
      </div>
    </div>
  </div>`;
}

function calcProximaAuto(idx){
  const row = $('mp-act-'+idx); if(!row) return;
  const ultEl  = row.querySelectorAll('input[type=date]')[0];
  const proxEl = row.querySelectorAll('input[type=date]')[1];
  const freqEl = row.querySelectorAll('select')[1];
  if(!ultEl?.value || !freqEl?.value) return;
  const d = new Date(ultEl.value+'T00:00:00');
  const map = { 'Diaria':1,'Semanal':7,'Quincenal':15,'Mensual':30,'Trimestral':91,'Semestral':182,'Anual':365 };
  const dias = map[freqEl.value]; if(!dias) return;
  d.setDate(d.getDate()+dias);
  if(proxEl) proxEl.value = d.toISOString().slice(0,10);
}

function autoFillPlan(adfId){
  if(!adfId) return;
  const a = _cache.adfs.find(x=>x.id===adfId); if(!a) return;
  const set = (id,v) => { const el=$(id); if(el) el.value=v; };
  set('mp-equipo', a.equipo||'');
  set('mp-area',   a.area||'');
  set('mp-modo',   a.modoFalla||'');
  const porques = a.analisis?.porques||[];
  set('mp-causa', porques[porques.length-1]||'');
  const objEl=$('mp-objetivo');
  if(objEl && !objEl.value) objEl.value=`Prevenir recurrencia de "${a.modoFalla||a.sintoma||'falla'}" en ${a.equipo||'equipo'}`;
  // Actividades desde acciones PERMANENTES del ADF
  const permanentes = (a.analisis?.planes||[]).filter(p=>p.tipo==='PERMANENTE');
  const newActs = permanentes.map(p=>({
    descripcion:p.actividad, tipo:'Verificación', frecuencia:'Mensual',
    responsable:p.responsable||'', ultimaEjecucion:'', proximaEjecucion:'',
  }));
  if(!newActs.length) return;
  const listEl=$('mp-acts-list');
  if(listEl) listEl.innerHTML = newActs.map((ac,i)=>mpActRowHTML(ac,i)).join('');
}

function agregarActMP(){
  const listEl=$('mp-acts-list'); if(!listEl) return;
  const idx = listEl.querySelectorAll('.mp-act-row').length;
  const newAct = { descripcion:'', tipo:'Inspección', frecuencia:'Mensual', responsable:'', ultimaEjecucion:'', proximaEjecucion:'' };
  listEl.insertAdjacentHTML('beforeend', mpActRowHTML(newAct, idx));
}

function leerActividadesDOM(){
  const rows = document.querySelectorAll('.mp-act-row');
  return Array.from(rows).map(row=>{
    const sels   = row.querySelectorAll('select');
    const inputs = row.querySelectorAll('input');
    const ta     = row.querySelector('textarea');
    return {
      descripcion:   ta?.value||'',
      tipo:          sels[0]?.value||'Inspección',
      frecuencia:    sels[1]?.value||'Mensual',
      responsable:   inputs[0]?.value||'',
      ultimaEjecucion:  inputs[1]?.value||'',
      proximaEjecucion: inputs[2]?.value||'',
    };
  });
}

async function guardarPlanMP(){
  const equipo = $('mp-equipo')?.value.trim()||'';
  if(!equipo){ toast('Completa al menos el campo Equipo.','err'); return; }
  const adfSelEl = $('mp-adf-sel');
  const adfId    = adfSelEl?.value||'';
  const adfRef   = adfId ? _cache.adfs.find(x=>x.id===adfId) : null;
  const existing = (_openPlanId && _openPlanId!=='__nuevo__') ? _cache.planes.find(x=>x.id===_openPlanId) : null;

  const plan = {
    adfId:    adfId || existing?.adfId || '',
    adfFolio: adfRef?.folio || existing?.adfFolio || '',
    equipo,
    area:       $('mp-area')?.value.trim()||'',
    modoFalla:  $('mp-modo')?.value.trim()||'',
    causaRaiz:  $('mp-causa')?.value.trim()||'',
    objetivo:   $('mp-objetivo')?.value.trim()||'',
    actividades: leerActividadesDOM(),
    estado:     $('mp-estado')?.value||'Pendiente',
    creadoPor:  existing?.creadoPor || CU.name,
    creadoPorId:existing?.creadoPorId || CU.id,
    updatedAt:  new Date().toISOString(),
  };

  try{
    if(existing){
      await fdb.collection(COL_PLANES).doc(_openPlanId).update(plan);
      toast('Plan PM actualizado.','ok');
    } else {
      plan.createdAt = new Date().toISOString();
      const id = uid();
      await fdb.collection(COL_PLANES).doc(id).set({id,...plan});
      toast('Plan PM creado.','ok');
    }
    cerrarModal();
  }catch(e){ toast('Error al guardar: '+e.message,'err'); }
}

async function eliminarPlanMP(id){
  if(!confirm('¿Eliminar este plan de mantenimiento? Esta acción no se puede deshacer.')) return;
  await fdb.collection(COL_PLANES).doc(id).delete();
  toast('Plan PM eliminado.','info'); cerrarModal();
}

/* ═══════════════════════════════════════════════════════════
   CATÁLOGO (solo líderes) — vista del motor de reglas
   ═══════════════════════════════════════════════════════════ */
function renderCatalogo(){
  $('pane-catalogo').innerHTML = `
    <div class="page-title">📚 Catálogo del Motor de Análisis</div>
    <div class="page-sub">${CATALOGO.length} modos de falla industriales precargados. El sistema detecta el modo por palabras clave del síntoma/modo de falla.</div>
    ${CATALOGO.map(m=>`
      <div class="card">
        <div class="card-title">🔧 ${esc(m.nombre)}</div>
        <div class="card-sub">Palabras clave: ${m.keys.map(k=>`<code>${esc(k)}</code>`).join(', ')}</div>
        <p><b>Causas probables (${m.causas.length}):</b> ${m.causas.map(esc).join(' · ')}</p>
        <p style="margin-top:8px"><b>Acciones tipo:</b> ${m.acciones.map(a=>`${esc(a.a)} <span class="badge ${a.t==='INMEDIATA'?'b-inmediata':'b-permanente'}">${a.t}</span>`).join(' · ')}</p>
      </div>`).join('')}
  `;
}

/* ═══════════════════════════════════════════════════════════
   USUARIOS (solo líderes)
   ═══════════════════════════════════════════════════════════ */
function renderUsuarios(){
  $('pane-usuarios').innerHTML = `
    <div class="page-title">👥 Usuarios</div>
    <div class="page-sub">${_cache.users.length} usuario(s) registrado(s)</div>
    <div class="tbl-wrap"><table class="data">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Cargo</th><th>Rol</th></tr></thead>
      <tbody>${_cache.users.map(u=>`<tr>
        <td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.cargo||'—')}</td>
        <td>${u.role==='lider'?'<span class="badge b-permanente">Líder</span>':'<span class="badge b-esporadico">Técnico</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="card" style="margin-top:18px">
      <div class="card-title">➕ Crear técnico</div>
      <div class="grid-3">
        <div class="field"><label>Nombre</label><input id="nu-name"></div>
        <div class="field"><label>Correo</label><input id="nu-email" placeholder="usuario@sopraval.cl"></div>
        <div class="field"><label>Cargo</label><input id="nu-cargo" value="Técnico de Mantenimiento"></div>
      </div>
      <button class="btn-primary" id="btn-crear-user">Crear usuario (clave: Sopraval2026)</button>
    </div>
  `;
  $('btn-crear-user').addEventListener('click', crearUsuario);
}

async function crearUsuario(){
  const name=$('nu-name').value.trim(), email=$('nu-email').value.trim().toLowerCase(), cargo=$('nu-cargo').value.trim();
  if(!name||!email){ toast('Completa nombre y correo.','err'); return; }
  try{
    const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ email, password:'Sopraval2026', returnSecureToken:false })
    });
    const data=await r.json();
    const id=data.localId||uid();
    await fdb.collection(COL_USERS).doc(id).set({ id, email, name, cargo, role:'tecnico' });
    await cargarUsuarios();
    toast('Usuario creado.','ok'); renderUsuarios();
  }catch(e){ toast('Error: '+e.message,'err'); }
}

// Exponer funciones usadas en onclick inline
Object.assign(window,{ irTab, abrirADF, marcarProbable, editCausa, editPorque, editPlan,
  agregarPlan, editSeg, guardarSeguimiento, cerrarADF, eliminarADF,
  concluirPlan, subirImgSeg, verImagenSeg, subirRespaldo, verRespaldo,
  abrirNuevoPlan, abrirPlanMP, guardarPlanMP, eliminarPlanMP,
  agregarActMP, calcProximaAuto, autoFillPlan });
