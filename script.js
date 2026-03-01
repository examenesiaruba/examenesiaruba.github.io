/* ========== script.js ========== */

// Variable global de preguntas — se llena desde Firestore (ya no viene de preguntasiar.js)
if (typeof preguntasPorSeccion === 'undefined') {
  var preguntasPorSeccion = {};
}
/* Requisitos:
   1) Orden de preguntas ALEATORIO al inicio; orden de opciones aleatorio por pregunta.
      - Las preguntas se mezclan al inicio de cada intento
      - Las preguntas respondidas quedan arriba
      - Las preguntas sin responder se mantienen abajo en orden aleatorio
   2) Progreso y selecciones persistentes en localStorage hasta completar el cuestionario.
   3) "Mostrar puntuación total": exige todas respondidas; si faltan, lista cuáles faltan.
   4) Al completar y presionar "Mostrar puntuación total" y luego "Volver al menú principal",
      se limpia el estado para permitir un nuevo intento.
   5) Cada pregunta tiene botón "Responder"; pinta verde/rojo y marca "✅/❌".
   6) Botón flotante "Ver mi progreso" con ventana flotante.
   7) Mantener posición de scroll al regresar al menú principal.
   8) Navegación con botones del navegador (atrás/adelante).
*/

(function () {
  // ======== Claves de almacenamiento ========
  const STORAGE_KEY = "quiz_state_v3";             // Estado persistente por sección (v3 para nueva funcionalidad)
  const ATTEMPT_LOG_KEY = "quiz_attempt_log_v1";   // Historial de intentos
  const SCROLL_POSITION_KEY = "quiz_scroll_position_v1"; // Posición del scroll
  const TIMER_STORAGE_KEY = "simulacro_timer_v1"; // Estado del temporizador del simulacro

  // ======== Estado en memoria (se sincroniza con localStorage) ========
  // Estructura por sección:
  // state[seccionId] = {
  //   shuffleFrozen: false,
  //   shuffleMap: { [qIndex]: { [mixedIndex]: originalIndex } },
  //   questionOrder: [array de índices de preguntas mezclados],
  //   answers: { [qIndex]: [mixedIndicesSeleccionados] },
  //   graded: { [qIndex]: true|false },
  //   totalShown: false,
  //   explanationShown: { [qIndex]: true|false }  // si se mostró la explicación
  // }
  let state = loadJSON(STORAGE_KEY, {});
  let attemptLog = loadJSON(ATTEMPT_LOG_KEY, []);

  // ======== Variables del temporizador del simulacro ========
  let timerInterval = null;
  let timerStartTime = null;
  let timerDuration = 4 * 60 * 60 * 1000; // 4 horas en milisegundos
  let alertasRealizadas = {
    '3h': false,
    '2h': false,
    '1h': false,
    '30min': false,
    '15min': false,
    '5min': false
  };

  // ======== MANEJO DE NAVEGACIÓN DEL NAVEGADOR ========
  let currentSection = null;

  // ======== Utilidades ========
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function cap(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
  }
  function todayISO() {
    return new Date().toISOString();
  }
  function toLocalDateStr(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString();
  }

  // ======== Scroll inteligente: guardar el cuestionario de origen para volver a él ========
  const LAST_SECTION_KEY = "quiz_last_section_v1";

  function saveLastSection(seccionId) {
    localStorage.setItem(LAST_SECTION_KEY, seccionId);
    // También guardar la posición del scroll del menú/submenú actual (como fallback)
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    localStorage.setItem(SCROLL_POSITION_KEY, scrollPosition.toString());
  }

  function scrollToSectionItem(seccionId) {
    if (!seccionId) {
      // Fallback: restaurar posición guardada
      const savedPosition = localStorage.getItem(SCROLL_POSITION_KEY);
      if (savedPosition) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: parseInt(savedPosition, 10), behavior: 'smooth' });
        });
      }
      return;
    }

    // Buscar el <li> que lanza este cuestionario en el menú o submenú visible
    requestAnimationFrame(() => {
      // Esperar un frame extra para que el menú/submenú esté visible
      requestAnimationFrame(() => {
        const allLis = document.querySelectorAll('li[onclick]');
        let targetLi = null;
        for (const li of allLis) {
          const onclick = li.getAttribute('onclick') || '';
          if (onclick.includes(`'${seccionId}'`) || onclick.includes(`"${seccionId}"`)) {
            targetLi = li;
            break;
          }
        }
        if (targetLi) {
          targetLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Resaltar brevemente el ítem
          const originalBg = targetLi.style.backgroundColor;
          const originalTransition = targetLi.style.transition;
          targetLi.style.transition = 'background-color 0.15s ease';
          targetLi.style.backgroundColor = 'rgba(255, 220, 80, 0.55)';
          setTimeout(() => {
            targetLi.style.backgroundColor = originalBg || '';
            setTimeout(() => {
              targetLi.style.transition = originalTransition || '';
            }, 600);
          }, 900);
        } else {
          // Si no se encuentra el li (ej: submenú dentro de submenú), fallback a posición guardada
          const savedPosition = localStorage.getItem(SCROLL_POSITION_KEY);
          if (savedPosition) {
            window.scrollTo({ top: parseInt(savedPosition, 10), behavior: 'smooth' });
          }
        }
        localStorage.removeItem(LAST_SECTION_KEY);
      });
    });
  }

  function saveScrollPosition() {
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    localStorage.setItem(SCROLL_POSITION_KEY, scrollPosition.toString());
  }

  function restoreScrollPosition() {
    const lastSection = localStorage.getItem(LAST_SECTION_KEY);
    scrollToSectionItem(lastSection);
  }

  function clearScrollPosition() {
    localStorage.removeItem(SCROLL_POSITION_KEY);
    localStorage.removeItem(LAST_SECTION_KEY);
  }

  // ======== Función para manejar el historial del navegador ========
  function setupBrowserNavigation() {
    window.addEventListener('popstate', function(event) {
      // Ocultar panel de respuestas si estaba visible
      const _prc2 = document.getElementById('panel-respuestas-correctas');
      if (_prc2 && !_prc2.classList.contains('oculto')) _prc2.classList.add('oculto');
      const _pre3 = document.getElementById('pagina-respuestas-examen');
      if (_pre3) _pre3.classList.remove('activa');

      // Si es un estado de respuestas de examen individual, mostrar submenú
      if (event.state && event.state.respuestasExamen) {
        mostrarRespuestasExamen(event.state.respuestasExamen);
        return;
      }
      // Si es el submenú de respuestas
      if (event.state && event.state.respuestas) {
        mostrarRespuestasCorrectas();
        return;
      }

      // Detectar si veníamos del buscador
      const desdeBuscador = (typeof navegacionOrigen !== 'undefined' && navegacionOrigen === 'buscador') ||
                            (function(){ try { return sessionStorage.getItem('buscador_origen') === '1'; } catch(e){ return false; }})();

      if (event.state && event.state.section) {
        showSection(event.state.section);
      } else if (event.state && event.state.submenu) {
        // Si venimos del buscador, volver al buscador
        if (desdeBuscador) {
          window.volverAlBuscador && window.volverAlBuscador();
          return;
        }
        const submenuId = event.state.submenu;
        const lastSec = localStorage.getItem(LAST_SECTION_KEY);
        currentSection = null;
        document.getElementById("menu-principal")?.classList.add("oculto");
        document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
        document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
        const submenu = document.getElementById(submenuId);
        if (submenu) submenu.style.display = "block";
        scrollToSectionItem(lastSec);
      } else {
        // Si venimos del buscador, volver al buscador
        if (desdeBuscador) {
          window.volverAlBuscador && window.volverAlBuscador();
          return;
        }
        showMenu();
      }
    });
    
    if (window.location.hash === '' || window.location.hash === '#menu') {
      history.replaceState({ section: null }, 'Menú Principal', '#menu');
    }
  }

  function showSection(seccionId) {
    currentSection = seccionId;
    document.getElementById("menu-principal")?.classList.add("oculto");
    const _pb = document.getElementById('buscador-preguntas');
    if (_pb) _pb.classList.add('oculto');
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));

    navBarModo = 'normal';
    renderNavBar();

    const page = document.getElementById(seccionId);
    if (!page) return;
    page.classList.add("activa");
    window.scrollTo(0, 0);

    // Si las preguntas ya están en memoria, generar directamente
    if (preguntasPorSeccion[seccionId]) {
      generarCuestionario(seccionId);
      if (seccionId === 'simulador') {
        const timerState = loadJSON(TIMER_STORAGE_KEY, null);
        if (timerState && timerState.startTime) iniciarTemporizador();
      }
      return;
    }

    // Si no están en memoria, mostrar loading y cargar desde Firestore.
    // firebase-auth.js es type="module" y se ejecuta DESPUÉS de script.js,
    // por eso usamos polling hasta que window.cargarSeccionFirestore esté disponible.
    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (cont) {
      cont.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:#64748b;">
          <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
          <div style="font-size:1rem;font-weight:600;">Cargando cuestionario...</div>
        </div>`;
    }

    function _cargarConFirestore(intentos) {
      if (currentSection !== seccionId) return;
      console.log('[IAR DEBUG] intento=' + intentos + ' cargarSeccionFirestore=' + typeof window.cargarSeccionFirestore + ' seccion=' + seccionId);
      if (window.cargarSeccionFirestore) {
        window.cargarSeccionFirestore(seccionId).then(function(preguntas) {
          console.log('[IAR DEBUG] Firestore respondió. preguntas=' + (preguntas ? preguntas.length : 'null') + ' seccion=' + seccionId);
          if (preguntas) preguntasPorSeccion[seccionId] = preguntas;
          if (currentSection === seccionId) {
            generarCuestionario(seccionId);
            if (seccionId === 'simulador') {
              const timerState = loadJSON(TIMER_STORAGE_KEY, null);
              if (timerState && timerState.startTime) iniciarTemporizador();
            }
          }
        }).catch(function(err) {
          console.error('Error cargando sección:', err);
          if (cont && currentSection === seccionId) {
            cont.innerHTML = `
              <div style="text-align:center;padding:60px 20px;color:#dc2626;">
                <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
                <div style="font-size:1rem;font-weight:600;">Error al cargar el cuestionario.</div>
                <div style="font-size:.88rem;margin-top:8px;">Verificá tu conexión e intentá nuevamente.</div>
              </div>`;
          }
        });
      } else if (intentos < 20) {
        setTimeout(function() { _cargarConFirestore(intentos + 1); }, 200);
      } else {
        console.error('[IAR DEBUG] TIMEOUT: cargarSeccionFirestore nunca estuvo disponible');
        if (cont && currentSection === seccionId) {
          cont.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#dc2626;">
              <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
              <div style="font-size:1rem;font-weight:600;">No se pudo conectar con la base de datos.</div>
              <div style="font-size:.88rem;margin-top:8px;">Recargá la página e intentá nuevamente.</div>
            </div>`;
        }
      }
    }
    _cargarConFirestore(0);
  }

  function showMenu() {
    // Detener el temporizador si estábamos en el simulacro
    if (currentSection === 'simulador') {
      detenerTemporizador();
    }
    
    if (currentSection && preguntasPorSeccion[currentSection]) {
      // Limpiar el estado completamente si se completó el cuestionario
      clearSectionStateIfCompletedAndBack(currentSection);
      
      if (state[currentSection] && !state[currentSection].totalShown) {
        // EXCEPCIÓN: Si es el simulacro y hay progreso, NO limpiar el estado
        if (currentSection === 'simulador') {
          const hasProgress = state[currentSection] && Object.keys(state[currentSection].graded || {}).length > 0;
          if (hasProgress) {
            currentSection = null;
            document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
            document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
            const _pb2 = document.getElementById('buscador-preguntas');
            if (_pb2) _pb2.classList.add('oculto');
            const _bf2 = document.getElementById('btn-volver-buscador');
            if (_bf2) _bf2.style.display = 'none';
            try { localStorage.removeItem('buscador_ultimo_query_v1'); } catch(e) {}
            const _inp2 = document.getElementById('buscador-input');
            if (_inp2) _inp2.value = '';
            const _res2 = document.getElementById('buscador-resultados');
            if (_res2) _res2.innerHTML = '';
            const _st2 = document.getElementById('buscador-stats');
            if (_st2) _st2.style.display = 'none';
            document.getElementById("menu-principal")?.classList.remove("oculto");
            restoreScrollPosition();
            return;
          } else {
            localStorage.removeItem(SIMULACRO_STORAGE_KEY);
          }
        }

        // ¿Hay al menos una pregunta respondida?
        const s = state[currentSection];
        const hayRespuestas = s && s.graded && Object.keys(s.graded).some(k => s.graded[k]);

        // Si hay respuestas: conservar orden de opciones (aleatorizar=false)
        // Si no hay respuestas: aleatorizar opciones de nuevo (aleatorizar=true)
        limpiarSeccion(currentSection, !hayRespuestas);

        console.log(hayRespuestas
          ? '🔒 Volvió con respuestas → opciones conservadas'
          : '🎲 Volvió sin respuestas → opciones aleatorizadas');
      }
    }
    
    currentSection = null;
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));

    // Ocultar panel del buscador y limpiar búsqueda
    const _pb = document.getElementById('buscador-preguntas');
    if (_pb) _pb.classList.add('oculto');
    const _bf = document.getElementById('btn-volver-buscador');
    if (_bf) _bf.style.display = 'none';
    try { sessionStorage.removeItem('buscador_origen'); } catch(e) {}
    try { localStorage.removeItem('buscador_ultimo_query_v1'); } catch(e) {}
    // Limpiar visualmente el buscador
    const _inp = document.getElementById('buscador-input');
    if (_inp) _inp.value = '';
    const _res = document.getElementById('buscador-resultados');
    if (_res) _res.innerHTML = '';
    const _st = document.getElementById('buscador-stats');
    if (_st) _st.style.display = 'none';

    // Mostrar menú principal
    document.getElementById("menu-principal")?.classList.remove("oculto");

    restoreScrollPosition();
  }

  let lastShuffleTemp = {};

  // ======== Helper: limpiar sección con o sin aleatorización de opciones ========
  // aleatorizar=true  → borra shuffleMap → las opciones se re-mezclan al regenerar
  // aleatorizar=false → conserva shuffleMap → las opciones mantienen el orden previo
  function limpiarSeccion(seccionId, aleatorizar) {
    const s = state[seccionId];

    if (aleatorizar) {
      // Borrar completamente → nueva aleatorización de preguntas y opciones al regenerar
      delete state[seccionId];
    } else {
      // Conservar shuffleMap (orden de opciones) y unansweredOrder (orden de preguntas)
      const shuffleMapGuardado = (s && s.shuffleMap)
        ? JSON.parse(JSON.stringify(s.shuffleMap))
        : {};
      const answeredOrderGuardado = s && s.answeredOrder ? s.answeredOrder.slice() : [];
      const unansweredOrderGuardado = s && s.unansweredOrder ? s.unansweredOrder.slice() : [];

      state[seccionId] = {
        shuffleFrozen: true,
        shuffleMap: shuffleMapGuardado,
        answeredOrder: [],
        // Restaurar todas las preguntas al orden no-respondido, preservando su secuencia
        unansweredOrder: [...answeredOrderGuardado, ...unansweredOrderGuardado],
        answers: {},
        graded: {},
        totalShown: false,
        explanationShown: {}
      };
    }

    saveJSON(STORAGE_KEY, state);

    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      window.puntajesPorSeccion[seccionId] = Array(
        (preguntasPorSeccion[seccionId] || []).length
      ).fill(null);
    }

    const resultadoTotal = document.getElementById(`resultado-total-${seccionId}`);
    if (resultadoTotal) {
      resultadoTotal.innerHTML = "";
      resultadoTotal.className = "resultado-final";
    }
  }

  function shuffle(arr, qKey = null) {
    const a = arr.slice();

    let seed = Date.now();
    function random() {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return Math.abs(seed) / 0xFFFFFFFF;
    }

    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }

    if (qKey) {
      const prev = lastShuffleTemp[qKey];
      let attempts = 0;
      while (prev && JSON.stringify(prev) === JSON.stringify(a) && attempts < 10) {
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        attempts++;
      }
      lastShuffleTemp[qKey] = a.slice();
    }

    return a;
  }

  function ensureSectionState(seccionId, preguntasLen) {
    if (!state[seccionId]) {
      console.log('🆕 Inicializando estado para:', seccionId);
      state[seccionId] = {
        shuffleFrozen: false,
        shuffleMap: {},
        answeredOrder: [], // Solo guardamos el orden de las respondidas
        unansweredOrder: [], // Orden aleatorizado de las sin responder (se mantiene durante la sesión)
        answers: {},
        graded: {},
        totalShown: false,
        explanationShown: {}  // tracking de explicaciones mostradas
      };
    }
    
    // Asegurar que exista unansweredOrder si no está (compatibilidad con estados antiguos)
    if (!state[seccionId].unansweredOrder) {
      state[seccionId].unansweredOrder = [];
    }
    
    if (!window.puntajesPorSeccion) window.puntajesPorSeccion = {};
    if (!window.puntajesPorSeccion[seccionId]) {
      window.puntajesPorSeccion[seccionId] = Array(preguntasLen).fill(null);
    }
  }

  function getSectionTitle(seccionId) {
    const page = document.getElementById(seccionId);
    if (!page) return cap(seccionId);
    const h1 = page.querySelector("h1, h2, .titulo-seccion");
    return (h1 && h1.textContent.trim()) || cap(seccionId);
  }

  // Devuelve mapping inverso mezclado -> original y opciones mezcladas
  function getOrBuildShuffleForQuestion(seccionId, qIndex, opciones) {
    const s = state[seccionId];
    if (s.shuffleMap[qIndex]) {
      const inv = s.shuffleMap[qIndex];
      const opcionesMezcladas = [];
      Object.keys(inv).forEach(mixed => {
        const original = inv[mixed];
        opcionesMezcladas[mixed] = opciones[original];
      });
      return { inv, opcionesMezcladas };
    }
    
    const indices = opciones.map((_, i) => i);
    const shuffled = shuffle(indices, seccionId + "-" + qIndex);
    const inv = {};
    shuffled.forEach((origIdx, mixedIdx) => {
      inv[mixedIdx] = origIdx;
    });
    const opcionesMezcladas = shuffled.map(i => opciones[i]);
    return { inv, opcionesMezcladas };
  }

  // Congela el shuffle de las opciones de UNA pregunta específica
  function freezeShuffleForQuestion(seccionId, qIndex) {
    const s = state[seccionId];
    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (!cont) return;

    // Solo congelar esta pregunta específica
    const inputs = cont.querySelectorAll(`input[name="pregunta${seccionId}${qIndex}"]`);
    const inv = {};
    inputs.forEach((input, mixedIdx) => {
      const original = parseInt(input.getAttribute("data-original-index"), 10);
      inv[mixedIdx] = isNaN(original) ? mixedIdx : original;
    });
    s.shuffleMap[qIndex] = inv;
    console.log('🔒 Opciones congeladas para pregunta', qIndex, ':', inv);
    saveJSON(STORAGE_KEY, state);
  }

  // Función legacy mantenida por compatibilidad
  function freezeCurrentShuffle(seccionId) {
    // Ya no congela todas, solo marca como congelado
    const s = state[seccionId];
    s.shuffleFrozen = true;
    saveJSON(STORAGE_KEY, state);
  }

  function clearSectionStateIfCompletedAndBack(seccionId) {
    const s = state[seccionId];
    if (!s) return;
    if (s.totalShown) {
      delete state[seccionId];
      saveJSON(STORAGE_KEY, state);
      if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
        window.puntajesPorSeccion[seccionId] = Array(
          (preguntasPorSeccion[seccionId] || []).length
        ).fill(null);
      }
      const resultadoTotal = document.getElementById(`resultado-total-${seccionId}`);
      if (resultadoTotal) {
        resultadoTotal.textContent = "";
        resultadoTotal.className = "resultado-final";
      }
    }
  }

  // ======== Función para mostrar/ocultar explicación ========
  function mostrarExplicacion(seccionId, qIndex) {
    // Solo permitir ver la explicación si ya se respondió la pregunta
    if (!state[seccionId].graded || !state[seccionId].graded[qIndex]) {
      alert("Debes responder la pregunta primero para ver la explicación.");
      return;
    }

    const explicacionDiv = document.getElementById(`explicacion-${seccionId}-${qIndex}`);
    const btnExplicacion = document.getElementById(`btn-explicacion-${seccionId}-${qIndex}`);
    
    if (explicacionDiv.style.display === "none" || explicacionDiv.style.display === "") {
      // Mostrar explicación
      explicacionDiv.style.display = "block";
      btnExplicacion.textContent = "Ocultar explicación";
      
      // Marcar como mostrada
      if (!state[seccionId].explanationShown) state[seccionId].explanationShown = {};
      state[seccionId].explanationShown[qIndex] = true;
      saveJSON(STORAGE_KEY, state);
    } else {
      // Ocultar explicación
      explicacionDiv.style.display = "none";
      btnExplicacion.textContent = "Ver explicación";
      
      // Marcar como oculta
      state[seccionId].explanationShown[qIndex] = false;
      saveJSON(STORAGE_KEY, state);
    }
  }

  function restoreSelectionsAndGrades(seccionId) {
    const s = state[seccionId];
    if (!s) return;

    const preguntas = preguntasPorSeccion[seccionId] || [];
    preguntas.forEach((preg, idx) => {
      const name = `pregunta${seccionId}${idx}`;
      const inputs = Array.from(document.getElementsByName(name));
      const guardadas = (s.answers && s.answers[idx]) || [];
      guardadas.forEach(mixedIdx => {
        if (inputs[mixedIdx]) inputs[mixedIdx].checked = true;
      });

      if (s.graded && s.graded[idx]) {
        const puntajeElem = document.getElementById(`puntaje-${seccionId}-${idx}`);
        const mInv = state[seccionId].shuffleMap[idx];
        const seleccionOriginal = guardadas.map(i => mInv[i]).sort();
        const correctaOriginal = preg.correcta.slice().sort();

        const isCorrect = JSON.stringify(seleccionOriginal) === JSON.stringify(correctaOriginal);
        if (isCorrect) {
          puntajeElem.textContent = "✅ Correcto (+1)";
        } else {
          puntajeElem.textContent = "❌ Incorrecto (0)";
        }

        const correctasMezcladas = correctaOriginal.map(ori =>
          parseInt(Object.keys(mInv).find(k => mInv[k] === ori), 10)
        );
        correctasMezcladas.forEach(i => {
          if (!isNaN(i) && inputs[i]) {
            inputs[i].parentElement.style.backgroundColor = "#eafaf1";
            inputs[i].parentElement.style.borderColor = "#1e7e34";
          }
        });
        guardadas.forEach(i => {
          const idxOriginal = mInv[i];
          if (!preg.correcta.includes(idxOriginal) && inputs[i]) {
            inputs[i].parentElement.style.backgroundColor = "#fdecea";
            inputs[i].parentElement.style.borderColor = "#c0392b";
          }
        });

        inputs.forEach(inp => (inp.disabled = true));
        const btn = inputs[0]?.closest(".pregunta")?.querySelector("button.btn-responder");
        if (btn) btn.disabled = true;

        if (!window.puntajesPorSeccion[seccionId]) window.puntajesPorSeccion[seccionId] = [];
        window.puntajesPorSeccion[seccionId][idx] = isCorrect ? 1 : 0;
      }

      // Restaurar estado de explicación si estaba mostrada
      if (s.explanationShown && s.explanationShown[idx]) {
        const explicacionDiv = document.getElementById(`explicacion-${seccionId}-${idx}`);
        const btnExplicacion = document.getElementById(`btn-explicacion-${seccionId}-${idx}`);
        if (explicacionDiv && btnExplicacion) {
          explicacionDiv.style.display = "block";
          btnExplicacion.textContent = "Ocultar explicación";
        }
      }
    });
  }

  // ======== FUNCIONES DEL TEMPORIZADOR DEL SIMULACRO ========
  
  function iniciarTemporizador() {
    // Solo iniciar si estamos en el simulacro
    if (currentSection !== 'simulador') return;
    
    // Si ya hay un temporizador corriendo, no iniciar otro
    if (timerInterval) return;
    
    // Cargar estado del temporizador desde localStorage
    const timerState = loadJSON(TIMER_STORAGE_KEY, null);
    
    if (timerState && timerState.startTime) {
      // Recuperar temporizador existente
      timerStartTime = timerState.startTime;
      alertasRealizadas = timerState.alertas || alertasRealizadas;
      console.log('⏰ Temporizador recuperado:', new Date(timerStartTime));
    } else {
      // Iniciar nuevo temporizador
      timerStartTime = Date.now();
      alertasRealizadas = {
        '3h': false,
        '2h': false,
        '1h': false,
        '30min': false,
        '15min': false,
        '5min': false
      };
      saveJSON(TIMER_STORAGE_KEY, {
        startTime: timerStartTime,
        alertas: alertasRealizadas
      });
      console.log('⏰ Temporizador iniciado:', new Date(timerStartTime));
    }
    
    // Crear el elemento del temporizador si no existe
    crearElementoTemporizador();
    
    // Iniciar el intervalo
    timerInterval = setInterval(actualizarTemporizador, 1000);
    actualizarTemporizador(); // Actualizar inmediatamente
  }
  
  function crearElementoTemporizador() {
    // Verificar si ya existe
    if (document.getElementById('timer-simulacro')) return;
    
    const timerDiv = document.createElement('div');
    timerDiv.id = 'timer-simulacro';
    timerDiv.style.position = 'fixed';
    timerDiv.style.top = '20px';
    timerDiv.style.right = '20px';
    timerDiv.style.backgroundColor = 'rgba(13, 116, 144, 0.95)';
    timerDiv.style.color = 'white';
    timerDiv.style.padding = '15px 25px';
    timerDiv.style.borderRadius = '10px';
    timerDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    timerDiv.style.zIndex = '9998';
    timerDiv.style.fontFamily = 'monospace';
    timerDiv.style.fontSize = '1.2rem';
    timerDiv.style.fontWeight = 'bold';
    timerDiv.style.minWidth = '150px';
    timerDiv.style.textAlign = 'center';
    timerDiv.innerHTML = '<div style="font-size: 0.8rem; margin-bottom: 5px;">Tiempo restante</div><div id="timer-display">04:00:00</div>';
    
    document.body.appendChild(timerDiv);
  }
  
  function actualizarTemporizador() {
    if (!timerStartTime || currentSection !== 'simulador') {
      detenerTemporizador();
      return;
    }
    
    const tiempoTranscurrido = Date.now() - timerStartTime;
    const tiempoRestante = Math.max(0, timerDuration - tiempoTranscurrido);
    
    // Actualizar display
    const display = document.getElementById('timer-display');
    if (display) {
      const horas = Math.floor(tiempoRestante / (60 * 60 * 1000));
      const minutos = Math.floor((tiempoRestante % (60 * 60 * 1000)) / (60 * 1000));
      const segundos = Math.floor((tiempoRestante % (60 * 1000)) / 1000);
      
      display.textContent = `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
      
      // Cambiar color según tiempo restante
      const timerDiv = document.getElementById('timer-simulacro');
      if (timerDiv) {
        if (tiempoRestante <= 5 * 60 * 1000) { // Menos de 5 minutos
          timerDiv.style.backgroundColor = 'rgba(220, 38, 38, 0.95)';
        } else if (tiempoRestante <= 15 * 60 * 1000) { // Menos de 15 minutos
          timerDiv.style.backgroundColor = 'rgba(217, 119, 6, 0.95)';
        } else if (tiempoRestante <= 30 * 60 * 1000) { // Menos de 30 minutos
          timerDiv.style.backgroundColor = 'rgba(202, 138, 4, 0.95)';
        }
      }
    }
    
    // Verificar si el tiempo se acabó
    if (tiempoRestante === 0) {
      finalizarPorTiempo();
      return;
    }
    
    // Mostrar alertas
    verificarAlertas(tiempoRestante);
    
    // Guardar estado
    saveJSON(TIMER_STORAGE_KEY, {
      startTime: timerStartTime,
      alertas: alertasRealizadas
    });
  }
  
  function verificarAlertas(tiempoRestante) {
    const alertas = [
      { nombre: '3h', tiempo: 3 * 60 * 60 * 1000, mensaje: '⏰ Quedan 3 horas' },
      { nombre: '2h', tiempo: 2 * 60 * 60 * 1000, mensaje: '⏰ Quedan 2 horas' },
      { nombre: '1h', tiempo: 1 * 60 * 60 * 1000, mensaje: '⏰ Queda 1 hora' },
      { nombre: '30min', tiempo: 30 * 60 * 1000, mensaje: '⚠️ Quedan 30 minutos' },
      { nombre: '15min', tiempo: 15 * 60 * 1000, mensaje: '⚠️ Quedan 15 minutos' },
      { nombre: '5min', tiempo: 5 * 60 * 1000, mensaje: '🚨 ¡Quedan solo 5 minutos!' }
    ];
    
    alertas.forEach(alerta => {
      if (!alertasRealizadas[alerta.nombre] && tiempoRestante <= alerta.tiempo && tiempoRestante > alerta.tiempo - 1000) {
        mostrarAlertaTemporal(alerta.mensaje);
        alertasRealizadas[alerta.nombre] = true;
      }
    });
  }
  
  function mostrarAlertaTemporal(mensaje) {
    // Crear alerta
    const alerta = document.createElement('div');
    alerta.style.position = 'fixed';
    alerta.style.top = '50%';
    alerta.style.left = '50%';
    alerta.style.transform = 'translate(-50%, -50%)';
    alerta.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    alerta.style.color = 'white';
    alerta.style.padding = '20px 40px';
    alerta.style.borderRadius = '10px';
    alerta.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.3)';
    alerta.style.zIndex = '10000';
    alerta.style.fontSize = '1.5rem';
    alerta.style.fontWeight = 'bold';
    alerta.style.textAlign = 'center';
    alerta.style.animation = 'fadeInOut 3s ease-in-out';
    alerta.textContent = mensaje;
    
    // Agregar estilo de animación
    if (!document.getElementById('timer-alert-style')) {
      const style = document.createElement('style');
      style.id = 'timer-alert-style';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          10% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          90% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(alerta);
    
    // Remover después de 3 segundos
    setTimeout(() => {
      if (alerta.parentNode) {
        document.body.removeChild(alerta);
      }
    }, 3000);
  }
  
  function finalizarPorTiempo() {
    detenerTemporizador();
    
    // Mostrar mensaje
    mostrarAlertaTemporal('⏱️ ¡Tiempo agotado!');
    
    // Deshabilitar todas las preguntas no respondidas
    const preguntas = preguntasPorSeccion['simulador'] || [];
    preguntas.forEach((preg, idx) => {
      if (!state['simulador'] || !state['simulador'].graded || !state['simulador'].graded[idx]) {
        const name = `preguntasimulador${idx}`;
        const inputs = Array.from(document.getElementsByName(name));
        inputs.forEach(inp => inp.disabled = true);
        const btn = inputs[0]?.closest(".pregunta")?.querySelector("button.btn-responder");
        if (btn) btn.disabled = true;
      }
    });
    
    // Esperar 3 segundos y luego mostrar puntuación
    setTimeout(() => {
      mostrarPuntuacionTotal('simulador');
    }, 3000);
  }
  
  function detenerTemporizador() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    // Remover elemento del DOM
    const timerDiv = document.getElementById('timer-simulacro');
    if (timerDiv && timerDiv.parentNode) {
      document.body.removeChild(timerDiv);
    }
  }
  
  function reiniciarTemporizador() {
    detenerTemporizador();
    
    // Limpiar estado del temporizador
    localStorage.removeItem(TIMER_STORAGE_KEY);
    timerStartTime = null;
    alertasRealizadas = {
      '3h': false,
      '2h': false,
      '1h': false,
      '30min': false,
      '15min': false,
      '5min': false
    };
    
    console.log('🔄 Temporizador reiniciado');
  }

  // ======== NUEVO: Obtener orden de visualización (respondidas arriba EN ORDEN, no respondidas abajo PERSISTENTES) ========
  function getDisplayOrder(seccionId, preguntasLen) {
    const s = state[seccionId];
    
    // Inicializar answeredOrder si no existe
    if (!s.answeredOrder) {
      s.answeredOrder = [];
    }
    
    // NUEVO: Verificar si es un cuestionario IAR (mantener orden fijo de preguntas)
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    
    // NUEVO: Verificar si es el simulacro (mantener orden estático)
    const esSimulacro = seccionId === 'simulador';
    
    console.log('🔍 DEBUG - answeredOrder (fijas):', s.answeredOrder);
    console.log('🔍 DEBUG - graded:', s.graded);
    console.log('🔍 DEBUG - esIAR:', esIAR);
    console.log('🔍 DEBUG - esSimulacro:', esSimulacro);
    
    // Si es IAR o Simulacro: ORDEN SECUENCIAL FIJO (0, 1, 2, 3, ...) - Las preguntas NO se mueven
    if (esIAR || esSimulacro) {
      const ordenSecuencial = [];
      for (let i = 0; i < preguntasLen; i++) {
        ordenSecuencial.push(i);
      }
      if (esSimulacro) {
        console.log('✅ SIMULACRO - Orden secuencial FIJO (no se mueven preguntas):', ordenSecuencial);
      } else {
        console.log('✅ IAR - Orden secuencial FIJO (no se mueven preguntas):', ordenSecuencial);
      }
      return ordenSecuencial;
    }
    
    // Para cuestionarios NO-IAR y NO-Simulacro: comportamiento original (respondidas arriba, no respondidas abajo)
    // Las respondidas mantienen su orden (el orden en que fueron respondidas)
    const answered = s.answeredOrder.slice(); // Copia del orden guardado
    
    // Las NO respondidas: obtener las que faltan
    const unanswered = [];
    for (let i = 0; i < preguntasLen; i++) {
      if (!s.graded[i]) {
        unanswered.push(i);
      }
    }
    
    // Para otros cuestionarios: comportamiento original (aleatorizar preguntas)
    let shuffledUnanswered;
    if (s.unansweredOrder.length === 0 || 
        !unanswered.every(idx => s.unansweredOrder.includes(idx))) {
      // Aleatorizar por primera vez
      shuffledUnanswered = shuffle(unanswered, seccionId + "-unanswered-initial");
      s.unansweredOrder = shuffledUnanswered.slice(); // Guardar para mantener durante la sesión
      saveJSON(STORAGE_KEY, state);
      console.log('🎲 NUEVO orden aleatorio generado:', shuffledUnanswered);
    } else {
      // Usar el orden guardado, filtrando las que ya fueron respondidas
      shuffledUnanswered = s.unansweredOrder.filter(idx => !s.graded[idx]);
      console.log('✅ Usando orden existente (sin re-aleatorizar):', shuffledUnanswered);
    }
    
    console.log('✅ DEBUG - answered (orden fijo):', answered);
    console.log('📋 DEBUG - unanswered (orden final):', shuffledUnanswered);
    
    // Concatenar: respondidas primero (orden fijo), luego no respondidas (orden persistente)
    return [...answered, ...shuffledUnanswered];
  }

  // ======== Render del cuestionario ========
  function generarCuestionario(seccionId) {
    const preguntas = preguntasPorSeccion[seccionId];
    if (!preguntas) return;

    ensureSectionState(seccionId, preguntas.length);

    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (!cont) return;
    cont.innerHTML = "";

    // Obtener orden de visualización (respondidas arriba fijas, no respondidas abajo aleatorias)
    const displayOrder = getDisplayOrder(seccionId, preguntas.length);

    // Renderizar preguntas según el orden de visualización
    displayOrder.forEach((originalIdx, displayPosition) => {
      const preg = preguntas[originalIdx];
      const div = document.createElement("div");
      div.className = "pregunta";
      div.id = `pregunta-bloque-${seccionId}-${originalIdx}`;

      // Cabecera resultado
      const resultado = document.createElement("div");
      resultado.id = `puntaje-${seccionId}-${originalIdx}`;
      resultado.className = "resultado-pregunta";
      resultado.textContent = "";
      div.appendChild(resultado);

      // Enunciado (mostramos el número de posición visual, no el índice original)
      const h3 = document.createElement("h3");
      h3.textContent = `${displayPosition + 1}. ${preg.pregunta}`;
      div.appendChild(h3);


// ========== CÓDIGO NUEVO - AGREGAR DESPUÉS DEL h3 ==========
      // Mostrar imagen si existe
      if (preg.imagen) {
        const imgContainer = document.createElement("div");
        imgContainer.style.marginTop = "15px";
        imgContainer.style.marginBottom = "15px";
        imgContainer.style.textAlign = "center";
        
        const img = document.createElement("img");
        img.src = preg.imagen;
        img.alt = "Imagen ECG";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.style.border = "2px solid #ddd";
        img.style.borderRadius = "8px";
        img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
        
        // Hacer clic en la imagen para verla más grande
        img.style.cursor = "pointer";
        img.onclick = function() {
          window.open(this.src, '_blank');
        };
        
        imgContainer.appendChild(img);
        div.appendChild(imgContainer);
      }
      // ========== FIN DEL CÓDIGO NUEVO ==========

      // Opciones (mezcladas)
      const tipoInput = preg.multiple ? "checkbox" : "radio";
      const { inv, opcionesMezcladas } = getOrBuildShuffleForQuestion(
        seccionId,
        originalIdx,
        preg.opciones
      );

      opcionesMezcladas.forEach((opc, mixedIdx) => {
        const label = document.createElement("label");
        label.className = "opcion";
        const input = document.createElement("input");
        input.type = tipoInput;
        input.name = `pregunta${seccionId}${originalIdx}`;
        input.value = mixedIdx;
        input.setAttribute("data-original-index", inv[mixedIdx]);
        
        input.addEventListener("change", () => {
          // Al cambiar una opción, congelar las opciones de ESTA pregunta
          if (!state[seccionId].shuffleMap[originalIdx]) {
            freezeShuffleForQuestion(seccionId, originalIdx);
          }
          persistSelectionsForQuestion(seccionId, originalIdx);
        });
        
        label.appendChild(input);
        label.appendChild(document.createTextNode(" " + opc));
        div.appendChild(label);
      });

      // Contenedor de botones
      const botonesDiv = document.createElement("div");
      botonesDiv.style.marginTop = "10px";
      botonesDiv.style.display = "flex";
      botonesDiv.style.gap = "10px";
      botonesDiv.style.flexWrap = "wrap";

      // Botón Responder
      const btn = document.createElement("button");
      btn.textContent = "Responder";
      btn.className = "btn-responder";
      btn.addEventListener("click", () => responderPregunta(seccionId, originalIdx));
      botonesDiv.appendChild(btn);

      // Botón Ver Explicación (solo si hay explicación)
      if (preg.explicacion && preg.explicacion.trim() !== "") {
        const btnExplicacion = document.createElement("button");
        btnExplicacion.textContent = "Ver explicación";
        btnExplicacion.className = "btn-explicacion";
        btnExplicacion.id = `btn-explicacion-${seccionId}-${originalIdx}`;
        btnExplicacion.addEventListener("click", () => mostrarExplicacion(seccionId, originalIdx));
        botonesDiv.appendChild(btnExplicacion);
      }

      div.appendChild(botonesDiv);

      // Div para la explicación (oculto por defecto)
      if (preg.explicacion && preg.explicacion.trim() !== "") {
        const explicacionDiv = document.createElement("div");
        explicacionDiv.id = `explicacion-${seccionId}-${originalIdx}`;
        explicacionDiv.className = "explicacion-contenedor";
        explicacionDiv.style.display = "none";
        explicacionDiv.style.marginTop = "15px";
        explicacionDiv.style.padding = "15px";
        explicacionDiv.style.backgroundColor = "#f8f9fa";
        explicacionDiv.style.borderLeft = "4px solid #007bff";
        explicacionDiv.style.borderRadius = "4px";
        
        const explicacionTitulo = document.createElement("strong");
        explicacionTitulo.textContent = "Explicación:";
        explicacionTitulo.style.display = "block";
        explicacionTitulo.style.marginBottom = "8px";
        explicacionTitulo.style.color = "#007bff";
        
        const explicacionTexto = document.createElement("p");
        explicacionTexto.textContent = preg.explicacion;
        explicacionTexto.style.margin = "0";
        explicacionTexto.style.lineHeight = "1.6";
        
        explicacionDiv.appendChild(explicacionTitulo);
        explicacionDiv.appendChild(explicacionTexto);

        // Imagen de explicación (solo visible al abrir la explicación)
        if (preg.imagen_explicacion) {
          const imgExp = document.createElement("img");
          imgExp.src = preg.imagen_explicacion;
          imgExp.alt = "Imagen de la explicación";
          imgExp.style.maxWidth = "100%";
          imgExp.style.height = "auto";
          imgExp.style.marginTop = "12px";
          imgExp.style.border = "2px solid #ddd";
          imgExp.style.borderRadius = "8px";
          imgExp.style.display = "block";
          imgExp.style.cursor = "pointer";
          imgExp.title = "Clic para ampliar";
          imgExp.onclick = function() { window.open(this.src, '_blank'); };
          explicacionDiv.appendChild(imgExp);
        }

        div.appendChild(explicacionDiv);
      }

      cont.appendChild(div);
    });

    // Conectar botón "Mostrar puntuación total"
    const btnTotal = document.getElementById(`mostrar-total-${seccionId}`);
    if (btnTotal) btnTotal.onclick = () => mostrarPuntuacionTotal(seccionId);

    // Restaurar estado previo (selecciones y preguntas evaluadas)
    restoreSelectionsAndGrades(seccionId);
  }

  function persistSelectionsForQuestion(seccionId, qIndex) {
    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));
    const seleccionadas = inputs
      .map((inp, i) => (inp.checked ? i : null))
      .filter(v => v !== null);

    if (!state[seccionId].answers) state[seccionId].answers = {};
    state[seccionId].answers[qIndex] = seleccionadas;
    saveJSON(STORAGE_KEY, state);
  }

  function responderPregunta(seccionId, qIndex) {
    const preguntas = preguntasPorSeccion[seccionId];
    const preg = preguntas[qIndex];

    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));

    const seleccionMixed = inputs
      .map((inp, i) => (inp.checked ? i : null))
      .filter(v => v !== null);

    if (seleccionMixed.length === 0) {
      alert("Por favor, selecciona al menos una opción antes de responder.");
      return;
    }

    // NUEVO: Si es el simulacro y es la primera respuesta, iniciar el temporizador
    if (seccionId === 'simulador' && !timerInterval) {
      const s = state[seccionId];
      const preguntasRespondidas = s && s.graded ? Object.keys(s.graded).filter(k => s.graded[k]).length : 0;
      if (preguntasRespondidas === 0) {
        console.log('⏰ Iniciando temporizador del simulacro');
        iniciarTemporizador();
      }
    }

    // Congelar las opciones de ESTA pregunta específica (si no está ya congelada)
    if (!state[seccionId].shuffleMap[qIndex]) {
      freezeShuffleForQuestion(seccionId, qIndex);
    }
    const mInv = state[seccionId].shuffleMap[qIndex];

    const seleccionOriginal = seleccionMixed.map(i => mInv[i]).sort();
    const correctaOriginal = preg.correcta.slice().sort();
    const isCorrect = JSON.stringify(seleccionOriginal) === JSON.stringify(correctaOriginal);

    const puntajeElem = document.getElementById(`puntaje-${seccionId}-${qIndex}`);
    if (isCorrect) {
      window.puntajesPorSeccion[seccionId][qIndex] = 1;
      puntajeElem.textContent = "✅ Correcto (+1)";
    } else {
      window.puntajesPorSeccion[seccionId][qIndex] = 0;
      puntajeElem.textContent = "❌ Incorrecto (0)";
    }

    const correctasMezcladas = correctaOriginal.map(ori =>
      parseInt(Object.keys(mInv).find(k => mInv[k] === ori), 10)
    );
    correctasMezcladas.forEach(i => {
      if (!isNaN(i) && inputs[i]) {
        inputs[i].parentElement.style.backgroundColor = "#eafaf1";
        inputs[i].parentElement.style.borderColor = "#1e7e34";
      }
    });
    seleccionMixed.forEach(i => {
      const ori = mInv[i];
      if (!preg.correcta.includes(ori) && inputs[i]) {
        inputs[i].parentElement.style.backgroundColor = "#fdecea";
        inputs[i].parentElement.style.borderColor = "#c0392b";
      }
    });

    inputs.forEach(inp => (inp.disabled = true));
    const btn = inputs[0]?.closest(".pregunta")?.querySelector("button.btn-responder");
    if (btn) btn.disabled = true;

    persistSelectionsForQuestion(seccionId, qIndex);
    state[seccionId].graded[qIndex] = true;
    
    // IMPORTANTE: Solo para cuestionarios NO-IAR y NO-Simulacro, agregar a answeredOrder
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    const esSimulacro = seccionId === 'simulador';
    
    if (!esIAR && !esSimulacro) {
      // Para cuestionarios normales: agregar esta pregunta al orden de respondidas (si no está ya)
      if (!state[seccionId].answeredOrder) {
        state[seccionId].answeredOrder = [];
      }
      if (!state[seccionId].answeredOrder.includes(qIndex)) {
        state[seccionId].answeredOrder.push(qIndex);
        console.log('📌 Pregunta', qIndex, 'agregada a answeredOrder:', state[seccionId].answeredOrder);
      }
      
      // Eliminar de unansweredOrder
      if (state[seccionId].unansweredOrder) {
        const indexInUnanswered = state[seccionId].unansweredOrder.indexOf(qIndex);
        if (indexInUnanswered !== -1) {
          state[seccionId].unansweredOrder.splice(indexInUnanswered, 1);
          console.log('🗑️ Pregunta', qIndex, 'eliminada de unansweredOrder:', state[seccionId].unansweredOrder);
        }
      }
    } else if (esSimulacro) {
      console.log('✅ SIMULACRO - Pregunta', qIndex, 'respondida sin cambiar orden de visualización');
    } else {
      console.log('✅ IAR - Pregunta', qIndex, 'respondida sin cambiar orden de visualización');
    }
    
    // Guardar el estado completo
    saveJSON(STORAGE_KEY, state);
    console.log('💾 Estado guardado');
    
    // Re-renderizar solo si NO es IAR ni Simulacro (para reorganizar preguntas respondidas arriba)
    if (!esIAR && !esSimulacro) {
      generarCuestionario(seccionId);
    }

    // ===== Verificar si se respondió la ÚLTIMA pregunta y mostrar puntuación automáticamente =====
    const todasRespondidas = preguntas.every((_, idx) => 
      window.puntajesPorSeccion[seccionId]?.[idx] !== null && 
      window.puntajesPorSeccion[seccionId]?.[idx] !== undefined
    );
    if (todasRespondidas && !state[seccionId]?.totalShown) {
      // Pequeño delay para que el DOM se actualice primero
      setTimeout(() => mostrarResultadoFinal(seccionId), 300);
    }
  }

  // ======== Frases motivacionales por rango de porcentaje ========
  function getFraseMotivacional(score, total) {
    const pct = total > 0 ? (score / total) * 100 : 0;
    if (pct === 100) {
      return "🏆 ¡Perfecto! Dominás cada concepto con maestría. Sos exactamente el médico que el sistema necesita.";
    } else if (pct >= 91) {
      return "🌟 ¡Excelente resultado! Estás muy cerca de la cima. Un pequeño ajuste más y alcanzarás la perfección.";
    } else if (pct >= 81) {
      return "💪 ¡Muy bien! Tu preparación es sólida. Revisá los errores con calma y vas a llegar más alto todavía.";
    } else if (pct >= 71) {
      return "📈 ¡Buen trabajo! Tenés una base firme. Con constancia y repaso vas a seguir creciendo rápidamente.";
    } else if (pct >= 61) {
      return "🔍 Vas por buen camino. Cada error es una oportunidad de aprendizaje. ¡Seguí adelante con determinación!";
    } else if (pct >= 51) {
      return "🌱 Estás en la mitad del camino. La medicina se aprende paso a paso. ¡Tu esfuerzo de hoy es tu éxito de mañana!";
    } else if (pct >= 41) {
      return "🔥 No te rindas. Los mejores médicos también tuvieron momentos difíciles. Cada intento te hace más fuerte.";
    } else if (pct >= 31) {
      return "💡 Este resultado te muestra exactamente dónde enfocar tu energía. ¡Esa claridad es un regalo valioso!";
    } else if (pct >= 21) {
      return "❤️ El comienzo siempre es el más duro. Lo importante no es dónde empezás, sino la decisión de seguir intentándolo.";
    } else {
      return "🌅 Cada experto fue alguna vez un principiante. Hoy es solo el inicio de tu transformación. ¡Volvé a intentarlo con confianza!";
    }
  }

  // ======== Mostrar resultado final con frase motivacional ========
  function mostrarResultadoFinal(seccionId) {
    const preguntas = preguntasPorSeccion[seccionId] || [];
    const resultNode = document.getElementById(`resultado-total-${seccionId}`);
    if (!resultNode) return;

    const totalScore = window.puntajesPorSeccion[seccionId].reduce((a, b) => a + (b || 0), 0);
    const frase = getFraseMotivacional(totalScore, preguntas.length);

    resultNode.className = "resultado-final";
    resultNode.innerHTML = `
      <div style="font-size:1.3rem;font-weight:bold;margin-bottom:8px;">
        Puntuación total: ${totalScore} / ${preguntas.length}
      </div>
      <div style="font-size:1rem;margin-top:6px;padding:10px 14px;background:#f0f8ff;border-left:4px solid #0d7490;border-radius:6px;line-height:1.5;color:#1a1a2e;">
        ${frase}
      </div>`;

    state[seccionId].totalShown = true;
    saveJSON(STORAGE_KEY, state);

    // ======= AUTO-CHECKMARK: marcar el ☑ en el submenú al completar =======
    (function autoMarcarCompletado(sid) {
      var USER_KEY = 'iar_user_id_v1';
      var COMPLETED_KEY_PREFIX = 'iar_completed_v1_';
      try {
        var uid = localStorage.getItem(USER_KEY);
        if (!uid) return;
        var completedKey = COMPLETED_KEY_PREFIX + uid;
        var completed = {};
        try { completed = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e) {}
        if (!completed[sid]) {
          completed[sid] = true;
          localStorage.setItem(completedKey, JSON.stringify(completed));
          // Actualizar UI del checkbox si está visible
          var allLis = document.querySelectorAll('li[onclick]');
          allLis.forEach(function(li) {
            var m = li.getAttribute('onclick').match(/mostrarCuestionario\('([^']+)'\)/);
            if (m && m[1] === sid) {
              li.classList.add('iar-completado');
              var inp = li.querySelector('.iar-check-input');
              if (inp) {
                inp.checked = true;
                var icon = li.querySelector('.iar-check-icon');
                if (icon) icon.title = 'Completado — clic para desmarcar';
              }
              // Actualizar también los botones de la barra inferior
              document.querySelectorAll('.nav-bar-btn[data-seccion="' + sid + '"]').forEach(function(btn) {
                btn.classList.add('nav-bar-btn-completado');
              });
            }
          });
        }
      } catch(e) {}
    })(seccionId);
    // ======= FIN AUTO-CHECKMARK =======

    attemptLog.push({
      sectionId: seccionId,
      sectionTitle: getSectionTitle(seccionId),
      iso: todayISO(),
      score: totalScore,
      total: preguntas.length
    });
    saveJSON(ATTEMPT_LOG_KEY, attemptLog);

    // Scroll suave hacia el resultado
    resultNode.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Actualizar colores de la barra de navegación inferior
    if (typeof renderNavBar === 'function') renderNavBar();
  }

  function mostrarPuntuacionTotal(seccionId) {
    const preguntas = preguntasPorSeccion[seccionId] || [];
    const resultNode = document.getElementById(`resultado-total-${seccionId}`);
    if (!resultNode) return;

    // Verificar si hay preguntas sin responder
    const faltan = preguntas
      .map((_, idx) => (window.puntajesPorSeccion[seccionId]?.[idx] === null ? idx + 1 : null))
      .filter(v => v !== null);

    if (faltan.length > 0) {
      // Solo mostrar advertencia, NO mostrar puntuación
      resultNode.className = "mensaje-error";
      resultNode.textContent =
        faltan.length === 1
          ? `Falta responder la pregunta ${faltan[0]}`
          : `Faltan responder las preguntas ${faltan.join(", ")}`;
      return;
    }

    // Todas respondidas: mostrar resultado final (si no estaba ya mostrado)
    if (!state[seccionId]?.totalShown) {
      mostrarResultadoFinal(seccionId);
    }
    // Si ya está mostrado, el botón no hace nada (el resultado ya está visible)
  }

  // ======== Reiniciar Examen ========
  window.reiniciarExamen = function(seccionId) {
    const s = state[seccionId];
    const hayRespuestas = s && s.graded && Object.keys(s.graded).some(k => s.graded[k]);
    const esIAR = seccionId.startsWith('iar') && seccionId !== 'simulacro_iar';

    const msg = hayRespuestas
      ? (esIAR
          ? "Se reiniciará el examen IAR. Las opciones de cada pregunta se presentarán en un nuevo orden aleatorio. ¿Continuás?"
          : "Se reiniciará el examen con un nuevo orden aleatorio de opciones. Se borrarán todas tus respuestas y la puntuación. ¿Continuás?")
      : (esIAR
          ? "Se reiniciará el examen IAR. Las preguntas se presentarán en el orden original y las opciones en un nuevo orden aleatorio. ¿Continuás?"
          : "Se reiniciará el examen con un nuevo orden aleatorio de opciones. ¿Continuás?");

    if (!confirm(msg)) return;

    // Siempre aleatorizar opciones al reiniciar (aleatorizar=true)
    // Para IAR conservamos el orden de PREGUNTAS pero aleatorizamos las OPCIONES
    if (esIAR) {
      // Borrar solo shuffleMap para aleatorizar opciones, pero mantener estructura IAR
      const answeredOrderGuardado = s && s.answeredOrder ? s.answeredOrder.slice() : [];
      const unansweredOrderGuardado = s && s.unansweredOrder ? s.unansweredOrder.slice() : [];
      state[seccionId] = {
        shuffleFrozen: false,
        shuffleMap: {},          // vacío = se re-mezclará al regenerar
        answeredOrder: [],
        unansweredOrder: [...answeredOrderGuardado, ...unansweredOrderGuardado],
        answers: {},
        graded: {},
        totalShown: false,
        explanationShown: {}
      };
      saveJSON(STORAGE_KEY, state);
      if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
        window.puntajesPorSeccion[seccionId] = Array(
          (preguntasPorSeccion[seccionId] || []).length
        ).fill(null);
      }
      const resultadoTotal = document.getElementById(`resultado-total-${seccionId}`);
      if (resultadoTotal) { resultadoTotal.innerHTML = ""; resultadoTotal.className = "resultado-final"; }
    } else {
      // Para no-IAR: limpiar todo y aleatorizar todo (preguntas + opciones)
      limpiarSeccion(seccionId, true);
    }

    generarCuestionario(seccionId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function hasAnySelection(seccionId, qIndex) {
    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));
    return inputs.some(inp => inp.checked);
  }

  // ======== Exponer showSection globalmente para el buscador ========
  window.showSection = showSection;

  // Variable para rastrear el origen de navegación hacia un cuestionario
  let navegacionOrigen = null; // 'buscador' | 'submenu' | null

  // ======== Navegación (mostrar/ocultar páginas) ========
  window.mostrarCuestionario = function (seccionId) {
    // Cuando se llama desde el menú/submenú, el origen es 'submenu'
    navegacionOrigen = 'submenu';
    saveScrollPosition();
    saveLastSection(seccionId);  // Guardar para volver al ítem correcto al regresar
    history.pushState({ section: seccionId, origen: 'submenu' }, `Cuestionario ${seccionId}`, `#${seccionId}`);
    showSection(seccionId);
  };

  window.mostrarSubmenu = function (submenuId) {
    saveScrollPosition();
    saveLastSection(submenuId);  // Al volver al menú principal, resaltar el ítem del submenú
    // Ocultar el menú principal
    document.getElementById("menu-principal")?.classList.add("oculto");
    // Ocultar todos los submenús y cuestionarios
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
    // Mostrar el submenú específico
    const submenu = document.getElementById(submenuId);
    if (submenu) {
      submenu.style.display = "block";
    }
    // Modo normal para la barra inferior del submenú
    navBarModo = 'normal';
    renderNavBar();
    // Agregar al historial del navegador para que "atrás" vuelva al menú principal
    history.pushState({ submenu: submenuId }, submenuId, `#${submenuId}`);
    window.scrollTo(0, 0);
  };

  window.volverAlSubmenu = function(submenuId) {
    // Si el origen fue el buscador, volver al buscador en lugar del submenú
    const esBuscador = (typeof navegacionOrigen !== 'undefined' && navegacionOrigen === 'buscador') ||
                       (function(){ try { return sessionStorage.getItem('buscador_origen') === '1'; } catch(e){ return false; }})();
    if (esBuscador) {
      window.volverAlBuscador && window.volverAlBuscador();
      return;
    }

    if (currentSection && state[currentSection] && state[currentSection].totalShown) {
      // Cuestionario completado: limpiar todo
      limpiarSeccion(currentSection, true);
    } else if (currentSection && state[currentSection] && !state[currentSection].totalShown) {
      // Cuestionario incompleto: revisar si hay respuestas
      const s = state[currentSection];
      const hayRespuestas = s && s.graded && Object.keys(s.graded).some(k => s.graded[k]);
      // Si hay respuestas: conservar opciones. Si no: aleatorizar opciones.
      limpiarSeccion(currentSection, !hayRespuestas);
      console.log(hayRespuestas
        ? '🔒 Volvió al submenú con respuestas → opciones conservadas'
        : '🎲 Volvió al submenú sin respuestas → opciones aleatorizadas');
    }

    const seccionOrigen = currentSection;
    currentSection = null;
    navegacionOrigen = null;
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));

    // Mostrar el submenú sin resetear el scroll
    document.getElementById("menu-principal")?.classList.add("oculto");
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    const submenu = document.getElementById(submenuId);
    if (submenu) submenu.style.display = "block";
    history.pushState({ submenu: submenuId }, submenuId, `#${submenuId}`);

    // Esperar que el submenú esté completamente visible antes de hacer scroll
    setTimeout(() => scrollToSectionItem(seccionOrigen), 50);
  };

  window.volverAlMenu = function () {
    if (currentSection !== null) {
      history.pushState({ section: null }, 'Menú Principal', '#menu');
    }
    // Ocultar todos los submenús
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    // Ocultar panel de respuestas correctas
    const _prc = document.getElementById('panel-respuestas-correctas');
    if (_prc) _prc.classList.add('oculto');
    const _pre2 = document.getElementById('pagina-respuestas-examen');
    if (_pre2) _pre2.classList.remove('activa');

    // Restaurar modo normal de la barra inferior
    navBarModo = 'normal';
    showMenu();
  };

  // ======== VER RESPUESTAS CORRECTAS ========
  const EXAMENES_IAR_ORDEN = [
    { id: 'iarsep2020', label: 'SEP 2020' }, { id: 'iaroct2020', label: 'OCT 2020' },
    { id: 'iarnov2020', label: 'NOV 2020' }, { id: 'iardic2020', label: 'DIC 2020' },
    { id: 'iarfeb2021', label: 'FEB 2021' }, { id: 'iarmar2021', label: 'MAR 2021' },
    { id: 'iarabr2021', label: 'ABR 2021' }, { id: 'iarmay2021', label: 'MAY 2021' },
    { id: 'iarjun2021', label: 'JUN 2021' }, { id: 'iarago2021', label: 'AGO 2021' },
    { id: 'iarsep2021', label: 'SEP 2021' }, { id: 'iarnov2021', label: 'NOV 2021' },
    { id: 'iardic2021', label: 'DIC 2021' },
    { id: 'iarmar2022', label: 'MAR 2022' }, { id: 'iarabr2022', label: 'ABR 2022' },
    { id: 'iarjun2022', label: 'JUN 2022' }, { id: 'iarago2022', label: 'AGO 2022' },
    { id: 'iaroct2022', label: 'OCT 2022' }, { id: 'iardic2022', label: 'DIC 2022' },
    { id: 'iarmar2023', label: 'MAR 2023' }, { id: 'iarabr2023', label: 'ABR 2023' },
    { id: 'iarmay2023', label: 'MAY 2023' }, { id: 'iarjun2023', label: 'JUN 2023' },
    { id: 'iarago2023', label: 'AGO 2023' }, { id: 'iaroct2023', label: 'OCT 2023' },
    { id: 'iardic2023', label: 'DIC 2023' },
    { id: 'iarfeb2024', label: 'FEB 2024' }, { id: 'iarmar2024', label: 'MAR 2024' },
    { id: 'iarabr2024', label: 'ABR 2024' }, { id: 'iarmay2024', label: 'MAY 2024' },
    { id: 'iarjun2024', label: 'JUN 2024' }, { id: 'iarago2024', label: 'AGO 2024' },
    { id: 'iarsep2024', label: 'SEP 2024' }, { id: 'iaroct2024', label: 'OCT 2024' },
    { id: 'iarnov2024', label: 'NOV 2024' }, { id: 'iardic2024', label: 'DIC 2024' },
    { id: 'iarfeb2025', label: 'FEB 2025' }, { id: 'iarmar2025', label: 'MAR 2025' },
    { id: 'iarabr2025', label: 'ABR 2025' }, { id: 'iarmay2025', label: 'MAY 2025' },
    { id: 'iarjun2025', label: 'JUN 2025' }, { id: 'iarago2025', label: 'AGO 2025' },
    { id: 'iarsep2025', label: 'SEP 2025' }, { id: 'iaroct2025', label: 'OCT 2025' },
    { id: 'iarnov2025', label: 'NOV 2025' }, { id: 'iardic2025', label: 'DIC 2025' },
  ];

  window.mostrarRespuestasCorrectas = function() {
    // Ocultar todo lo demás
    document.getElementById('menu-principal')?.classList.add('oculto');
    document.querySelectorAll('.menu-principal[id$="-submenu"]').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.pagina-cuestionario').forEach(p => p.classList.remove('activa'));
    const _pb = document.getElementById('buscador-preguntas');
    if (_pb) _pb.classList.add('oculto');
    const _pre = document.getElementById('pagina-respuestas-examen');
    if (_pre) _pre.classList.remove('activa');

    const panel = document.getElementById('panel-respuestas-correctas');
    if (!panel) return;
    panel.classList.remove('oculto');

    // Modo respuestas para la barra inferior
    navBarModo = 'respuestas';
    renderNavBar();

    history.pushState({ respuestas: true }, 'Respuestas Correctas', '#respuestas');
    window.scrollTo(0, 0);
  };

  window.mostrarRespuestasExamen = function(seccionId) {
    // Ocultar submenú de respuestas
    const panel = document.getElementById('panel-respuestas-correctas');
    if (panel) panel.classList.add('oculto');

    // Ocultar otras páginas
    document.querySelectorAll('.pagina-cuestionario').forEach(p => p.classList.remove('activa'));

    // Modo respuestas para la barra inferior
    navBarModo = 'respuestas';
    renderNavBar();

    // Preparar página individual
    const pagina = document.getElementById('pagina-respuestas-examen');
    if (!pagina) return;

    // Título
    const NOMBRES = {
      iarsep2020:'SEP 2020',iaroct2020:'OCT 2020',iarnov2020:'NOV 2020',iardic2020:'DIC 2020',
      iarfeb2021:'FEB 2021',iarmar2021:'MAR 2021',iarabr2021:'ABR 2021',iarmay2021:'MAY 2021',
      iarjun2021:'JUN 2021',iarago2021:'AGO 2021',iarsep2021:'SEP 2021',iarnov2021:'NOV 2021',iardic2021:'DIC 2021',
      iarmar2022:'MAR 2022',iarabr2022:'ABR 2022',iarjun2022:'JUN 2022',iarago2022:'AGO 2022',
      iaroct2022:'OCT 2022',iardic2022:'DIC 2022',
      iarmar2023:'MAR 2023',iarabr2023:'ABR 2023',iarmay2023:'MAY 2023',iarjun2023:'JUN 2023',
      iarago2023:'AGO 2023',iaroct2023:'OCT 2023',iardic2023:'DIC 2023',
      iarfeb2024:'FEB 2024',iarmar2024:'MAR 2024',iarabr2024:'ABR 2024',iarmay2024:'MAY 2024',
      iarjun2024:'JUN 2024',iarago2024:'AGO 2024',iarsep2024:'SEP 2024',iaroct2024:'OCT 2024',
      iarnov2024:'NOV 2024',iardic2024:'DIC 2024',
      iarfeb2025:'FEB 2025',iarmar2025:'MAR 2025',iarabr2025:'ABR 2025',iarmay2025:'MAY 2025',
      iarjun2025:'JUN 2025',iarago2025:'AGO 2025',iarsep2025:'SEP 2025',iaroct2025:'OCT 2025',
      iarnov2025:'NOV 2025',iardic2025:'DIC 2025'
    };

    const titulo = document.getElementById('titulo-respuestas-examen');
    if (titulo) titulo.textContent = '📋 RESPUESTAS CORRECTAS — IAR ' + (NOMBRES[seccionId] || seccionId.toUpperCase());

    // Renderizar contenido
    const cont = document.getElementById('contenido-respuestas-examen');
    if (cont) {
      // Solo re-renderizar si cambió el examen
      if (cont.dataset.seccion !== seccionId) {
        _renderRespuestasExamen(cont, seccionId);
        cont.dataset.seccion = seccionId;
      }
    }

    pagina.classList.add('activa');
    history.pushState({ respuestasExamen: seccionId }, 'Respuestas ' + seccionId, '#respuestas-' + seccionId);
    window.scrollTo(0, 0);
  };

  window.volverAlSubmenuRespuestas = function() {
    const pagina = document.getElementById('pagina-respuestas-examen');
    if (pagina) pagina.classList.remove('activa');
    mostrarRespuestasCorrectas();
  };

  function _renderRespuestasExamen(cont, seccionId) {
    cont.innerHTML = '';
    const preguntas = preguntasPorSeccion[seccionId];

    if (preguntas && preguntas.length > 0) {
      _renderRespuestasExamenContenido(cont, preguntas);
      return;
    }

    // No están en memoria — usar polling igual que showSection
    cont.innerHTML = '<p style="text-align:center;color:#64748b;padding:40px;">⏳ Cargando preguntas...</p>';

    function _intentarCargar(intentos) {
      if (window.cargarSeccionFirestore) {
        window.cargarSeccionFirestore(seccionId).then(function(pregsFirestore) {
          if (pregsFirestore && pregsFirestore.length > 0) {
            preguntasPorSeccion[seccionId] = pregsFirestore;
            cont.innerHTML = '';
            _renderRespuestasExamenContenido(cont, pregsFirestore);
          } else {
            cont.innerHTML = '<p style="text-align:center;color:#64748b;padding:40px;">No hay preguntas cargadas para este examen.</p>';
          }
        });
      } else if (intentos < 20) {
        setTimeout(function() { _intentarCargar(intentos + 1); }, 200);
      } else {
        cont.innerHTML = '<p style="text-align:center;color:#dc2626;padding:40px;">⚠️ No se pudo conectar. Recargá la página.</p>';
      }
    }
    _intentarCargar(0);
  }

  function _renderRespuestasExamenContenido(cont, preguntas) {
    preguntas.forEach(function(preg, idx) {
      const pregDiv = document.createElement('div');
      pregDiv.className = 'rc-pregunta';

      // Número + enunciado
      const enunciado = document.createElement('div');
      enunciado.className = 'rc-enunciado';
      enunciado.textContent = (idx + 1) + '. ' + preg.pregunta;
      pregDiv.appendChild(enunciado);

      // Imagen si existe
      if (preg.imagen) {
        const img = document.createElement('img');
        img.src = preg.imagen;
        img.className = 'rc-imagen';
        img.alt = 'Imagen de la pregunta';
        img.onclick = function() { window.open(this.src, '_blank'); };
        pregDiv.appendChild(img);
      }

      // Badge de tipo (única / múltiple)
      const badge = document.createElement('span');
      badge.className = 'rc-badge-tipo';
      badge.textContent = preg.multiple ? '✦ Múltiple opción' : '✦ Opción única';
      pregDiv.appendChild(badge);

      // Opciones
      preg.opciones.forEach(function(opc, oi) {
        const esCorrecta = preg.correcta.includes(oi);
        const opcDiv = document.createElement('div');
        opcDiv.className = 'rc-opcion' + (esCorrecta ? ' rc-opcion-correcta' : '');

        const check = document.createElement('span');
        check.className = 'rc-check';
        check.textContent = esCorrecta ? '✅' : '◻';

        const letra = document.createElement('span');
        letra.className = 'rc-letra';
        letra.textContent = String.fromCharCode(65 + oi) + '.';

        const texto = document.createElement('span');
        texto.textContent = opc;

        opcDiv.appendChild(check);
        opcDiv.appendChild(letra);
        opcDiv.appendChild(texto);
        pregDiv.appendChild(opcDiv);
      });

      // Explicación si existe
      if (preg.explicacion && preg.explicacion.trim()) {
        const expToggle = document.createElement('button');
        expToggle.className = 'rc-btn-explicacion';
        expToggle.textContent = '💡 Ver explicación';
        expToggle.onclick = function() {
          const expDiv = pregDiv.querySelector('.rc-explicacion');
          if (expDiv) {
            const visible = expDiv.style.display !== 'none';
            expDiv.style.display = visible ? 'none' : 'block';
            expToggle.textContent = visible ? '💡 Ver explicación' : '💡 Ocultar explicación';
          }
        };
        pregDiv.appendChild(expToggle);

        const expDiv = document.createElement('div');
        expDiv.className = 'rc-explicacion';
        expDiv.style.display = 'none';
        expDiv.textContent = preg.explicacion;
        pregDiv.appendChild(expDiv);
      }

      cont.appendChild(pregDiv);
    });
  }

  // ======== Barra de navegación inferior: acceso rápido a todos los exámenes IAR ========
  const NAV_BAR_EXAMENES = [
    { year: '2020', exams: [
      { id: 'iarsep2020', label: 'SEP' }, { id: 'iaroct2020', label: 'OCT' },
      { id: 'iarnov2020', label: 'NOV' }, { id: 'iardic2020', label: 'DIC' }
    ]},
    { year: '2021', exams: [
      { id: 'iarfeb2021', label: 'FEB' }, { id: 'iarmar2021', label: 'MAR' },
      { id: 'iarabr2021', label: 'ABR' }, { id: 'iarmay2021', label: 'MAY' },
      { id: 'iarjun2021', label: 'JUN' }, { id: 'iarago2021', label: 'AGO' },
      { id: 'iarsep2021', label: 'SEP' }, { id: 'iarnov2021', label: 'NOV' },
      { id: 'iardic2021', label: 'DIC' }
    ]},
    { year: '2022', exams: [
      { id: 'iarmar2022', label: 'MAR' }, { id: 'iarabr2022', label: 'ABR' },
      { id: 'iarjun2022', label: 'JUN' }, { id: 'iarago2022', label: 'AGO' },
      { id: 'iaroct2022', label: 'OCT' }, { id: 'iardic2022', label: 'DIC' }
    ]},
    { year: '2023', exams: [
      { id: 'iarmar2023', label: 'MAR' }, { id: 'iarabr2023', label: 'ABR' },
      { id: 'iarmay2023', label: 'MAY' }, { id: 'iarjun2023', label: 'JUN' },
      { id: 'iarago2023', label: 'AGO' }, { id: 'iaroct2023', label: 'OCT' },
      { id: 'iardic2023', label: 'DIC' }
    ]},
    { year: '2024', exams: [
      { id: 'iarfeb2024', label: 'FEB' }, { id: 'iarmar2024', label: 'MAR' },
      { id: 'iarabr2024', label: 'ABR' }, { id: 'iarmay2024', label: 'MAY' },
      { id: 'iarjun2024', label: 'JUN' }, { id: 'iarago2024', label: 'AGO' },
      { id: 'iarsep2024', label: 'SEP' }, { id: 'iaroct2024', label: 'OCT' },
      { id: 'iarnov2024', label: 'NOV' }, { id: 'iardic2024', label: 'DIC' }
    ]},
    { year: '2025', exams: [
      { id: 'iarfeb2025', label: 'FEB' }, { id: 'iarmar2025', label: 'MAR' },
      { id: 'iarabr2025', label: 'ABR' }, { id: 'iarmay2025', label: 'MAY' },
      { id: 'iarjun2025', label: 'JUN' }, { id: 'iarago2025', label: 'AGO' },
      { id: 'iarsep2025', label: 'SEP' }, { id: 'iaroct2025', label: 'OCT' },
      { id: 'iarnov2025', label: 'NOV' }, { id: 'iardic2025', label: 'DIC' }
    ]}
  ];

  function getCompletedSections() {
    var USER_KEY = 'iar_user_id_v1';
    var COMPLETED_KEY_PREFIX = 'iar_completed_v1_';
    try {
      var uid = localStorage.getItem(USER_KEY);
      if (!uid) return {};
      var completedKey = COMPLETED_KEY_PREFIX + uid;
      return JSON.parse(localStorage.getItem(completedKey) || '{}');
    } catch(e) { return {}; }
  }

  function buildNavBar() {
    // La barra se inyecta como elemento estático al final de cada pagina-cuestionario
    // y también al final del panel del buscador.
    // Se crea un único template y se clona/inyecta en cada contenedor.
    _injectNavBarsIntoPages();
  }

  function _injectNavBarsIntoPages() {
    const completed = getCompletedSections();

    // Inyectar en todas las paginas-cuestionario
    document.querySelectorAll('.pagina-cuestionario').forEach(function(page) {
      _injectOrUpdateNavBar(page, completed);
    });

    // Inyectar también en los submenús IAR (iar-submenu y otros-iar-submenu)
    ['iar-submenu', 'otros-iar-submenu'].forEach(function(submenuId) {
      const submenu = document.getElementById(submenuId);
      if (submenu) _injectOrUpdateNavBar(submenu, completed);
    });

    // NO inyectar en buscador (requerimiento 3)
  }

  // Variable que indica el modo actual de la barra inferior
  // 'normal' = navega a cuestionarios IAR | 'respuestas' = navega a respuestas correctas
  let navBarModo = 'normal';

  function _buildNavBarElement(completed) {
    const bar = document.createElement('div');
    bar.className = 'nav-bar-inferior-static nav-bar-visible';

    const titulo = document.createElement('div');
    titulo.className = 'nav-bar-titulo';
    titulo.textContent = navBarModo === 'respuestas'
      ? '📅 ACCESO RÁPIDO - EXÁMENES IAR - RESPUESTAS CORRECTAS'
      : '📅 ACCESO RÁPIDO - EXÁMENES IAR - CUESTIONARIOS';
    bar.appendChild(titulo);

    // Una sola fila con wrap — año + botones fluyen juntos
    const fila = document.createElement('div');
    fila.className = 'nav-bar-fila';

    NAV_BAR_EXAMENES.forEach(function(grupo) {
      // Etiqueta del año inline
      const yearLabel = document.createElement('span');
      yearLabel.className = 'nav-bar-year';
      yearLabel.textContent = grupo.year;
      fila.appendChild(yearLabel);

      // Botones de meses
      grupo.exams.forEach(function(exam) {
        const btn = document.createElement('button');
        btn.className = 'nav-bar-btn' + (completed[exam.id] ? ' nav-bar-btn-completado' : '');
        btn.setAttribute('data-seccion', exam.id);
        btn.textContent = exam.label;
        btn.title = 'IAR ' + exam.label + ' ' + grupo.year;
        btn.addEventListener('click', function() {
          if (navBarModo === 'respuestas') {
            mostrarRespuestasExamen(exam.id);
          } else {
            navegarDesdeNavBar(exam.id);
          }
        });
        fila.appendChild(btn);
      });
    });

    bar.appendChild(fila);
    return bar;
  }

  function _injectOrUpdateNavBar(container, completed) {
    // Remover barra anterior si existe
    const old = container.querySelector('.nav-bar-inferior-static');
    if (old) old.remove();

    const bar = _buildNavBarElement(completed || getCompletedSections());
    container.appendChild(bar);
  }

  function renderNavBar() {
    // Actualiza colores de todos los botones en todas las barras estáticas inyectadas
    const completed = getCompletedSections();
    document.querySelectorAll('.nav-bar-inferior-static .nav-bar-btn').forEach(function(btn) {
      const sid = btn.getAttribute('data-seccion');
      if (completed[sid]) {
        btn.classList.add('nav-bar-btn-completado');
      } else {
        btn.classList.remove('nav-bar-btn-completado');
      }
    });
    // Actualizar títulos según el modo
    const tituloTexto = navBarModo === 'respuestas'
      ? '📅 ACCESO RÁPIDO - EXÁMENES IAR - RESPUESTAS CORRECTAS'
      : '📅 ACCESO RÁPIDO - EXÁMENES IAR - CUESTIONARIOS';
    document.querySelectorAll('.nav-bar-inferior-static .nav-bar-titulo').forEach(function(t) {
      t.textContent = tituloTexto;
    });
  }
  window.renderNavBar = renderNavBar;

  function navegarDesdeNavBar(seccionId) {
    // Si ya estamos en ese cuestionario, no hacer nada
    if (currentSection === seccionId) return;

    // ¿Hay un cuestionario en curso?
    const hayCuestionarioEnCurso = currentSection && state[currentSection] &&
      !state[currentSection].totalShown &&
      state[currentSection].graded &&
      Object.keys(state[currentSection].graded).some(k => state[currentSection].graded[k]);

    // ¿Hay una búsqueda en curso?
    const panelBuscador = document.getElementById('buscador-preguntas');
    const hayBusqueda = panelBuscador && !panelBuscador.classList.contains('oculto') &&
      (document.getElementById('buscador-input')?.value || '').trim().length >= 2;

    if (hayCuestionarioEnCurso) {
      mostrarDialogoNavBar(
        '📋 ¿Abandonar el cuestionario en curso?',
        '¡Espera! Tenés respuestas marcadas en el cuestionario actual que se perderán si navegás ahora.\n\n¿Seguro que querés ir a otro examen?',
        '✅ Sí, cambiar de examen',
        '↩️ No, seguir aquí',
        function() {
          ejecutarNavegacionNavBar(seccionId);
        }
      );
    } else if (hayBusqueda) {
      mostrarDialogoNavBar(
        '🔍 ¿Abandonar la búsqueda?',
        'Tenés una búsqueda en proceso. Si navegás ahora, se borrará la búsqueda actual.',
        '✅ Sí, ir al examen',
        '↩️ No, seguir buscando',
        function() {
          window.limpiarBusqueda && window.limpiarBusqueda();
          ejecutarNavegacionNavBar(seccionId);
        }
      );
    } else {
      ejecutarNavegacionNavBar(seccionId);
    }
  }

  function ejecutarNavegacionNavBar(seccionId) {
    // Limpiar estado del cuestionario actual si es necesario
    if (currentSection && state[currentSection]) {
      const s = state[currentSection];
      if (s.totalShown) {
        limpiarSeccion(currentSection, true);
      } else {
        const hayRespuestas = s.graded && Object.keys(s.graded).some(k => s.graded[k]);
        limpiarSeccion(currentSection, !hayRespuestas);
      }
    }
    navegacionOrigen = 'submenu';
    saveScrollPosition();
    saveLastSection(seccionId);
    history.pushState({ section: seccionId, origen: 'submenu' }, `Cuestionario ${seccionId}`, `#${seccionId}`);
    showSection(seccionId);
  }

  function mostrarDialogoNavBar(titulo, mensaje, textoAceptar, textoCancelar, onAceptar) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:99999;display:flex;justify-content:center;align-items:center;';

    const dialogo = document.createElement('div');
    dialogo.style.cssText = 'background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.22);max-width:420px;width:90%;text-align:center;';

    const tit = document.createElement('h3');
    tit.textContent = titulo;
    tit.style.cssText = 'margin:0 0 14px;color:#1f2937;font-size:1.15rem;line-height:1.4;';

    const msg = document.createElement('p');
    msg.textContent = mensaje;
    msg.style.cssText = 'margin:0 0 22px;color:#475569;font-size:0.93rem;line-height:1.6;white-space:pre-line;';

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';

    const btnSi = document.createElement('button');
    btnSi.textContent = textoAceptar;
    btnSi.style.cssText = 'padding:10px 22px;background:#0d7490;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem;';
    btnSi.onclick = function() { document.body.removeChild(overlay); onAceptar(); };

    const btnNo = document.createElement('button');
    btnNo.textContent = textoCancelar;
    btnNo.style.cssText = 'padding:10px 22px;background:#e2e8f0;color:#475569;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem;';
    btnNo.onclick = function() { document.body.removeChild(overlay); };

    btns.appendChild(btnSi);
    btns.appendChild(btnNo);
    dialogo.appendChild(tit);
    dialogo.appendChild(msg);
    dialogo.appendChild(btns);
    overlay.appendChild(dialogo);
    document.body.appendChild(overlay);
  }

  // Actualizar colores de la barra al volver al menú o submenú
  const _origShowMenu = showMenu;
  // (hook will be applied after DOMContentLoaded)

  // ======== Botón flotante "Ver mi progreso" ========
  function buildProgressUI() {
    const btn = document.createElement("button");
    btn.id = "btn-ver-progreso";
    btn.textContent = "Ver mi progreso";
    btn.style.position = "fixed";
    btn.style.right = "16px";
    btn.style.bottom = "16px";
    btn.style.zIndex = "1000";
    btn.style.padding = "10px 14px";
    btn.style.border = "none";
    btn.style.borderRadius = "999px";
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,.15)";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "bold";
    btn.style.background = "#2ecc71";
    btn.style.color = "#fff";
    document.body.appendChild(btn);

    const panel = document.createElement("div");
    panel.id = "panel-progreso";
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "70px";
    panel.style.width = "320px";
    panel.style.maxWidth = "92vw";
    panel.style.maxHeight = "60vh";
    panel.style.overflow = "auto";
    panel.style.background = "#fff";
    panel.style.border = "1px solid #dee2e6";
    panel.style.borderRadius = "12px";
    panel.style.boxShadow = "0 8px 24px rgba(0,0,0,.2)";
    panel.style.padding = "12px";
    panel.style.display = "none";
    panel.style.zIndex = "1001";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    const title = document.createElement("strong");
    title.textContent = "Historial de intentos";
    const close = document.createElement("button");
    close.textContent = "Cerrar";
    close.style.border = "none";
    close.style.background = "#e0e0e0";
    close.style.borderRadius = "8px";
    close.style.padding = "6px 10px";
    close.style.cursor = "pointer";
    header.appendChild(title);
    header.appendChild(close);

    const content = document.createElement("div");
    content.id = "contenido-progreso";
    content.style.marginTop = "10px";
    content.innerHTML = "<em>Sin intentos aún.</em>";

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);

    btn.addEventListener("click", () => {
      if (panel.style.display === "block") {
        panel.style.display = "none";
      } else {
        renderProgress(content);
        panel.style.display = "block";
      }
    });
    close.addEventListener("click", () => (panel.style.display = "none"));
  }

  function renderProgress(container) {
    const data = loadJSON(ATTEMPT_LOG_KEY, []);
    if (!data.length) {
      container.innerHTML = "<em>Sin intentos aún.</em>";
      return;
    }

    const sorted = data.slice().sort((a, b) => {
      const da = new Date(a.iso).getTime();
      const db = new Date(b.iso).getTime();
      if (db !== da) return db - da;
      if (a.sectionTitle !== b.sectionTitle) return a.sectionTitle.localeCompare(b.sectionTitle);
      return db - da;
    });

    const byDate = {};
    sorted.forEach(item => {
      const d = toLocalDateStr(item.iso);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(item);
    });

    container.innerHTML = "";
    Object.keys(byDate).forEach(dateLabel => {
      const group = document.createElement("div");
      group.style.marginBottom = "12px";
      const h = document.createElement("div");
      h.style.fontWeight = "bold";
      h.style.marginBottom = "6px";
      h.textContent = dateLabel;
      group.appendChild(h);

      byDate[dateLabel].forEach(item => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "6px 8px";
        row.style.border = "1px solid #eee";
        row.style.borderRadius = "8px";
        row.style.marginBottom = "6px";
        const left = document.createElement("div");
        left.textContent = item.sectionTitle;
        const right = document.createElement("div");
        right.textContent = `${item.score}/${item.total}`;
        right.style.fontWeight = "bold";
        row.appendChild(left);
        row.appendChild(right);
        group.appendChild(row);
      });

      container.appendChild(group);
    });
  }

  // ======== Inicio ========
  document.addEventListener("DOMContentLoaded", () => {
    buildProgressUI();
    buildNavBar();
    setupBrowserNavigation();
    clearScrollPosition();

    const hash = window.location.hash.substring(1);
    // Lista de todas las secciones válidas (aunque preguntasPorSeccion esté vacío por Firestore)
    const SECCIONES_VALIDAS = [
      'iarsep2020','iaroct2020','iarnov2020','iardic2020',
      'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
      'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
      'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
      'iarfeb2024','iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
      'iarfeb2025','iarmar2025','iarabr2025','iarmay2025','iarjun2025','iarago2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
      'simulador'
    ];
    if (hash && hash !== 'menu' && SECCIONES_VALIDAS.includes(hash)) {
      showSection(hash);
      currentSection = hash;
    } else if (hash === 'respuestas') {
      mostrarRespuestasCorrectas();
    } else if (hash && hash.startsWith('respuestas-')) {
      const secId = hash.replace('respuestas-', '');
      mostrarRespuestasExamen(secId);
    } else {
      history.replaceState({ section: null }, 'Menú Principal', '#menu');
      showMenu();
    }
  });

  // ======== MEDIDAS DE SEGURIDAD ========
  
  document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      return false;
  });

  document.addEventListener('keydown', function(e) {
      if (e.keyCode === 123 ||
          (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
          (e.ctrlKey && e.keyCode === 85) ||
          (e.ctrlKey && e.keyCode === 83) ||
          (e.ctrlKey && e.keyCode === 80) ||
          (e.ctrlKey && e.keyCode === 65)) {
          e.preventDefault();
          return false;
      }
  });

  let devtools = {open: false, orientation: null};
  setInterval(function() {
      if (window.outerHeight - window.innerHeight > 160 || 
          window.outerWidth - window.innerWidth > 160) {
          if (!devtools.open) {
              devtools.open = true;
              alert('Por favor, cierre las herramientas de desarrollo para continuar.');
              window.location.reload();
          }
      } else {
          devtools.open = false;
      }
  }, 500);

  document.addEventListener('dragstart', function(e) {
      e.preventDefault();
      return false;
  });

  document.addEventListener('selectstart', function(e) {
      if (!e.target.matches('input, textarea')) {
          e.preventDefault();
          return false;
      }
  });

  window.addEventListener('beforeprint', function(e) {
      e.preventDefault();
      alert('La impresión no está permitida en esta aplicación.');
      return false;
  });

  console.log('%cADVERTENCIA!', 'color: red; font-size: 50px; font-weight: bold;');
  console.log('%cEsta función del navegador está destinada a desarrolladores. Si alguien te pidió copiar y pegar algo aquí, es una estafa.', 'color: red; font-size: 16px;');
  
  setInterval(function() {
      console.clear();
  }, 3000);

  // ======== FUNCIONES PARA SIMULACRO DE EXAMEN ========
  
  const SIMULACRO_STORAGE_KEY = "simulacro_preguntas_v1";
  
  // Distribución objetivo de preguntas por especialidad (total 100)
  const distribucionObjetivo = {
    pediatria: 20,
    ginecologia: 11,
    obstetricia: 11,
    cardiologia: 11,
    saludpublica: 11,
    infectologia: 8,
    endocrinologia: 6,
    neumonologia: 4,
    cirugia: 4,
    hematologia: 2,
    digestivo: 2,
    neurologia: 2,
    nefrologia: 2,
    dermatologia: 2,
    psiquiatria: 2,
    medicinalegal: 2,
    medicinafamiliar: 2
  };
  
  function obtenerPreguntasSimulacro() {
    // Intentar cargar preguntas guardadas
    const saved = localStorage.getItem(SIMULACRO_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error al cargar preguntas guardadas:', e);
      }
    }
    
    // Si no hay preguntas guardadas, generar nuevas
    return generarNuevasPreguntasSimulacro();
  }
  
  function generarNuevasPreguntasSimulacro() {
    console.log('🎲 Generando nuevo simulacro de 100 preguntas...');
    
    const preguntasSeleccionadas = [];
    
    // Para cada especialidad en la distribución
    for (const [especialidad, cantidad] of Object.entries(distribucionObjetivo)) {
      // Verificar que la especialidad existe en preguntasPorSeccion
      if (!preguntasPorSeccion[especialidad]) {
        console.warn(`⚠️ Especialidad ${especialidad} no encontrada en preguntasPorSeccion`);
        continue;
      }
      
      const preguntasDisponibles = preguntasPorSeccion[especialidad];
      
      if (preguntasDisponibles.length === 0) {
        console.warn(`⚠️ No hay preguntas disponibles para ${especialidad}`);
        continue;
      }
      
      console.log(`📝 ${especialidad}: solicitadas=${cantidad}, disponibles=${preguntasDisponibles.length}`);
      
      // Crear array de índices disponibles
      const indicesDisponibles = preguntasDisponibles.map((_, idx) => idx);
      
      // Mezclar los índices
      const indicesMezclados = shuffle(indicesDisponibles, 'simulacro-' + especialidad + '-' + Date.now());
      
      // Tomar exactamente la cantidad especificada
      // Si hay menos disponibles, repetir índices de manera circular
      for (let i = 0; i < cantidad; i++) {
        const indice = indicesMezclados[i % indicesMezclados.length];
        preguntasSeleccionadas.push({
          especialidad: especialidad,
          indiceOriginal: indice,
          pregunta: preguntasDisponibles[indice]
        });
      }
    }
    
    console.log(`📊 Total de preguntas seleccionadas: ${preguntasSeleccionadas.length}`);
    
    // Verificar que tenemos exactamente 100
    if (preguntasSeleccionadas.length !== 100) {
      console.error(`❌ ERROR: Se generaron ${preguntasSeleccionadas.length} preguntas en lugar de 100`);
      console.error('Distribución objetivo:', distribucionObjetivo);
      console.error('Total objetivo:', Object.values(distribucionObjetivo).reduce((a, b) => a + b, 0));
    }
    
    // Mezclar todas las preguntas seleccionadas
    const preguntasMezcladas = shuffle(preguntasSeleccionadas, 'simulacro-final-' + Date.now());
    
    console.log(`✅ Simulacro generado con ${preguntasMezcladas.length} preguntas`);
    
    // Guardar en localStorage
    localStorage.setItem(SIMULACRO_STORAGE_KEY, JSON.stringify(preguntasMezcladas));
    
    return preguntasMezcladas;
  }
  
  window.crearNuevoSimulacro = function() {
    // Mostrar diálogo de confirmación personalizado
    mostrarDialogoConfirmacion(
      '¿Deseas crear un nuevo simulacro?',
      'Se generarán 100 preguntas nuevas y se perderá el progreso actual.',
      function() {
        // Al aceptar: crear nuevo simulacro
        ejecutarCrearNuevoSimulacro();
      },
      function() {
        // Al cancelar: no hacer nada, mantener estado actual
        console.log('✖️ Creación de nuevo simulacro cancelada');
      }
    );
  };
  
  function ejecutarCrearNuevoSimulacro() {
    // Reiniciar el temporizador
    reiniciarTemporizador();
    
    // Limpiar el estado del simulacro actual
    delete state['simulador'];
    saveJSON(STORAGE_KEY, state);
    
    // Limpiar las preguntas guardadas en localStorage
    localStorage.removeItem(SIMULACRO_STORAGE_KEY);
    console.log('🗑️ localStorage limpiado, se generarán nuevas preguntas');
    
    // Limpiar puntajes
    if (window.puntajesPorSeccion && window.puntajesPorSeccion['simulador']) {
      window.puntajesPorSeccion['simulador'] = [];
    }
    
    // Limpiar resultado visual
    const resultadoTotal = document.getElementById('resultado-total-simulador');
    if (resultadoTotal) {
      resultadoTotal.textContent = "";
      resultadoTotal.className = "resultado-final";
    }
    
    // Generar nuevas preguntas (esto creará un nuevo conjunto)
    const nuevasPreguntas = generarNuevasPreguntasSimulacro();
    
    // Actualizar preguntasPorSeccion con las nuevas preguntas
    preguntasPorSeccion['simulador'] = nuevasPreguntas.map(item => item.pregunta);
    
    // Regenerar el cuestionario
    generarCuestionario('simulador');
    
    // Scroll al inicio
    window.scrollTo(0, 0);
  }
  
  window.repetirSimulacro = function() {
    // Mostrar diálogo de confirmación personalizado
    mostrarDialogoConfirmacion(
      '¿Estás seguro de que deseas repetir el simulacro actual?',
      'Se mantendrán las mismas 100 preguntas en el mismo orden. Se borrarán todas las respuestas marcadas y se aleatorizarán nuevamente las opciones de cada pregunta.',
      function() {
        // Al aceptar: repetir simulacro
        ejecutarRepetirSimulacro();
      },
      function() {
        // Al cancelar: no hacer nada, mantener estado actual
        console.log('✖️ Repetición de simulacro cancelada');
      }
    );
  };
  
  function ejecutarRepetirSimulacro() {
    // Reiniciar el temporizador
    reiniciarTemporizador();
    
    // Limpiar el estado del simulacro actual pero mantener las preguntas
    delete state['simulador'];
    saveJSON(STORAGE_KEY, state);
    
    // Limpiar puntajes
    if (window.puntajesPorSeccion && window.puntajesPorSeccion['simulador']) {
      window.puntajesPorSeccion['simulador'] = Array(
        preguntasPorSeccion['simulador'].length
      ).fill(null);
    }
    
    // Limpiar resultado visual
    const resultadoTotal = document.getElementById('resultado-total-simulador');
    if (resultadoTotal) {
      resultadoTotal.textContent = "";
      resultadoTotal.className = "resultado-final";
    }
    
    // Regenerar el cuestionario (esto aleatorizará las opciones nuevamente)
    generarCuestionario('simulador');
    
    // Scroll al inicio
    window.scrollTo(0, 0);
  }
  
  function mostrarDialogoConfirmacion(titulo, mensaje, onAceptar, onCancelar) {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    
    // Crear diálogo
    const dialogo = document.createElement('div');
    dialogo.style.backgroundColor = 'white';
    dialogo.style.padding = '30px';
    dialogo.style.borderRadius = '10px';
    dialogo.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    dialogo.style.maxWidth = '450px';
    dialogo.style.textAlign = 'center';
    
    const tituloEl = document.createElement('h3');
    tituloEl.textContent = titulo;
    tituloEl.style.marginBottom = '15px';
    tituloEl.style.color = '#333';
    tituloEl.style.fontSize = '1.3rem';
    
    const mensajeEl = document.createElement('p');
    mensajeEl.textContent = mensaje;
    mensajeEl.style.marginBottom = '25px';
    mensajeEl.style.color = '#666';
    mensajeEl.style.lineHeight = '1.5';
    
    const botonesDiv = document.createElement('div');
    botonesDiv.style.display = 'flex';
    botonesDiv.style.gap = '10px';
    botonesDiv.style.justifyContent = 'center';
    
    // Botón Aceptar
    const btnAceptar = document.createElement('button');
    btnAceptar.textContent = 'Aceptar';
    btnAceptar.className = 'btn-responder';
    btnAceptar.style.minWidth = '120px';
    btnAceptar.style.backgroundColor = '#28a745';
    btnAceptar.onclick = function() {
      document.body.removeChild(overlay);
      if (onAceptar) onAceptar();
    };
    
    // Botón Cancelar
    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.className = 'btn-responder';
    btnCancelar.style.minWidth = '120px';
    btnCancelar.style.backgroundColor = '#6c757d';
    btnCancelar.onclick = function() {
      document.body.removeChild(overlay);
      if (onCancelar) onCancelar();
    };
    
    botonesDiv.appendChild(btnAceptar);
    botonesDiv.appendChild(btnCancelar);
    
    dialogo.appendChild(tituloEl);
    dialogo.appendChild(mensajeEl);
    dialogo.appendChild(botonesDiv);
    overlay.appendChild(dialogo);
    document.body.appendChild(overlay);
  }
  
  window.volverAlMenuSimulacro = function(seccionId) {
    // Verificar si hay progreso en el simulacro
    const s = state[seccionId];
    const totalShown = s && s.totalShown;
    const hasProgress = s && Object.keys(s.graded || {}).length > 0;
    
    if (hasProgress && !totalShown) {
      // Mostrar ventana emergente con opciones
      mostrarDialogoVolverMenu(seccionId);
    } else if (totalShown) {
      // Si ya mostró el total, preguntar entre repetir o crear nuevo
      mostrarDialogoFinalizado(seccionId);
    } else {
      // No hay progreso, volver directamente
      volverAlMenu();
    }
  };
  
  function mostrarDialogoVolverMenu(seccionId) {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    
    // Crear diálogo
    const dialogo = document.createElement('div');
    dialogo.style.backgroundColor = 'white';
    dialogo.style.padding = '30px';
    dialogo.style.borderRadius = '10px';
    dialogo.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    dialogo.style.maxWidth = '400px';
    dialogo.style.textAlign = 'center';
    
    const titulo = document.createElement('h3');
    titulo.textContent = '¿Qué deseas hacer?';
    titulo.style.marginBottom = '20px';
    titulo.style.color = '#333';
    
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Tienes progreso sin finalizar en este simulacro.';
    mensaje.style.marginBottom = '20px';
    mensaje.style.color = '#666';
    
    const botonesDiv = document.createElement('div');
    botonesDiv.style.display = 'flex';
    botonesDiv.style.flexDirection = 'column';
    botonesDiv.style.gap = '10px';
    
    // Botón Volver al simulacro en curso
    const btnVolverSimulacro = document.createElement('button');
    btnVolverSimulacro.textContent = '↩️ Volver al simulacro en curso';
    btnVolverSimulacro.className = 'btn-responder';
    btnVolverSimulacro.style.width = '100%';
    btnVolverSimulacro.style.backgroundColor = '#0d7490';
    btnVolverSimulacro.onclick = function() {
      document.body.removeChild(overlay);
      // No hacer nada, simplemente cerrar el diálogo
      // El usuario ya está en el simulacro
    };
    
    // Botón Crear Nuevo Simulacro
    const btnNuevo = document.createElement('button');
    btnNuevo.textContent = '🔄 Crear Nuevo Simulacro';
    btnNuevo.className = 'btn-responder';
    btnNuevo.style.width = '100%';
    btnNuevo.onclick = function() {
      document.body.removeChild(overlay);
      ejecutarCrearNuevoSimulacro();
    };
    
    // Botón Repetir Simulacro
    const btnRepetir = document.createElement('button');
    btnRepetir.textContent = '🔁 Repetir Simulacro';
    btnRepetir.className = 'btn-responder';
    btnRepetir.style.width = '100%';
    btnRepetir.onclick = function() {
      document.body.removeChild(overlay);
      ejecutarRepetirSimulacro();
    };
    
    // Botón Volver al Menú Principal
    const btnMenu = document.createElement('button');
    btnMenu.textContent = '🏠 Volver al Menú Principal';
    btnMenu.className = 'btn-responder';
    btnMenu.style.width = '100%';
    btnMenu.style.backgroundColor = '#6c757d';
    btnMenu.onclick = function() {
      document.body.removeChild(overlay);
      volverAlMenu();
    };
    
    botonesDiv.appendChild(btnVolverSimulacro);
    botonesDiv.appendChild(btnNuevo);
    botonesDiv.appendChild(btnRepetir);
    botonesDiv.appendChild(btnMenu);
    
    dialogo.appendChild(titulo);
    dialogo.appendChild(mensaje);
    dialogo.appendChild(botonesDiv);
    overlay.appendChild(dialogo);
    document.body.appendChild(overlay);
  }
  
  function mostrarDialogoFinalizado(seccionId) {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    
    // Crear diálogo
    const dialogo = document.createElement('div');
    dialogo.style.backgroundColor = 'white';
    dialogo.style.padding = '30px';
    dialogo.style.borderRadius = '10px';
    dialogo.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    dialogo.style.maxWidth = '400px';
    dialogo.style.textAlign = 'center';
    
    const titulo = document.createElement('h3');
    titulo.textContent = '¿Qué deseas hacer?';
    titulo.style.marginBottom = '20px';
    titulo.style.color = '#333';
    
    const botonesDiv = document.createElement('div');
    botonesDiv.style.display = 'flex';
    botonesDiv.style.flexDirection = 'column';
    botonesDiv.style.gap = '10px';
    
    // Botón Crear Nuevo Simulacro
    const btnNuevo = document.createElement('button');
    btnNuevo.textContent = '🔄 Crear Nuevo Simulacro';
    btnNuevo.className = 'btn-responder';
    btnNuevo.style.width = '100%';
    btnNuevo.onclick = function() {
      document.body.removeChild(overlay);
      ejecutarCrearNuevoSimulacro();
      volverAlMenu();
    };
    
    // Botón Repetir Simulacro
    const btnRepetir = document.createElement('button');
    btnRepetir.textContent = '🔁 Repetir Simulacro';
    btnRepetir.className = 'btn-responder';
    btnRepetir.style.width = '100%';
    btnRepetir.onclick = function() {
      document.body.removeChild(overlay);
      ejecutarRepetirSimulacro();
    };
    
    // Botón Volver al Menú Principal
    const btnMenu = document.createElement('button');
    btnMenu.textContent = '🏠 Volver al Menú Principal';
    btnMenu.className = 'btn-responder';
    btnMenu.style.width = '100%';
    btnMenu.style.backgroundColor = '#6c757d';
    btnMenu.onclick = function() {
      document.body.removeChild(overlay);
      volverAlMenu();
    };
    
    botonesDiv.appendChild(btnNuevo);
    botonesDiv.appendChild(btnRepetir);
    botonesDiv.appendChild(btnMenu);
    
    dialogo.appendChild(titulo);
    dialogo.appendChild(botonesDiv);
    overlay.appendChild(dialogo);
    document.body.appendChild(overlay);
  }
  
  // Inicializar preguntas del simulacro cuando se carga la página
  document.addEventListener('DOMContentLoaded', function() {
    // Si entramos directamente a simulador, cargar o generar preguntas
    if (window.location.hash === '#simulador') {
      const preguntasSimulacro = obtenerPreguntasSimulacro();
      preguntasPorSeccion['simulador'] = preguntasSimulacro.map(item => item.pregunta);
    }
  });
  
  // Modificar la función mostrarCuestionario para manejar el simulacro
  const mostrarCuestionarioOriginal = window.mostrarCuestionario;
  window.mostrarCuestionario = function(seccionId) {
    if (seccionId === 'simulador') {
      const preguntasSimulacro = obtenerPreguntasSimulacro();
      preguntasPorSeccion['simulador'] = preguntasSimulacro.map(item => item.pregunta);
    }
    mostrarCuestionarioOriginal(seccionId);
  };

})();
/* ======================================================
   BUSCADOR DE PREGUNTAS
   ====================================================== */

