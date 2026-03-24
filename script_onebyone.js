/* ============================================================
   script_onebyone.js  —  Modo Una Pregunta Por Vez
   
   CÓMO INTEGRAR:
   1) Agregar este script DESPUÉS de script.js en index.html:
      <script src="script_onebyone.js"></script>

   2) En index.html, reemplazar la llamada a generarCuestionario
      por la versión monkey-patched que hace esto automáticamente.
      Este módulo lo hace solo al cargarse — no requiere cambios
      en index.html ni en script.js (salvo un pequeño override).
   
   FUNCIONAMIENTO:
   - Para secciones IAR (que empiezan con 'iar') y para 'simulador',
     muestra UNA pregunta por vez con navegación Anterior / Siguiente.
   - Para el resto (cuestionarios no-IAR) mantiene el comportamiento
     original (todas las preguntas en lista).
   - Toda la lógica de responder, colorear opciones, explicación,
     puntaje y resultado final se DELEGA al script.js original.
   - Solo se modifica el RENDER: en vez de renderizar todas las
     preguntas en el DOM al mismo tiempo, se inyecta una sola pregunta
     y se navega con botones Anterior / Siguiente.
   ============================================================ */

(function () {
  'use strict';

  /* ── Inyectar estilos ── */
  const STYLE_ID = 'iar-onebyone-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* ────────────────────────────────────────────────
         IMPORTAR FUENTES
      ──────────────────────────────────────────────── */
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap');

      /* ────────────────────────────────────────────────
         WRAPPER MODO UNO POR VEZ
      ──────────────────────────────────────────────── */
      .oav-wrapper {
        font-family: 'DM Sans', system-ui, sans-serif;
        max-width: 780px;
        margin: 0 auto;
        padding: 0 0 48px;
        --oav-blue:    #2563eb;
        --oav-blue-dk: #1d4ed8;
        --oav-blue-lt: #eff6ff;
        --oav-green:   #059669;
        --oav-green-lt:#ecfdf5;
        --oav-red:     #dc2626;
        --oav-red-lt:  #fff1f2;
        --oav-gold:    #d97706;
        --oav-border:  #e2e8f0;
        --oav-text:    #1e293b;
        --oav-muted:   #64748b;
        --oav-radius:  14px;
        --oav-shadow:  0 4px 24px rgba(37,99,235,0.08), 0 1px 4px rgba(0,0,0,0.06);
      }

      /* ────────────────────────────────────────────────
         CABECERA DE PROGRESO
      ──────────────────────────────────────────────── */
      .oav-header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 22px;
        padding: 18px 22px;
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
      }

      /* Contador numérico */
      .oav-counter {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        min-width: 52px;
      }
      .oav-counter-num {
        font-size: 1.65rem;
        font-weight: 700;
        color: var(--oav-blue);
        line-height: 1;
        letter-spacing: -0.5px;
      }
      .oav-counter-total {
        font-size: 0.75rem;
        color: var(--oav-muted);
        font-weight: 500;
      }

      /* Separador vertical */
      .oav-header-divider {
        width: 1px;
        height: 36px;
        background: var(--oav-border);
        flex-shrink: 0;
      }

      /* Columna central (barra + stats) */
      .oav-progress-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Chips de estadísticas */
      .oav-stats {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .oav-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 10px;
        border-radius: 100px;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .oav-chip-correct {
        background: var(--oav-green-lt);
        color: var(--oav-green);
        border: 1px solid #a7f3d0;
      }
      .oav-chip-wrong {
        background: var(--oav-red-lt);
        color: var(--oav-red);
        border: 1px solid #fecaca;
      }
      .oav-chip-pending {
        background: #f1f5f9;
        color: var(--oav-muted);
        border: 1px solid #e2e8f0;
      }

      /* Barra de progreso segmentada */
      .oav-bar-track {
        width: 100%;
        height: 8px;
        background: #f1f5f9;
        border-radius: 100px;
        overflow: hidden;
        position: relative;
      }
      .oav-bar-fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        border-radius: 100px;
        transition: width 0.45s cubic-bezier(.4,0,.2,1);
      }
      .oav-bar-correct  { background: linear-gradient(90deg, #059669, #34d399); }
      .oav-bar-wrong    { background: linear-gradient(90deg, #dc2626, #f87171); }
      .oav-bar-answered { background: linear-gradient(90deg, #2563eb, #60a5fa); }

      /* Ícono de estado derecho */
      .oav-status-icon {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        transition: all 0.3s ease;
      }
      .oav-status-unanswered {
        background: #f1f5f9;
        border: 2px dashed #cbd5e1;
      }
      .oav-status-correct {
        background: var(--oav-green-lt);
        border: 2px solid #34d399;
      }
      .oav-status-wrong {
        background: var(--oav-red-lt);
        border: 2px solid #f87171;
      }

      /* ────────────────────────────────────────────────
         TARJETA DE PREGUNTA
      ──────────────────────────────────────────────── */
      .oav-card {
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
        overflow: hidden;
        animation: oav-slide-in 0.28s cubic-bezier(.4,0,.2,1);
      }
      @keyframes oav-slide-in {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .oav-card-body {
        padding: 28px 30px 22px;
      }

      /* Enunciado */
      .oav-question-text {
        font-family: 'Lora', Georgia, serif;
        font-size: 1.08rem;
        line-height: 1.72;
        color: var(--oav-text);
        margin-bottom: 24px;
      }

      /* Imagen de pregunta */
      .oav-question-img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        border: 1px solid var(--oav-border);
        margin: 0 auto 22px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        transition: opacity 0.2s;
      }
      .oav-question-img:hover { opacity: 0.88; }

      /* Opciones */
      .oav-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 0;
      }

      .oav-option {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 13px 16px;
        border-radius: 10px;
        border: 1.5px solid var(--oav-border);
        background: #fafafa;
        cursor: pointer;
        transition: all 0.18s ease;
        position: relative;
        user-select: none;
      }
      .oav-option:hover:not(.oav-option-disabled) {
        border-color: var(--oav-blue);
        background: var(--oav-blue-lt);
        transform: translateX(2px);
      }
      .oav-option.oav-option-selected:not(.oav-option-disabled) {
        border-color: var(--oav-blue);
        background: var(--oav-blue-lt);
      }
      .oav-option.oav-option-correct {
        border-color: #059669 !important;
        background: var(--oav-green-lt) !important;
      }
      .oav-option.oav-option-wrong {
        border-color: #dc2626 !important;
        background: var(--oav-red-lt) !important;
      }
      .oav-option.oav-option-disabled {
        cursor: default;
      }

      /* Letra de opción (A, B, C…) */
      .oav-option-letter {
        flex-shrink: 0;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 1.5px solid currentColor;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--oav-muted);
        transition: all 0.18s ease;
        margin-top: 1px;
      }
      .oav-option:hover:not(.oav-option-disabled) .oav-option-letter,
      .oav-option.oav-option-selected .oav-option-letter {
        color: var(--oav-blue);
        border-color: var(--oav-blue);
        background: var(--oav-blue-lt);
      }
      .oav-option.oav-option-correct .oav-option-letter {
        color: var(--oav-green) !important;
        border-color: var(--oav-green) !important;
        background: #d1fae5 !important;
      }
      .oav-option.oav-option-wrong .oav-option-letter {
        color: var(--oav-red) !important;
        border-color: var(--oav-red) !important;
        background: #fee2e2 !important;
      }

      /* Input oculto */
      .oav-option input[type="radio"],
      .oav-option input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        pointer-events: none;
        width: 0; height: 0;
      }

      /* Texto de opción */
      .oav-option-text {
        flex: 1;
        font-size: 0.95rem;
        line-height: 1.55;
        color: var(--oav-text);
      }

      /* Ícono resultado por opción */
      .oav-option-icon {
        flex-shrink: 0;
        font-size: 1rem;
        margin-top: 2px;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .oav-option.oav-option-correct .oav-option-icon,
      .oav-option.oav-option-wrong    .oav-option-icon {
        opacity: 1;
      }

      /* ── Resultado inline (correcto/incorrecto) ── */
      .oav-result-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: 100px;
        font-size: 0.82rem;
        font-weight: 700;
        margin-top: 16px;
        letter-spacing: 0.02em;
        animation: oav-pop 0.3s cubic-bezier(.4,0,.2,1);
      }
      @keyframes oav-pop {
        from { opacity: 0; transform: scale(0.85); }
        to   { opacity: 1; transform: scale(1); }
      }
      .oav-result-correct {
        background: var(--oav-green-lt);
        color: var(--oav-green);
        border: 1.5px solid #a7f3d0;
      }
      .oav-result-wrong {
        background: var(--oav-red-lt);
        color: var(--oav-red);
        border: 1.5px solid #fecaca;
      }

      /* ────────────────────────────────────────────────
         PIE DE TARJETA (botón responder + explicación)
      ──────────────────────────────────────────────── */
      .oav-card-footer {
        padding: 16px 30px 24px;
        border-top: 1px solid var(--oav-border);
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #fafbfc;
      }

      .oav-btn-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .oav-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 10px 22px;
        border-radius: 8px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.18s ease;
        letter-spacing: 0.01em;
      }
      .oav-btn:active { transform: scale(0.97); }

      .oav-btn-primary {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        box-shadow: 0 2px 8px rgba(37,99,235,0.28);
      }
      .oav-btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
        box-shadow: 0 4px 12px rgba(37,99,235,0.38);
        transform: translateY(-1px);
      }
      .oav-btn-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }

      .oav-btn-ghost {
        background: transparent;
        color: var(--oav-blue);
        border: 1.5px solid var(--oav-blue);
      }
      .oav-btn-ghost:hover {
        background: var(--oav-blue-lt);
      }

      /* Bloque de explicación */
      .oav-explanation {
        padding: 14px 18px;
        border-radius: 10px;
        background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
        border-left: 3px solid var(--oav-blue);
        animation: oav-slide-in 0.3s ease;
      }
      .oav-explanation-title {
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--oav-blue);
        margin-bottom: 7px;
      }
      .oav-explanation-text {
        font-size: 0.93rem;
        line-height: 1.65;
        color: var(--oav-text);
        margin: 0;
      }
      .oav-explanation img {
        display: block;
        max-width: 100%;
        border-radius: 8px;
        margin-top: 12px;
        cursor: pointer;
        border: 1px solid var(--oav-border);
      }

      /* ────────────────────────────────────────────────
         NAVEGACIÓN INFERIOR (Anterior / Siguiente)
      ──────────────────────────────────────────────── */
      .oav-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 18px;
      }

      .oav-nav-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 11px 24px;
        border-radius: 10px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.92rem;
        font-weight: 600;
        cursor: pointer;
        border: 1.5px solid var(--oav-border);
        background: #fff;
        color: var(--oav-text);
        transition: all 0.18s ease;
        box-shadow: var(--oav-shadow);
      }
      .oav-nav-btn:hover:not(:disabled) {
        border-color: var(--oav-blue);
        color: var(--oav-blue);
        background: var(--oav-blue-lt);
        transform: translateY(-1px);
      }
      .oav-nav-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }
      .oav-nav-btn-next {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        border-color: transparent;
        box-shadow: 0 2px 8px rgba(37,99,235,0.28);
      }
      .oav-nav-btn-next:hover:not(:disabled) {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
        color: #fff;
        border-color: transparent;
        box-shadow: 0 4px 12px rgba(37,99,235,0.38);
        transform: translateY(-1px);
      }

      /* Mini-mapa de preguntas */
      .oav-minimap {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: center;
      }
      .oav-dot {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid var(--oav-border);
        background: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--oav-muted);
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
      }
      .oav-dot:hover { border-color: var(--oav-blue); color: var(--oav-blue); transform: scale(1.12); }
      .oav-dot-current { border-color: var(--oav-blue); background: var(--oav-blue); color: #fff; }
      .oav-dot-correct { border-color: var(--oav-green); background: var(--oav-green-lt); color: var(--oav-green); }
      .oav-dot-wrong   { border-color: var(--oav-red);   background: var(--oav-red-lt);   color: var(--oav-red); }

      /* ────────────────────────────────────────────────
         PANTALLA FINAL (resultado total)
      ──────────────────────────────────────────────── */
      .oav-result-screen {
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
        padding: 40px 36px;
        text-align: center;
        animation: oav-slide-in 0.35s ease;
      }
      .oav-result-icon {
        font-size: 3.5rem;
        margin-bottom: 12px;
        line-height: 1;
      }
      .oav-result-score {
        font-size: 2.8rem;
        font-weight: 700;
        color: var(--oav-blue);
        letter-spacing: -1px;
        line-height: 1;
        margin-bottom: 4px;
      }
      .oav-result-label {
        font-size: 0.9rem;
        color: var(--oav-muted);
        font-weight: 500;
        margin-bottom: 24px;
      }
      .oav-result-bar-wrap {
        height: 10px;
        background: #f1f5f9;
        border-radius: 100px;
        overflow: hidden;
        margin-bottom: 24px;
        max-width: 320px;
        margin-left: auto;
        margin-right: auto;
      }
      .oav-result-bar-fill {
        height: 100%;
        border-radius: 100px;
        transition: width 1s cubic-bezier(.4,0,.2,1);
      }
      .oav-result-phrase {
        font-size: 1rem;
        line-height: 1.65;
        color: var(--oav-text);
        background: var(--oav-blue-lt);
        border-left: 3px solid var(--oav-blue);
        border-radius: 8px;
        padding: 14px 18px;
        text-align: left;
        margin-bottom: 28px;
      }
      .oav-result-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
      }

      /* ────────────────────────────────────────────────
         RESPONSIVE
      ──────────────────────────────────────────────── */
      @media (max-width: 540px) {
        .oav-card-body { padding: 20px 18px 16px; }
        .oav-card-footer { padding: 14px 18px 20px; }
        .oav-question-text { font-size: 0.98rem; }
        .oav-header { padding: 14px 16px; gap: 10px; }
        .oav-counter-num { font-size: 1.35rem; }
        .oav-nav { flex-wrap: wrap; }
        .oav-nav-btn { flex: 1; min-width: 120px; justify-content: center; }
        .oav-result-screen { padding: 28px 18px; }
        .oav-result-score { font-size: 2.2rem; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────
     ESTADO DEL MODO UNO POR VEZ
     (cada clave = seccionId, valor = {currentIdx, total})
  ───────────────────────────────────────────────────────── */
  const oavState = {};

  /* ─────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────── */
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function isOAVSection(seccionId) {
    if (!seccionId) return false;
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    const esSimulacro = seccionId === 'simulador' || seccionId === 'simulacro_iar';
    return esIAR || esSimulacro;
  }

  function getQuizState(seccionId) {
    // Access the state stored by script.js via its STORAGE_KEY
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      if (!raw) return null;
      const all = JSON.parse(raw);
      return all[seccionId] || null;
    } catch (e) { return null; }
  }

  function getScores(seccionId) {
    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      return window.puntajesPorSeccion[seccionId];
    }
    return [];
  }

  function getQuestionStatus(seccionId, originalIdx) {
    const scores = getScores(seccionId);
    const v = scores[originalIdx];
    if (v === null || v === undefined) return 'pending';
    return v === 1 ? 'correct' : 'wrong';
  }

  /* Build the mixed options for a question using shuffleMap from state */
  function getShuffledOptions(seccionId, originalIdx, opciones) {
    const s = getQuizState(seccionId);
    if (s && s.shuffleMap && s.shuffleMap[originalIdx]) {
      const inv = s.shuffleMap[originalIdx];
      const mixed = [];
      Object.keys(inv).sort((a, b) => +a - +b).forEach(k => {
        mixed.push({ text: opciones[inv[k]], originalIndex: inv[k], mixedIndex: +k });
      });
      return mixed;
    }
    // No shuffle yet → original order
    return opciones.map((t, i) => ({ text: t, originalIndex: i, mixedIndex: i }));
  }

  function getRestoredAnswers(seccionId, originalIdx) {
    const s = getQuizState(seccionId);
    if (!s || !s.answers || !s.answers[originalIdx]) return [];
    return s.answers[originalIdx]; // array of mixedIndices
  }

  /* ─────────────────────────────────────────────────────────
     RENDER PRINCIPAL
  ───────────────────────────────────────────────────────── */
  function renderOAV(seccionId) {
    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas || preguntas.length === 0) return;

    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (!cont) return;

    if (!oavState[seccionId]) {
      oavState[seccionId] = { currentIdx: 0, total: preguntas.length };
    } else {
      oavState[seccionId].total = preguntas.length;
    }

    // Find first unanswered question as default start if coming fresh
    const scores = getScores(seccionId);
    const firstUnanswered = preguntas.findIndex((_, i) => {
      const v = scores[i];
      return v === null || v === undefined;
    });
    if (oavState[seccionId].currentIdx === 0 && firstUnanswered > 0) {
      oavState[seccionId].currentIdx = firstUnanswered;
    }

    cont.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'oav-wrapper';
    wrapper.id = `oav-wrapper-${seccionId}`;

    cont.appendChild(wrapper);

    renderOAVPage(seccionId);
  }

  function renderOAVPage(seccionId) {
    const wrapper = document.getElementById(`oav-wrapper-${seccionId}`);
    if (!wrapper) return;
    const preguntas = window.preguntasPorSeccion[seccionId];
    const state = oavState[seccionId];
    const idx = state.currentIdx;
    const total = state.total;
    const preg = preguntas[idx];
    if (!preg) return;

    const scores = getScores(seccionId);
    const answered = scores.filter(v => v !== null && v !== undefined).length;
    const correct  = scores.filter(v => v === 1).length;
    const wrong    = scores.filter(v => v === 0).length;
    const pct      = total > 0 ? (answered / total) * 100 : 0;

    const qStatus = getQuestionStatus(seccionId, idx);
    const isGraded = qStatus !== 'pending';

    /* ── Recuperar selecciones y shuffle ── */
    const shuffled = getShuffledOptions(seccionId, idx, preg.opciones);
    const restoredMixed = getRestoredAnswers(seccionId, idx);

    /* ────────────────────────
       1. HEADER (progreso)
    ──────────────────────── */
    const headerHTML = `
      <div class="oav-header">
        <div class="oav-counter">
          <span class="oav-counter-num">${idx + 1}</span>
          <span class="oav-counter-total">de&nbsp;${total}</span>
        </div>
        <div class="oav-header-divider"></div>
        <div class="oav-progress-col">
          <div class="oav-stats">
            <span class="oav-chip oav-chip-correct">✓ ${correct} correctas</span>
            <span class="oav-chip oav-chip-wrong">✗ ${wrong} incorrectas</span>
            <span class="oav-chip oav-chip-pending">○ ${total - answered} sin responder</span>
          </div>
          <div class="oav-bar-track">
            <div class="oav-bar-fill ${
              correct > 0 ? 'oav-bar-correct' : (wrong > 0 ? 'oav-bar-wrong' : 'oav-bar-answered')
            }" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="oav-status-icon ${
          qStatus === 'correct' ? 'oav-status-correct' :
          qStatus === 'wrong'   ? 'oav-status-wrong'   :
          'oav-status-unanswered'
        }">
          ${qStatus === 'correct' ? '✓' : qStatus === 'wrong' ? '✗' : '?'}
        </div>
      </div>`;

    /* ────────────────────────
       2. OPCIONES HTML
    ──────────────────────── */
    const tipoInput = preg.multiple ? 'checkbox' : 'radio';
    let opcionesHTML = '';
    shuffled.forEach((opt, mi) => {
      const isSelected = restoredMixed.includes(opt.mixedIndex);
      
      // Determine option state when graded
      let optClass = '';
      let optIcon  = '';
      if (isGraded) {
        const qs = getQuizState(seccionId);
        const inv = qs && qs.shuffleMap && qs.shuffleMap[idx];
        if (inv) {
          const isCorrectOpt = preg.correcta.includes(opt.originalIndex);
          const isSelectedOpt = restoredMixed.includes(opt.mixedIndex);
          if (isCorrectOpt) { optClass = 'oav-option-correct'; optIcon = '✓'; }
          else if (isSelectedOpt && !isCorrectOpt) { optClass = 'oav-option-wrong'; optIcon = '✗'; }
        }
      } else if (isSelected) {
        optClass = 'oav-option-selected';
      }

      const disabledClass = isGraded ? ' oav-option-disabled' : '';

      opcionesHTML += `
        <label class="oav-option ${optClass}${disabledClass}" 
               data-mixed="${opt.mixedIndex}" data-original="${opt.originalIndex}"
               for="oav-opt-${seccionId}-${idx}-${mi}">
          <input 
            type="${tipoInput}"
            id="oav-opt-${seccionId}-${idx}-${mi}"
            name="pregunta${seccionId}${idx}"
            value="${opt.mixedIndex}"
            data-original-index="${opt.originalIndex}"
            ${isSelected ? 'checked' : ''}
            ${isGraded ? 'disabled' : ''}
          >
          <span class="oav-option-letter">${LETTERS[mi]}</span>
          <span class="oav-option-text">${escapeHTML(opt.text)}</span>
          <span class="oav-option-icon">${optIcon}</span>
        </label>`;
    });

    /* ────────────────────────
       3. RESULTADO + EXPLICACION
    ──────────────────────── */
    let resultBadgeHTML = '';
    if (isGraded) {
      if (qStatus === 'correct') {
        resultBadgeHTML = `<span class="oav-result-badge oav-result-correct">✓ Correcto (+1)</span>`;
      } else {
        resultBadgeHTML = `<span class="oav-result-badge oav-result-wrong">✗ Incorrecto (0)</span>`;
      }
    }

    // Retrieve saved explanation state
    const qs = getQuizState(seccionId);
    const expShown = qs && qs.explanationShown && qs.explanationShown[idx];

    let explicacionHTML = '';
    if (preg.explicacion && preg.explicacion.trim() !== '') {
      const expContent = expShown ? `
        <div class="oav-explanation" id="oav-exp-${seccionId}-${idx}">
          <div class="oav-explanation-title">💡 Explicación</div>
          <p class="oav-explanation-text">${escapeHTML(preg.explicacion)}</p>
          ${preg.imagen_explicacion ? `<img src="${preg.imagen_explicacion}" alt="Imagen de la explicación" onclick="window.open(this.src,'_blank')" title="Clic para ampliar">` : ''}
        </div>` : '';

      const expBtnText = expShown ? 'Ocultar explicación' : 'Ver explicación';
      const expBtnDisabled = !isGraded ? 'disabled' : '';
      explicacionHTML = `
        <button class="oav-btn oav-btn-ghost" id="oav-btn-exp-${seccionId}-${idx}"
                ${expBtnDisabled}
                onclick="window._oavToggleExplicacion('${seccionId}',${idx})">
          💬 ${expBtnText}
        </button>
        ${expContent}`;
    }

    /* ────────────────────────
       4. MINI-MAPA
    ──────────────────────── */
    let minimapHTML = '<div class="oav-minimap">';
    for (let i = 0; i < total; i++) {
      const st = getQuestionStatus(seccionId, i);
      const dotClass = i === idx ? 'oav-dot-current' :
                       st === 'correct' ? 'oav-dot-correct' :
                       st === 'wrong'   ? 'oav-dot-wrong'   : '';
      minimapHTML += `<div class="oav-dot ${dotClass}" 
                           title="Pregunta ${i+1}"
                           onclick="window._oavGoTo('${seccionId}',${i})">${i+1}</div>`;
    }
    minimapHTML += '</div>';

    /* ────────────────────────
       5. ENSAMBLADO COMPLETO
    ──────────────────────── */
    wrapper.innerHTML = headerHTML + `
      <div class="oav-card">
        <div class="oav-card-body">
          <div class="oav-question-text">
            <strong style="font-size:0.78rem;font-family:'DM Sans',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--oav-blue);display:block;margin-bottom:10px;">
              Pregunta ${idx + 1}
            </strong>
            ${escapeHTML(preg.pregunta)}
          </div>
          ${preg.imagen ? `<img class="oav-question-img" src="${preg.imagen}" alt="Imagen ECG" onclick="window.open(this.src,'_blank')" title="Clic para ampliar">` : ''}
          <div class="oav-options" id="oav-options-${seccionId}-${idx}">
            ${opcionesHTML}
          </div>
          ${resultBadgeHTML}
        </div>
        <div class="oav-card-footer">
          <div class="oav-btn-row">
            <button class="oav-btn oav-btn-primary" id="oav-btn-responder-${seccionId}-${idx}"
                    ${isGraded ? 'disabled' : ''}
                    onclick="window._oavResponder('${seccionId}',${idx})">
              ✓ Responder
            </button>
            ${explicacionHTML}
          </div>
        </div>
      </div>

      <div class="oav-nav">
        <button class="oav-nav-btn" 
                ${idx === 0 ? 'disabled' : ''}
                onclick="window._oavGoTo('${seccionId}',${idx - 1})">
          ← Anterior
        </button>
        ${minimapHTML}
        <button class="oav-nav-btn oav-nav-btn-next"
                ${idx === total - 1 ? 'disabled' : ''}
                onclick="window._oavGoTo('${seccionId}',${idx + 1})">
          Siguiente →
        </button>
      </div>
    `;

    /* ── Conectar change listeners para persistencia ── */
    const optContainer = document.getElementById(`oav-options-${seccionId}-${idx}`);
    if (optContainer && !isGraded) {
      optContainer.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
          // Actualizar clases visuales
          optContainer.querySelectorAll('.oav-option').forEach(lbl => {
            lbl.classList.remove('oav-option-selected');
          });
          if (tipoInput === 'radio') {
            inp.closest('.oav-option').classList.add('oav-option-selected');
          } else {
            optContainer.querySelectorAll('input:checked').forEach(ci => {
              ci.closest('.oav-option').classList.add('oav-option-selected');
            });
          }
          // Persistir vía el sistema original
          if (window._persistSelectionsForQuestion) {
            window._persistSelectionsForQuestion(seccionId, idx);
          } else {
            // Fallback: guardar directamente
            _persistAnswers(seccionId, idx);
          }
        });
      });
    }
  }

  /* ─────────────────────────────────────────────────────────
     FUNCIÓN: Persistir respuestas (fallback si no expuesta)
  ───────────────────────────────────────────────────────── */
  function _persistAnswers(seccionId, qIndex) {
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      if (!raw) return;
      const all = JSON.parse(raw);
      if (!all[seccionId]) return;
      const name = `pregunta${seccionId}${qIndex}`;
      const inputs = Array.from(document.getElementsByName(name));
      const sel = inputs.map((inp, i) => inp.checked ? i : null).filter(v => v !== null);
      if (!all[seccionId].answers) all[seccionId].answers = {};
      all[seccionId].answers[qIndex] = sel;
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));
    } catch (e) {}
  }

  /* ─────────────────────────────────────────────────────────
     ACCIONES GLOBALES (llamadas desde HTML inline)
  ───────────────────────────────────────────────────────── */

  /** Ir a una pregunta específica */
  window._oavGoTo = function (seccionId, idx) {
    const st = oavState[seccionId];
    if (!st) return;
    const total = (window.preguntasPorSeccion[seccionId] || []).length;
    if (idx < 0 || idx >= total) return;
    st.currentIdx = idx;
    renderOAVPage(seccionId);
    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** Responder la pregunta actual delegando al sistema original */
  window._oavResponder = function (seccionId, qIndex) {
    // Delegate to the original responderPregunta exposed via script.js.
    // script.js doesn't expose it globally; we trigger via the hidden DOM
    // element that script.js uses internally. Instead, we replicate the minimal
    // logic here so the result is written to localStorage and puntajesPorSeccion,
    // then re-render.

    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas) return;
    const preg = preguntas[qIndex];

    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));
    const selMixed = inputs.map((inp, i) => inp.checked ? i : null).filter(v => v !== null);

    if (selMixed.length === 0) {
      // Visual feedback instead of alert
      const card = document.querySelector(`#oav-wrapper-${seccionId} .oav-card`);
      if (card) {
        card.style.boxShadow = '0 0 0 2px #dc2626, 0 4px 24px rgba(220,38,38,0.15)';
        setTimeout(() => { card.style.boxShadow = ''; }, 900);
      }
      return;
    }

    /* Freeze shuffle for this question (replicating script.js logic) */
    let inv = null;
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (!all[seccionId]) all[seccionId] = { shuffleMap: {}, answers: {}, graded: {}, explanationShown: {} };

      // Build inv from DOM if not already frozen
      if (!all[seccionId].shuffleMap) all[seccionId].shuffleMap = {};
      if (!all[seccionId].shuffleMap[qIndex]) {
        const invBuild = {};
        inputs.forEach((inp, mi) => {
          invBuild[mi] = parseInt(inp.getAttribute('data-original-index'), 10);
        });
        all[seccionId].shuffleMap[qIndex] = invBuild;
        all[seccionId].shuffleFrozen = true;
      }
      inv = all[seccionId].shuffleMap[qIndex];

      // Compute correctness
      const selOriginal = selMixed.map(i => inv[i]).sort((a,b)=>a-b);
      const correctOriginal = preg.correcta.slice().sort((a,b)=>a-b);
      const isCorrect = JSON.stringify(selOriginal) === JSON.stringify(correctOriginal);

      // Save
      if (!all[seccionId].answers) all[seccionId].answers = {};
      all[seccionId].answers[qIndex] = selMixed;
      if (!all[seccionId].graded) all[seccionId].graded = {};
      all[seccionId].graded[qIndex] = true;
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));

      // Update puntajesPorSeccion
      if (!window.puntajesPorSeccion) window.puntajesPorSeccion = {};
      if (!window.puntajesPorSeccion[seccionId]) {
        window.puntajesPorSeccion[seccionId] = Array(preguntas.length).fill(null);
      }
      window.puntajesPorSeccion[seccionId][qIndex] = isCorrect ? 1 : 0;

      // Start simulacro timer if needed
      if (seccionId === 'simulador') {
        const firstAnswer = Object.keys(all[seccionId].graded).filter(k => all[seccionId].graded[k]).length;
        if (firstAnswer === 1 && typeof window.iniciarTemporizador === 'function') {
          window.iniciarTemporizador && window.iniciarTemporizador();
        }
      }

      // Re-render current card to show result
      renderOAVPage(seccionId);

      // Auto-advance to next unanswered question after 1.2s
      const total = preguntas.length;
      const nextUnanswered = _findNextUnanswered(seccionId, qIndex, total);

      // Check if all answered
      const allAnswered = window.puntajesPorSeccion[seccionId].every(
        v => v !== null && v !== undefined
      );

      if (allAnswered) {
        setTimeout(() => _mostrarResultadoFinalOAV(seccionId), 600);
      }

    } catch (e) {
      console.error('[OAV] Error al responder:', e);
    }
  };

  function _findNextUnanswered(seccionId, fromIdx, total) {
    const scores = getScores(seccionId);
    // Search forward from current position
    for (let i = fromIdx + 1; i < total; i++) {
      const v = scores[i];
      if (v === null || v === undefined) return i;
    }
    // Wrap around
    for (let i = 0; i < fromIdx; i++) {
      const v = scores[i];
      if (v === null || v === undefined) return i;
    }
    return null;
  }

  /** Toggle explicación */
  window._oavToggleExplicacion = function (seccionId, qIndex) {
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (!all[seccionId]) return;
      if (!all[seccionId].explanationShown) all[seccionId].explanationShown = {};
      all[seccionId].explanationShown[qIndex] = !all[seccionId].explanationShown[qIndex];
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));
      renderOAVPage(seccionId);
    } catch (e) {}
  };

  /* ─────────────────────────────────────────────────────────
     RESULTADO FINAL (pantalla de cierre)
  ───────────────────────────────────────────────────────── */
  function _mostrarResultadoFinalOAV(seccionId) {
    const preguntas = window.preguntasPorSeccion[seccionId] || [];
    const total = preguntas.length;
    const scores = getScores(seccionId);
    const totalScore = scores.reduce((a, b) => a + (b || 0), 0);
    const pct = total > 0 ? (totalScore / total) * 100 : 0;

    const barColor = pct >= 70 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';

    // Get motivational phrase from script.js if available
    let frase = '';
    if (window._getFraseMotivacional) {
      frase = window._getFraseMotivacional(totalScore, total);
    } else {
      frase = _localFrase(pct);
    }

    // Mark totalShown in state
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (all[seccionId]) {
        all[seccionId].totalShown = true;
        localStorage.setItem('quiz_state_v3', JSON.stringify(all));
      }
    } catch(e) {}

    // Trigger the original's auto-checkmark + attemptLog
    const resultNode = document.getElementById(`resultado-total-${seccionId}`);
    if (resultNode && !resultNode.dataset.oavFired) {
      resultNode.dataset.oavFired = '1';
      // Trigger original mostrarResultadoFinal silently
      if (typeof window.mostrarResultadoFinal === 'function') {
        window.mostrarResultadoFinal(seccionId);
      }
    }

    const icon = pct === 100 ? '🏆' : pct >= 70 ? '🌟' : pct >= 50 ? '💪' : '📚';

    const wrapper = document.getElementById(`oav-wrapper-${seccionId}`);
    if (!wrapper) return;
    wrapper.innerHTML = `
      <div class="oav-result-screen">
        <div class="oav-result-icon">${icon}</div>
        <div class="oav-result-score">${totalScore}<span style="font-size:1.2rem;color:#94a3b8;font-weight:500"> / ${total}</span></div>
        <div class="oav-result-label">${Math.round(pct)}% de respuestas correctas</div>
        <div class="oav-result-bar-wrap">
          <div class="oav-result-bar-fill" style="width:0%;background:${barColor}" 
               id="oav-result-bar-${seccionId}"></div>
        </div>
        <div class="oav-result-phrase">${frase}</div>
        <div class="oav-result-actions">
          <button class="oav-btn oav-btn-primary"
                  onclick="window._oavRevisar('${seccionId}')">
            🔍 Revisar respuestas
          </button>
          <button class="oav-btn oav-btn-ghost"
                  onclick="window._oavReiniciar('${seccionId}')">
            🔄 Nuevo intento
          </button>
        </div>
      </div>`;

    // Animate bar
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const bar = document.getElementById(`oav-result-bar-${seccionId}`);
        if (bar) bar.style.width = pct + '%';
      });
    });

    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  window._oavRevisar = function (seccionId) {
    if (!oavState[seccionId]) oavState[seccionId] = { total: 0 };
    oavState[seccionId].currentIdx = 0;
    renderOAVPage(seccionId);
  };

  window._oavReiniciar = function (seccionId) {
    if (typeof window.reiniciarExamen === 'function') {
      window.reiniciarExamen(seccionId);
    } else {
      // Fallback: clear state and re-render
      try {
        const raw = localStorage.getItem('quiz_state_v3');
        const all = JSON.parse(raw || '{}');
        delete all[seccionId];
        localStorage.setItem('quiz_state_v3', JSON.stringify(all));
      } catch(e) {}
      if (window.puntajesPorSeccion) {
        const preguntas = window.preguntasPorSeccion[seccionId] || [];
        window.puntajesPorSeccion[seccionId] = Array(preguntas.length).fill(null);
      }
      if (oavState[seccionId]) oavState[seccionId].currentIdx = 0;
      renderOAV(seccionId);
    }
  };

  function _localFrase(pct) {
    if (pct === 100) return '🏆 ¡Perfecto! Dominás cada concepto con maestría.';
    if (pct >= 91)  return '🌟 ¡Excelente resultado! Estás muy cerca de la cima.';
    if (pct >= 81)  return '💪 ¡Muy bien! Tu preparación es sólida.';
    if (pct >= 71)  return '📈 ¡Buen trabajo! Tenés una base firme.';
    if (pct >= 61)  return '🔍 Vas por buen camino. Cada error es una oportunidad de aprendizaje.';
    if (pct >= 51)  return '🌱 Estás en la mitad del camino. La medicina se aprende paso a paso.';
    if (pct >= 41)  return '🔥 No te rindas. Los mejores médicos también tuvieron momentos difíciles.';
    if (pct >= 31)  return '💡 Este resultado te muestra exactamente dónde enfocar tu energía.';
    return '🌅 Cada experto fue alguna vez un principiante. ¡Volvé a intentarlo!';
  }

  /* ─────────────────────────────────────────────────────────
     ESCAPE HTML
  ───────────────────────────────────────────────────────── */
  function escapeHTML(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ─────────────────────────────────────────────────────────
     MONKEY-PATCH: reemplazar generarCuestionario para secciones OAV
     Se hace con un pequeño retardo para asegurarse de que script.js
     ya cargó y definió la función en window.
  ───────────────────────────────────────────────────────── */
  function patchGenerarCuestionario() {
    // We intercept at the container level: when showSection calls
    // generarCuestionario for an OAV section, we also call renderOAV.
    // The cleanest approach: override window.generarCuestionario if exposed,
    // OR hook into the MutationObserver on each cuestionario container.

    // Strategy: override via closure using a wrapper stored on window
    if (window._oavPatched) return;
    window._oavPatched = true;

    // Hook: observe mutations on .pagina-cuestionario containers
    // When they become active, check if they should use OAV mode
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const el = mutation.target;
          if (el.classList.contains('activa')) {
            const seccionId = el.id;
            if (isOAVSection(seccionId)) {
              // Small delay to let generarCuestionario finish
              setTimeout(() => {
                const cont = document.getElementById(`cuestionario-${seccionId}`);
                if (cont && cont.querySelector('.pregunta')) {
                  // Original rendered all-at-once; replace with OAV
                  oavState[seccionId] = { currentIdx: 0, total: 0 };
                  renderOAV(seccionId);
                } else if (cont && window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId]) {
                  renderOAV(seccionId);
                }
              }, 80);
            }
          }
        }
      });
    });

    document.querySelectorAll('.pagina-cuestionario').forEach(page => {
      observer.observe(page, { attributes: true });
    });

    // Also intercept future pagina-cuestionario elements
    const bodyObserver = new MutationObserver(() => {
      document.querySelectorAll('.pagina-cuestionario:not([data-oav-observed])').forEach(page => {
        page.setAttribute('data-oav-observed', '1');
        observer.observe(page, { attributes: true });
      });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    // Override generarCuestionario if accessible on window
    if (typeof window.generarCuestionario === 'function') {
      const original = window.generarCuestionario;
      window.generarCuestionario = function(seccionId) {
        original(seccionId);
        if (isOAVSection(seccionId)) {
          setTimeout(() => {
            oavState[seccionId] = { currentIdx: 0, total: 0 };
            renderOAV(seccionId);
          }, 50);
        }
      };
    }

    // Override reiniciarExamen to reset OAV state
    if (typeof window.reiniciarExamen === 'function') {
      const origReinit = window.reiniciarExamen;
      window.reiniciarExamen = function(seccionId) {
        origReinit(seccionId);
        if (isOAVSection(seccionId) && oavState[seccionId]) {
          oavState[seccionId].currentIdx = 0;
          setTimeout(() => renderOAV(seccionId), 80);
        }
      };
    }
  }

  // Wait for DOM + script.js to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchGenerarCuestionario);
  } else {
    // Already loaded; patch after a short tick to let script.js initialize
    setTimeout(patchGenerarCuestionario, 100);
  }

  // Expose for external calls
  window._oavRenderOAV = renderOAV;
  window._oavState = oavState;

})();
