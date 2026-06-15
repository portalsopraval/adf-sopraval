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
    keys:['atasc','obstru','tranc','bloque','tap','acumul','traba'],
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

// Detecta el mejor modo de falla según texto libre
function detectarModo(texto){
  const t = String(texto||'').toLowerCase();
  let best=null, bestScore=0;
  for(const m of CATALOGO){
    let score=0;
    for(const k of m.keys){ if(t.includes(k)) score++; }
    if(score>bestScore){ bestScore=score; best=m; }
  }
  return best || GENERICO;
}

// Genera análisis completo a partir de los datos de la falla
function generarAnalisis(adf){
  const texto = [adf.sintoma, adf.modoFalla, adf.w_que, adf.w_como, adf.w_cual, adf.accionCorrectiva].join(' ');
  const modo = detectarModo(texto);
  return {
    modoDetectado: modo.nombre,
    causas: modo.causas.map((c,i)=>({ txt:c, probable: i===modo.probable })),
    porques: modo.porques.slice(),
    planes: modo.acciones.map(a=>({ actividad:a.a, tipo:a.t, responsable:'', fecha:'' })),
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
  const tabs = TABS[CU.role] || TABS.tecnico;
  $('tabs-nav').innerHTML = tabs.map(([k,l])=>
    `<button class="tab-btn" data-tab="${k}">${l}</button>`).join('');
  $('tabs-nav').querySelectorAll('.tab-btn').forEach(b=>
    b.addEventListener('click', ()=>irTab(b.dataset.tab)));
}

function irTab(tab){
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
  if(tab==='mantenimiento') renderMantenimiento();
  if(tab==='catalogo') renderCatalogo();
  if(tab==='usuarios') renderUsuarios();
}

// Listener en tiempo real
function escucharADFs(){
  fdb.collection(COL_ADF).onSnapshot(snap=>{
    _cache.adfs = snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
    if(['inicio','listado','seguimiento','tiempos'].includes(_activeTab)) irTab(_activeTab);
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
    <div class="card">
      <div class="card-title">⚡ Acción rápida</div>
      <div class="card-sub">Ingresa una nueva falla y deja que el sistema proponga el análisis de causa raíz.</div>
      <button class="btn-primary" onclick="irTab('nuevo')">➕ Registrar nueva falla (ADF)</button>
    </div>
    <div class="section-head"><h3>Últimos análisis</h3></div>
    ${tablaADF(data.slice(0,6))}
  `;
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
    fecha:new Date().toISOString().slice(0,10), area:'', folio:'', linea:'', equipo:'', codSap:'',
    fechaInicio:'', horaInicio:'', fechaMarcha:'', horaMarcha:'', minutosPerdidos:'',
    ot:'', afectoProduccion:'No', tipoProblema:'Esporádico',
    sintoma:'', modoFalla:'', accionCorrectiva:'',
    participantes:[{n:'',a:''}],
    w_que:'', w_cuando:'', w_donde:'', w_quien:'', w_cual:'', w_como:'',
    imagen:'',
    analisis:null,
  };
}

function renderNuevo(){
  if(!_wizard) _wizard = nuevoBorrador();
  const w=_wizard;
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
      </div>
      <input type="hidden" id="f-area" value="${esc(w.area)}">
      <input type="hidden" id="f-linea" value="${esc(w.linea)}">
      <input type="hidden" id="f-equipo" value="${esc(w.equipo)}">
      <input type="hidden" id="f-sap" value="${esc(w.codSap)}">
    </div>

    <div class="card">
      <div class="card-title">2 · Datos de la Avería</div>
      <div class="grid-3">
        <div class="field"><label>Fecha inicio</label><input type="date" id="f-finicio" value="${w.fechaInicio}"></div>
        <div class="field"><label>Hora inicio</label><input type="time" id="f-hinicio" value="${w.horaInicio}"></div>
        <div class="field"><label>Minutos perdidos producción</label><input type="number" id="f-min" value="${esc(w.minutosPerdidos)}"></div>
        <div class="field"><label>Fecha puesta en marcha</label><input type="date" id="f-fmarcha" value="${w.fechaMarcha}"></div>
        <div class="field"><label>Hora puesta en marcha</label><input type="time" id="f-hmarcha" value="${w.horaMarcha}"></div>
        <div class="field"><label>OT</label><input id="f-ot" value="${esc(w.ot)}"></div>
        <div class="field"><label>¿Afectó producción?</label><select id="f-afecto"><option ${w.afectoProduccion==='Sí'?'selected':''}>Sí</option><option ${w.afectoProduccion==='No'?'selected':''}>No</option></select></div>
        <div class="field"><label>Tipo de problema</label><select id="f-tipo"><option ${w.tipoProblema==='Esporádico'?'selected':''}>Esporádico</option><option ${w.tipoProblema==='Recurrente'?'selected':''}>Recurrente</option></select></div>
      </div>
      <div class="field"><label>Síntoma observado *</label><textarea id="f-sintoma" placeholder="¿Qué se observó? Ej: motor con sobrecalentamiento y ruido">${esc(w.sintoma)}</textarea></div>
      <div class="field"><label>Modo de falla *</label><textarea id="f-modo" placeholder="Ej: detención por protección térmica">${esc(w.modoFalla)}</textarea></div>
      <div class="field"><label>Acción correctiva aplicada</label><textarea id="f-accion" placeholder="¿Qué se hizo para restablecer?">${esc(w.accionCorrectiva)}</textarea></div>
    </div>

    <div class="card">
      <div class="card-title">3 · Descripción del Fenómeno (5W + 1H)</div>
      <div class="grid-2">
        <div class="field"><label>¿Qué? (fenómeno)</label><textarea id="f-que">${esc(w.w_que)}</textarea></div>
        <div class="field"><label>¿Cuándo?</label><textarea id="f-cuando">${esc(w.w_cuando)}</textarea></div>
        <div class="field"><label>¿Dónde?</label><textarea id="f-donde">${esc(w.w_donde)}</textarea></div>
        <div class="field"><label>¿Quién?</label><textarea id="f-quien">${esc(w.w_quien)}</textarea></div>
        <div class="field"><label>¿Cuál?</label><textarea id="f-cual">${esc(w.w_cual)}</textarea></div>
        <div class="field"><label>¿Cómo?</label><textarea id="f-como">${esc(w.w_como)}</textarea></div>
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
  ['f-fecha','f-folio','f-finicio','f-hinicio','f-min',
   'f-fmarcha','f-hmarcha','f-ot','f-afecto','f-tipo','f-sintoma','f-modo','f-accion',
   'f-que','f-cuando','f-donde','f-quien','f-cual','f-como'].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('change', cap);
  });
  $('f-img').addEventListener('change', async e=>{
    const file=e.target.files[0]; if(!file) return;
    _wizard.imagen = await comprimirImg(file);
    $('img-prev').innerHTML=`<img class="img-preview" src="${_wizard.imagen}">`;
  });
  $('btn-generar').addEventListener('click', ()=>{ capturarWizard(); hacerAnalisis(); });
  $('btn-reset').addEventListener('click', ()=>{ _wizard=nuevoBorrador(); renderNuevo(); });

  bindMaquinaSearch();
  if(w.analisis) renderAnalisisZone();
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
    equipo:g('f-equipo'), codSap:g('f-sap'), fechaInicio:g('f-finicio'), horaInicio:g('f-hinicio'),
    minutosPerdidos:g('f-min'), fechaMarcha:g('f-fmarcha'), horaMarcha:g('f-hmarcha'), ot:g('f-ot'),
    afectoProduccion:g('f-afecto'), tipoProblema:g('f-tipo'), sintoma:g('f-sintoma'),
    modoFalla:g('f-modo'), accionCorrectiva:g('f-accion'),
    w_que:g('f-que'), w_cuando:g('f-cuando'), w_donde:g('f-donde'), w_quien:g('f-quien'),
    w_cual:g('f-cual'), w_como:g('f-como'),
  });
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
      <p>Revisa y ajusta. Marca la causa más probable.</p></div>

    <div class="card">
      <div class="card-title">4 · Causas Más Probables (lluvia de ideas)</div>
      <div class="causa-list" id="causa-list">
        ${an.causas.map((c,i)=>`
          <label class="causa-item ${c.probable?'probable':''}" id="causa-${i}">
            <input type="radio" name="causa-prob" ${c.probable?'checked':''} onchange="marcarProbable(${i})">
            <span class="c-num">${i+1}</span>
            <span class="c-txt"><textarea rows="1" onchange="editCausa(${i},this.value)">${esc(c.txt)}</textarea></span>
          </label>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">5 · Análisis 5 Porqués (de la causa más probable)</div>
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
  </div>`;
}

// Editores in-place del análisis
function marcarProbable(i){ _wizard.analisis.causas.forEach((c,j)=>c.probable=(j===i));
  document.querySelectorAll('.causa-item').forEach((el,j)=>el.classList.toggle('probable',j===i)); }
function editCausa(i,v){ _wizard.analisis.causas[i].txt=v; }
function editPorque(i,v){ _wizard.analisis.porques[i]=v; }
function editPlan(i,f,v){ _wizard.analisis.planes[i][f]=v; }
function agregarPlan(){ _wizard.analisis.planes.push({actividad:'',tipo:'PERMANENTE',responsable:'',fecha:''});
  $('plan-list').insertAdjacentHTML('beforeend', planRowHTML(_wizard.analisis.planes.at(-1), _wizard.analisis.planes.length-1)); }

async function guardarADF(){
  const w=_wizard;
  if(!w.equipo || !w.sintoma){ toast('Completa al menos Equipo y Síntoma.','err'); return; }
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
      const pct = Math.round(transcurrido/totalDias*100);
      let semaforo, semCls;
      if(s.hecho){ semaforo='✅'; semCls='sem-done'; }
      else if(pct<50){ semaforo='🟢'; semCls='sem-ok'; }
      else if(pct<90){ semaforo='🟡'; semCls='sem-warn'; }
      else if(pct<=100){ semaforo='🟠'; semCls='sem-limit'; }
      else { semaforo='🔴'; semCls='sem-over'; }
      rows.push({ a, i, pl, s, pct, transcurrido, totalDias, semaforo, semCls });
    });
  }

  $('pane-tiempos').innerHTML = `
    <div class="page-title">⏱ Control de Tiempos</div>
    <div class="page-sub">Planes de acción con fecha compromiso — ${rows.length} item(s) activo(s)</div>
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
      <th>Responsable</th><th>F. Compromiso</th><th>Transcurrido</th>
      <th>Semáforo</th><th>Avance</th><th>Concluido</th>
    </tr></thead>
    <tbody>
      ${rows.map(r=>`<tr class="${r.s.hecho?'row-done':''}">
        <td>${badge(r.a.estado)}</td>
        <td class="nowrap"><b>${esc(r.a.folio||'—')}</b></td>
        <td>${esc(r.a.equipo||'—')}</td>
        <td style="max-width:220px">${esc(r.pl.actividad)}</td>
        <td>${esc(r.pl.responsable||'—')}</td>
        <td class="nowrap">${fmtD(r.pl.fecha)}</td>
        <td class="nowrap">${r.transcurrido} día(s)</td>
        <td style="text-align:center;font-size:1.3rem">${r.semaforo}</td>
        <td class="avance-cell">
          <div class="avance-bar"><div class="avance-fill ${r.semCls}" style="width:${Math.min(100,r.pct)}%"></div></div>
          <span class="avance-pct">${r.pct}%</span>
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
    </div>

    <div class="section-head"><h3>2 · Avería</h3></div>
    <p><b>Síntoma:</b> ${esc(a.sintoma||'—')}</p>
    <p><b>Modo de falla:</b> ${esc(a.modoFalla||'—')}</p>
    <p><b>Acción correctiva:</b> ${esc(a.accionCorrectiva||'—')}</p>
    <p><b>Min. perdidos:</b> ${esc(a.minutosPerdidos||'0')} · <b>¿Afectó producción?:</b> ${esc(a.afectoProduccion)}</p>

    <div class="section-head"><h3>3 · Fenómeno (5W+1H)</h3></div>
    <div class="grid-2" style="font-size:.88rem">
      <div><b>¿Qué?</b> ${esc(a.w_que||'—')}</div><div><b>¿Cuándo?</b> ${esc(a.w_cuando||'—')}</div>
      <div><b>¿Dónde?</b> ${esc(a.w_donde||'—')}</div><div><b>¿Quién?</b> ${esc(a.w_quien||'—')}</div>
      <div><b>¿Cuál?</b> ${esc(a.w_cual||'—')}</div><div><b>¿Cómo?</b> ${esc(a.w_como||'—')}</div>
    </div>
    ${a.imagen?`<img class="img-preview" src="${a.imagen}" style="margin-top:10px;max-width:280px">`:''}

    <div class="section-head"><h3>4 · Causas probables ${a.analisis?`<small class="muted">(${esc(a.analisis.modoDetectado)})</small>`:''}</h3></div>
    <div class="causa-list">${(a.analisis?.causas||[]).map((c,i)=>
      `<div class="causa-item ${c.probable?'probable':''}"><span class="c-num">${i+1}</span><span class="c-txt">${esc(c.txt)} ${c.probable?'<b style="color:var(--orange-dk)"> ← más probable</b>':''}</span></div>`).join('')}</div>

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
  concluirPlan, subirImgSeg, verImagenSeg,
  abrirNuevoPlan, abrirPlanMP, guardarPlanMP, eliminarPlanMP,
  agregarActMP, calcProximaAuto, autoFillPlan });