(function () {

    var BUSCADOR_KEY = 'buscador_ultimo_query_v1';

    var NOMBRES_EXAMENES = {
        iarsep2020:'SEP 2020',iaroct2020:'OCT 2020',iarnov2020:'NOV 2020',iardic2020:'DIC 2020',
        iarfeb2021:'FEB 2021',iarmar2021:'MAR 2021',iarabr2021:'ABR 2021',iarmay2021:'MAY 2021',
        iarjun2021:'JUN 2021',iarago2021:'AGO 2021',iarsep2021:'SEP 2021',iarnov2021:'NOV 2021',iardic2021:'DIC 2021',
        iarmar2022:'MAR 2022',iarabr2022:'ABR 2022',iarjun2022:'JUN 2022',iarago2022:'AGO 2022',
        iaroct2022:'OCT 2022',iardic2022:'DIC 2022',
        iarmar2023:'MAR 2023',iarabr2023:'ABR 2023',iarmay2023:'MAY 2023',iarjun2023:'JUN 2023',
        iarago2023:'AGO 2023',iaroct2023:'OCT 2023',iardic2023:'DIC 2023',
        iarfeb2024:'FEB 2024',iarmar2024:'MAR 2024',iarabr2024:'ABR 2024',iarmay2024:'MAY 2024',
        iarjun2024:'JUN 2024',iarago2024:'AGO 2024',iarsep2024:'SEP 2024',iaroct2024:'OCT 2024',
        iarnov2024:'NOV 2024',iardic2024:'DIC 2024',
        iarfeb2025:'FEB 2025',iarmar2025:'MAR 2025',iarabr2025:'ABR 2025',iarmay2025:'MAY 2025',
        iarjun2025:'JUN 2025',iarago2025:'AGO 2025',iarsep2025:'SEP 2025',iaroct2025:'OCT 2025',
        iarnov2025:'NOV 2025',iardic2025:'DIC 2025',simulacro_iar:'SIMULACRO IAR'
    };

    function nombreExamen(id) { return NOMBRES_EXAMENES[id] || id.toUpperCase(); }

    // Normaliza tildes/acentos para búsqueda sin distinción
    function normalizarTexto(str) {
        if (!str) return '';
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function escaparRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function resaltarTexto(texto, termino) {
        if (!termino) return escapeHtml(texto);
        // Construir regex que matchee con o sin tildes
        var terminoNorm = normalizarTexto(termino);
        // Buscar posiciones en el texto original comparando normalizado
        var textoNorm = normalizarTexto(texto);
        var result = '';
        var i = 0;
        var lenT = terminoNorm.length;
        while (i < texto.length) {
            if (textoNorm.substr(i, lenT) === terminoNorm) {
                result += '<mark>' + escapeHtml(texto.substr(i, lenT)) + '</mark>';
                i += lenT;
            } else {
                result += escapeHtml(texto[i]);
                i++;
            }
        }
        return result;
    }

    function truncar(texto, maxLen) {
        if (!texto) return '';
        return texto.length <= maxLen ? texto : texto.substring(0, maxLen) + '\u2026';
    }

    // Usa el sistema de clases del app (oculto / activa), NO style.display
    function ocultarTodo() {
        document.getElementById('menu-principal')?.classList.add('oculto');
        document.querySelectorAll('.menu-principal[id$="-submenu"]').forEach(s => s.style.display = 'none');
        document.querySelectorAll('.pagina-cuestionario').forEach(p => p.classList.remove('activa'));
        var pb = document.getElementById('buscador-preguntas');
        if (pb) pb.classList.add('oculto');
    }

    // ── Abrir buscador ──
    window.mostrarBuscador = function () {
        ocultarTodo();
        var panel = document.getElementById('buscador-preguntas');
        if (panel) panel.classList.remove('oculto');

        renderNavBar();

        var q = '';
        try { q = localStorage.getItem(BUSCADOR_KEY) || ''; } catch(e) {}
        var inp = document.getElementById('buscador-input');
        if (inp) { inp.value = q; setTimeout(function(){ inp.focus(); }, 100); }
        if (q.length >= 2) realizarBusqueda(q);
    };

    // ── Limpiar búsqueda ──
    window.limpiarBusqueda = function () {
        var inp = document.getElementById('buscador-input');
        if (inp) { inp.value = ''; inp.focus(); }
        document.getElementById('buscador-resultados').innerHTML = '';
        document.getElementById('buscador-stats').style.display = 'none';
        try { localStorage.removeItem(BUSCADOR_KEY); } catch(e) {}
    };

    // ── Ir a una pregunta desde el buscador ──
    window.irAPreguntaDesdeBuscador = function (seccionId, originalIdx) {
        // Verificar restricción demo usando el flag global
        if (window._demoCheckEnabled && window._demoSeccionesPermitidas &&
            !window._demoSeccionesPermitidas.includes(seccionId)) {
            var overlay = document.getElementById('demo-restriccion-overlay');
            if (overlay) { overlay.style.display = 'flex'; }
            return;
        }
        try { sessionStorage.setItem('buscador_origen', '1'); } catch(e) {}
        // Marcar origen de navegación como buscador
        if (typeof navegacionOrigen !== 'undefined') navegacionOrigen = 'buscador';

        // Guardar posición de scroll ACTUAL en el buscador antes de navegar
        try {
            localStorage.setItem('buscador_scroll_pos', String(window.pageYOffset || document.documentElement.scrollTop));
        } catch(e) {}

        // Marcar esta tarjeta como visitada
        var visitKey = 'buscador_visited_v1';
        var visited = {};
        try { visited = JSON.parse(localStorage.getItem(visitKey) || '{}'); } catch(e) {}
        var cardId = seccionId + '_' + originalIdx;
        visited[cardId] = true;
        try { localStorage.setItem(visitKey, JSON.stringify(visited)); } catch(e) {}

        // Aplicar estilo visitado a las tarjetas correspondientes de inmediato
        document.querySelectorAll('[data-buscador-card-id="' + cardId + '"]').forEach(function(el) {
            el.classList.add('buscador-card-visitada');
        });

        // Usar showSection del sistema original (maneja currentSection y generarCuestionario)
        if (typeof showSection === 'function') {
            showSection(seccionId);
        } else {
            // Fallback manual
            ocultarTodo();
            var pagina = document.getElementById(seccionId);
            if (!pagina) return;
            pagina.classList.add('activa');
            if (typeof generarCuestionario === 'function') generarCuestionario(seccionId);
        }

        // Mostrar botón flotante
        var btn = document.getElementById('btn-volver-buscador');
        if (btn) btn.style.display = 'flex';

        // Scroll + resaltado a la pregunta específica
        // Usar 800ms para dar tiempo al cuestionario a renderizarse completamente
        setTimeout(function () {
            var bloque = document.getElementById('pregunta-bloque-' + seccionId + '-' + originalIdx);
            if (bloque) {
                bloque.scrollIntoView({ behavior: 'smooth', block: 'center' });
                bloque.classList.add('buscador-highlight');
                setTimeout(function () { bloque.classList.remove('buscador-highlight'); }, 2500);
            } else {
                // Si aún no está disponible, intentar una vez más con más delay
                setTimeout(function() {
                    var bloque2 = document.getElementById('pregunta-bloque-' + seccionId + '-' + originalIdx);
                    if (bloque2) {
                        bloque2.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        bloque2.classList.add('buscador-highlight');
                        setTimeout(function () { bloque2.classList.remove('buscador-highlight'); }, 2500);
                    }
                }, 600);
            }
        }, 800);
    };

    // ── Volver al buscador conservando la búsqueda y posición de scroll ──
    window.volverAlBuscador = function () {
        try { sessionStorage.removeItem('buscador_origen'); } catch(e) {}
        if (typeof navegacionOrigen !== 'undefined') navegacionOrigen = null;
        var btn = document.getElementById('btn-volver-buscador');
        if (btn) btn.style.display = 'none';

        ocultarTodo();
        var panel = document.getElementById('buscador-preguntas');
        if (panel) panel.classList.remove('oculto');

        renderNavBar();

        var q = '';
        try { q = localStorage.getItem(BUSCADOR_KEY) || ''; } catch(e) {}
        var inp = document.getElementById('buscador-input');
        if (inp) inp.value = q;
        if (q.length >= 2) realizarBusqueda(q);

        // Restaurar posición de scroll al resultado visitado
        var savedScrollBuscador = 0;
        try { savedScrollBuscador = parseInt(localStorage.getItem('buscador_scroll_pos') || '0', 10); } catch(e) {}
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                window.scrollTo({ top: savedScrollBuscador, behavior: 'smooth' });
            });
        });
    };

    // ── Buscar y renderizar resultados ──
    window.realizarBusqueda = function (query) {
        query = (query || '').trim();
        var resDiv = document.getElementById('buscador-resultados');
        var statsDiv = document.getElementById('buscador-stats');

        // Guardar query en localStorage
        try {
            if (query.length >= 2) localStorage.setItem(BUSCADOR_KEY, query);
            else localStorage.removeItem(BUSCADOR_KEY);
        } catch(e) {}

        if (query.length < 2) { resDiv.innerHTML = ''; statsDiv.style.display = 'none'; return; }

        if (typeof preguntasPorSeccion === 'undefined') {
            resDiv.innerHTML = '<div class="buscador-vacio"><div class="buscador-vacio-icon">\u26a0\ufe0f</div>No se encontr\u00f3 la base de preguntas.</div>';
            return;
        }

        var TODAS_SECCIONES = [
            'iarsep2020','iaroct2020','iarnov2020','iardic2020',
            'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
            'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
            'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
            'iarfeb2024','iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
            'iarfeb2025','iarmar2025','iarabr2025','iarmay2025','iarjun2025','iarago2025','iarsep2025','iaroct2025','iarnov2025','iardic2025'
        ];

        // Detectar cuáles secciones faltan cargar
        var seccionesFaltantes = TODAS_SECCIONES.filter(function(sid) {
            return !Array.isArray(preguntasPorSeccion[sid]) || preguntasPorSeccion[sid].length === 0;
        });

        if (seccionesFaltantes.length > 0 && window.cargarSeccionFirestore) {
            resDiv.innerHTML = '<div class="buscador-vacio"><div class="buscador-vacio-icon">⏳</div>Cargando base de preguntas para buscar (' + (TODAS_SECCIONES.length - seccionesFaltantes.length) + '/' + TODAS_SECCIONES.length + ')...</div>';
            statsDiv.style.display = 'none';

            // Cargar todas las faltantes en paralelo
            Promise.all(seccionesFaltantes.map(function(sid) {
                return window.cargarSeccionFirestore(sid).then(function(pregs) {
                    if (pregs) preguntasPorSeccion[sid] = pregs;
                });
            })).then(function() {
                _ejecutarBusqueda(query, resDiv, statsDiv);
            });
            return;
        }

        _ejecutarBusqueda(query, resDiv, statsDiv);
    };

    function _ejecutarBusqueda(query, resDiv, statsDiv) {
        var queryNorm = normalizarTexto(query);
        var resE = [], resO = [];

        Object.keys(preguntasPorSeccion).forEach(function (sid) {
            var preguntas = preguntasPorSeccion[sid];
            if (!Array.isArray(preguntas)) return;
            var examen = nombreExamen(sid);
            preguntas.forEach(function (preg, idx) {
                if (preg.pregunta && normalizarTexto(preg.pregunta).includes(queryNorm)) {
                    resE.push({ sid:sid, idx:idx, examen:examen, num:idx+1, texto:preg.pregunta });
                }
                if (Array.isArray(preg.opciones)) {
                    preg.opciones.forEach(function (opc, oi) {
                        if (normalizarTexto(opc).includes(queryNorm)) {
                            resO.push({ sid:sid, idx:idx, examen:examen, num:idx+1,
                                letra:String.fromCharCode(65+oi), texto:opc, enunciado:preg.pregunta });
                        }
                    });
                }
            });
        });

        var total = resE.length + resO.length;
        statsDiv.style.display = 'block';
        statsDiv.textContent = total === 0
            ? 'No se encontraron resultados para "' + query + '"'
            : total + ' resultado' + (total!==1?'s':'') + ' encontrado' + (total!==1?'s':'') +
              ' (' + resE.length + ' en enunciados \u00b7 ' + resO.length + ' en opciones)' +
              '  \u2014  Hac\u00e9 clic en una tarjeta para ir a la pregunta';

        if (total === 0) {
            resDiv.innerHTML = '<div class="buscador-vacio"><div class="buscador-vacio-icon">\ud83d\udd0d</div>' +
                'No se encontraron resultados con <strong>"' + escapeHtml(query) + '"</strong></div>';
            return;
        }

        var html = '';

        // Cargar visitadas para aplicar estilo
        var visited = {};
        try { visited = JSON.parse(localStorage.getItem('buscador_visited_v1') || '{}'); } catch(e) {}

        if (resE.length > 0) {
            html += '<div class="buscador-grupo-titulo enunciado">\ud83d\udcc4 Encontrado en Enunciados (' + resE.length + ')</div>';
            resE.forEach(function(r) {
                var cardId = r.sid + '_' + r.idx;
                var visitadaClass = visited[cardId] ? ' buscador-card-visitada' : '';
                html += '<div class="buscador-card tipo-enunciado' + visitadaClass + '" data-buscador-card-id="' + cardId + '" onclick="irAPreguntaDesdeBuscador(\'' + r.sid + '\',' + r.idx + ')" title="Ir a esta pregunta">' +
                    '<div class="buscador-card-meta">' +
                        '<span class="badge-tipo enunciado">Enunciado</span>' +
                        '<span class="badge-examen">IAR ' + escapeHtml(r.examen) + '</span>' +
                        '<span class="badge-pregunta">Pregunta N\u00b0 ' + r.num + '</span>' +
                        (visited[cardId] ? '<span class="badge-visitada">✓ Visitada</span>' : '') +
                        '<span class="badge-ir">\u2192 Ir a la pregunta</span>' +
                    '</div>' +
                    '<div class="buscador-card-texto">' + resaltarTexto(truncar(r.texto, 280), query) + '</div>' +
                '</div>';
            });
        }

        if (resO.length > 0) {
            html += '<div class="buscador-grupo-titulo opcion">\ud83d\udd18 Encontrado en Opciones (' + resO.length + ')</div>';
            resO.forEach(function(r) {
                var enunciadoCorto = truncar(r.enunciado || '', 200);
                var cardId = r.sid + '_' + r.idx;
                var visitadaClass = visited[cardId] ? ' buscador-card-visitada' : '';
                html += '<div class="buscador-card tipo-opcion' + visitadaClass + '" data-buscador-card-id="' + cardId + '" onclick="irAPreguntaDesdeBuscador(\'' + r.sid + '\',' + r.idx + ')" title="Ir a esta pregunta">' +
                    '<div class="buscador-card-meta">' +
                        '<span class="badge-tipo opcion">Opci\u00f3n ' + r.letra + '</span>' +
                        '<span class="badge-examen">IAR ' + escapeHtml(r.examen) + '</span>' +
                        '<span class="badge-pregunta">Pregunta N\u00b0 ' + r.num + '</span>' +
                        (visited[cardId] ? '<span class="badge-visitada">✓ Visitada</span>' : '') +
                        '<span class="badge-ir">\u2192 Ir a la pregunta</span>' +
                    '</div>' +
                    '<div class="buscador-card-texto">' + resaltarTexto(r.texto, query) + '</div>' +
                    (enunciadoCorto ? '<div class="buscador-card-enunciado-ref">\ud83d\udccb Enunciado: ' + escapeHtml(enunciadoCorto) + '</div>' : '') +
                '</div>';
            });
        }

        resDiv.innerHTML = html;
    } // fin _ejecutarBusqueda

})();
