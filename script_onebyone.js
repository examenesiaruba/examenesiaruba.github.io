/* ============================================================
   script_onebyone.js  —  Modo Una Pregunta Por Vez
   
   CÓMO INTEGRAR:
   Agregar este script DESPUÉS de script.js en index.html:
      <script src="script.js"></script>
      <script src="script_onebyone.js"></script>
   ============================================================ */

(function () {
  'use strict';

  /* ── Inyectar estilos ── */
  const STYLE_ID = 'iar-onebyone-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap');

      /* ── Variables ── */
      .oav-wrapper {
        font-family: 'DM Sans', system-ui, sans-serif;
        max-width: 780px;
        margin: 0 auto;
        padding: 0 0 32px;
        --oav-blue:    #2563eb;
        --oav-blue-dk: #1d4ed8;
        --oav-blue-lt: #eff6ff;
        --oav-green:   #059669;
        --oav-green-lt:#ecfdf5;
        --oav-red:     #dc2626;
        --oav-red-lt:  #fff1f2;
        --oav-border:  #e2e8f0;
        --oav-text:    #1e293b;
        --oav-muted:   #64748b;
        --oav-radius:  12px;
        --oav-shadow:  0 2px 16px rgba(37,99,235,0.07), 0 1px 3px rgba(0,0,0,0.05);
      }

      /* ── Header de progreso — más compacto ── */
      .oav-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        padding: 10px 14px;
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
      }
      .oav-counter {
        flex-shrink: 0;
        display: flex;
        align-items: baseline;
        gap: 3px;
        min-width: 0;
      }
      .oav-counter-num {
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--oav-blue);
        line-height: 1;
        letter-spacing: -0.5px;
      }
      .oav-counter-total {
        font-size: 0.68rem;
        color: var(--oav-muted);
        font-weight: 500;
        white-space: nowrap;
      }
      .oav-header-divider {
        width: 1px;
        height: 24px;
        background: var(--oav-border);
        flex-shrink: 0;
      }
      .oav-progress-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
      }
      .oav-stats {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }
      .oav-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 7px;
        border-radius: 100px;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        line-height: 1.6;
      }
      .oav-chip-correct  { background: var(--oav-green-lt); color: var(--oav-green); border: 1px solid #a7f3d0; }
      .oav-chip-wrong    { background: var(--oav-red-lt);   color: var(--oav-red);   border: 1px solid #fecaca; }
      .oav-chip-pending  { background: #f1f5f9; color: var(--oav-muted); border: 1px solid #e2e8f0; }
      .oav-bar-track {
        width: 100%;
        height: 5px;
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
      .oav-status-icon {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        font-weight: 700;
        transition: all 0.3s ease;
      }
      .oav-status-unanswered { background: #f1f5f9; border: 2px dashed #cbd5e1; color: #94a3b8; }
      .oav-status-correct    { background: var(--oav-green-lt); border: 2px solid #34d399; color: var(--oav-green); }
      .oav-status-wrong      { background: var(--oav-red-lt);   border: 2px solid #f87171; color: var(--oav-red); }

      /* ── Card principal ── */
      .oav-card {
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
        overflow: hidden;
        animation: oav-slide-in 0.22s cubic-bezier(.4,0,.2,1);
      }
      @keyframes oav-slide-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .oav-card-body { padding: 18px 20px 14px; }
      .oav-question-label {
        font-size: 0.68rem;
        font-family: 'DM Sans', sans-serif;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--oav-blue);
        display: block;
        margin-bottom: 6px;
      }
      .oav-question-text {
        font-family: 'Lora', Georgia, serif;
        font-size: 0.96rem;
        line-height: 1.58;
        color: var(--oav-text);
        margin-bottom: 14px;
      }
      .oav-question-img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        border: 1px solid var(--oav-border);
        margin: 0 auto 14px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.07);
        transition: opacity 0.2s;
      }
      .oav-question-img:hover { opacity: 0.88; }

      /* ── Opciones ── */
      .oav-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 0;
      }
      .oav-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 13px;
        border-radius: 8px;
        border: 1.5px solid var(--oav-border);
        background: #fafafa;
        cursor: pointer;
        transition: all 0.15s ease;
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
      .oav-option.oav-option-disabled { cursor: default; }

      .oav-option-letter {
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1.5px solid #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--oav-muted);
        transition: all 0.15s ease;
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
      .oav-option input[type="radio"],
      .oav-option input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        pointer-events: none;
        width: 0; height: 0;
      }
      .oav-option-text {
        flex: 1;
        font-size: 0.87rem;
        line-height: 1.45;
        color: var(--oav-text);
      }
      .oav-option-icon {
        flex-shrink: 0;
        font-size: 0.85rem;
        opacity: 0;
        transition: opacity 0.2s;
        font-weight: 700;
      }
      .oav-option.oav-option-correct .oav-option-icon { opacity: 1; color: var(--oav-green); }
      .oav-option.oav-option-wrong    .oav-option-icon { opacity: 1; color: var(--oav-red); }

      /* ── Badge resultado ── */
      .oav-result-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 11px;
        border-radius: 100px;
        font-size: 0.75rem;
        font-weight: 700;
        margin-top: 10px;
        letter-spacing: 0.02em;
        animation: oav-pop 0.25s cubic-bezier(.4,0,.2,1);
      }
      @keyframes oav-pop {
        from { opacity: 0; transform: scale(0.88); }
        to   { opacity: 1; transform: scale(1); }
      }
      .oav-result-correct { background: var(--oav-green-lt); color: var(--oav-green); border: 1.5px solid #a7f3d0; }
      .oav-result-wrong   { background: var(--oav-red-lt);   color: var(--oav-red);   border: 1.5px solid #fecaca; }

      /* ── Footer de la card ── */
      .oav-card-footer {
        padding: 11px 20px 16px;
        border-top: 1px solid var(--oav-border);
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #fafbfc;
      }
      .oav-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .oav-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        border-radius: 7px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.15s ease;
        letter-spacing: 0.01em;
      }
      .oav-btn:active { transform: scale(0.97); }
      .oav-btn-primary {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        box-shadow: 0 2px 6px rgba(37,99,235,0.25);
      }
      .oav-btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
        box-shadow: 0 4px 10px rgba(37,99,235,0.32);
        transform: translateY(-1px);
      }
      .oav-btn-primary:disabled { opacity: 0.42; cursor: not-allowed; box-shadow: none; transform: none; }
      .oav-btn-ghost {
        background: transparent;
        color: var(--oav-blue);
        border: 1.5px solid #bfdbfe;
        font-size: 0.81rem;
      }
      .oav-btn-ghost:hover:not(:disabled) { background: var(--oav-blue-lt); border-color: var(--oav-blue); }
      .oav-btn-ghost:disabled { opacity: 0.38; cursor: not-allowed; }

      /* ── Explicación ── */
      .oav-explanation {
        padding: 10px 14px;
        border-radius: 8px;
        background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
        border-left: 3px solid var(--oav-blue);
        animation: oav-slide-in 0.25s ease;
      }
      .oav-explanation-title {
        font-size: 0.67rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--oav-blue);
        margin-bottom: 5px;
      }
      .oav-explanation-text {
        font-size: 0.85rem;
        line-height: 1.58;
        color: var(--oav-text);
        margin: 0;
      }
      .oav-explanation img {
        display: block;
        max-width: 100%;
        border-radius: 6px;
        margin-top: 10px;
        cursor: pointer;
        border: 1px solid var(--oav-border);
      }

      /* ── Navegación ── */
      .oav-nav {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 10px;
      }
      .oav-nav-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 16px;
        border-radius: 8px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        border: 1.5px solid var(--oav-border);
        background: #fff;
        color: var(--oav-text);
        transition: all 0.15s ease;
        box-shadow: var(--oav-shadow);
        white-space: nowrap;
      }
      .oav-nav-btn:hover:not(:disabled) {
        border-color: var(--oav-blue);
        color: var(--oav-blue);
        background: var(--oav-blue-lt);
        transform: translateY(-1px);
      }
      .oav-nav-btn:disabled { opacity: 0.32; cursor: not-allowed; box-shadow: none; transform: none; }
      .oav-nav-btn-next {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        border-color: transparent;
        box-shadow: 0 2px 6px rgba(37,99,235,0.25);
      }
      .oav-nav-btn-next:hover:not(:disabled) {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
        color: #fff;
        border-color: transparent;
        box-shadow: 0 4px 10px rgba(37,99,235,0.32);
        transform: translateY(-1px);
      }

      /* ── Mini-mapa: barra de segmentos horizontal ── */
      .oav-minimap {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 2px;
        overflow: hidden;
        min-width: 0;
      }
      .oav-dot {
        flex: 1;
        height: 6px;
        border-radius: 100px;
        background: #e2e8f0;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        min-width: 4px;
      }
      .oav-dot:hover         { background: #93c5fd; transform: scaleY(1.5); }
      .oav-dot-current       { background: var(--oav-blue); transform: scaleY(1.8); border-radius: 4px; }
      .oav-dot-correct       { background: var(--oav-green); }
      .oav-dot-wrong         { background: var(--oav-red); }
      /* tooltip del número al hacer hover */
      .oav-dot::after {
        content: attr(data-num);
        position: absolute;
        bottom: calc(100% + 5px);
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #fff;
        font-size: 0.6rem;
        font-weight: 700;
        padding: 2px 5px;
        border-radius: 4px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
        font-family: 'DM Sans', sans-serif;
      }
      .oav-dot:hover::after  { opacity: 1; }
      .oav-dot-current::after { opacity: 1; background: var(--oav-blue); }

      /* ── Pantalla resultado final ── */
      .oav-result-screen {
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
        padding: 28px 24px;
        text-align: center;
        animation: oav-slide-in 0.3s ease;
      }
      .oav-result-icon   { font-size: 2.8rem; margin-bottom: 8px; line-height: 1; }
      .oav-result-score  { font-size: 2.2rem; font-weight: 700; color: var(--oav-blue); letter-spacing: -1px; line-height: 1; margin-bottom: 3px; }
      .oav-result-label  { font-size: 0.82rem; color: var(--oav-muted); font-weight: 500; margin-bottom: 18px; }
      .oav-result-bar-wrap {
        height: 8px;
        background: #f1f5f9;
        border-radius: 100px;
        overflow: hidden;
        margin-bottom: 18px;
        max-width: 280px;
        margin-left: auto;
        margin-right: auto;
      }
      .oav-result-bar-fill { height: 100%; border-radius: 100px; transition: width 1s cubic-bezier(.4,0,.2,1); }
      .oav-result-phrase {
        font-size: 0.88rem;
        line-height: 1.6;
        color: var(--oav-text);
        background: var(--oav-blue-lt);
        border-left: 3px solid var(--oav-blue);
        border-radius: 8px;
        padding: 11px 14px;
        text-align: left;
        margin-bottom: 20px;
      }
      .oav-result-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

      /* ── Responsive mobile ── */
      @media (max-width: 540px) {
        .oav-card-body    { padding: 14px 14px 11px; }
        .oav-card-footer  { padding: 9px 14px 13px; }
        .oav-question-text { font-size: 0.91rem; }
        .oav-option-text  { font-size: 0.84rem; }
        .oav-header       { padding: 8px 11px; gap: 8px; }
        .oav-counter-num  { font-size: 1.05rem; }
        .oav-nav-btn      { padding: 8px 12px; font-size: 0.79rem; }
        .oav-result-screen { padding: 20px 14px; }
        .oav-result-score  { font-size: 1.8rem; }
        .oav-dot           { height: 5px; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────
     ESTADO
  ───────────────────────────────────────────────────────── */
  const oavState = {};
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* ─────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────── */
  function isOAVSection(seccionId) {
    if (!seccionId) return false;
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    const esSimulacro = seccionId === 'simulador' || seccionId === 'simulacro_iar';
    return esIAR || esSimulacro;
  }

  function getQuizState(seccionId) {
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      if (!raw) return null;
      return JSON.parse(raw)[seccionId] || null;
    } catch (e) { return null; }
  }

  function getScores(seccionId) {
    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      return window.puntajesPorSeccion[seccionId];
    }
    return [];
  }

  function getQuestionStatus(seccionId, idx) {
    const v = getScores(seccionId)[idx];
    if (v === null || v === undefined) return 'pending';
    return v === 1 ? 'correct' : 'wrong';
  }

  function getShuffledOptions(seccionId, idx, opciones) {
    const s = getQuizState(seccionId);
    if (s && s.shuffleMap && s.shuffleMap[idx]) {
      const inv = s.shuffleMap[idx];
      return Object.keys(inv).sort((a, b) => +a - +b).map(k => ({
        text: opciones[inv[k]], originalIndex: inv[k], mixedIndex: +k
      }));
    }
    return opciones.map((t, i) => ({ text: t, originalIndex: i, mixedIndex: i }));
  }

  function getRestoredAnswers(seccionId, idx) {
    const s = getQuizState(seccionId);
    if (!s || !s.answers || !s.answers[idx]) return [];
    return s.answers[idx];
  }

  function escapeHTML(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ─────────────────────────────────────────────────────────
     RENDER PRINCIPAL
  ───────────────────────────────────────────────────────── */
  function renderOAV(seccionId) {
    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas || preguntas.length === 0) return;

    const cont = document.getElementById('cuestionario-' + seccionId);
    if (!cont) return;

    // Inicializar estado OAV
    if (!oavState[seccionId]) {
      oavState[seccionId] = { currentIdx: 0, total: preguntas.length };
    } else {
      oavState[seccionId].total = preguntas.length;
    }

    // Posicionar en la primera sin responder
    const scores = getScores(seccionId);
    const allAnswered = scores.length === preguntas.length && scores.every(v => v !== null && v !== undefined);
    if (!allAnswered) {
      const firstUnanswered = preguntas.findIndex((_, i) => {
        const v = scores[i];
        return v === null || v === undefined;
      });
      if (firstUnanswered >= 0) {
        oavState[seccionId].currentIdx = firstUnanswered;
      }
    } else {
      oavState[seccionId].currentIdx = 0;
    }

    // Crear wrapper
    cont.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'oav-wrapper';
    wrapper.id = 'oav-wrapper-' + seccionId;
    cont.appendChild(wrapper);

    if (allAnswered) {
      _mostrarResultadoFinalOAV(seccionId);
    } else {
      renderOAVPage(seccionId);
    }
  }

  function renderOAVPage(seccionId) {
    const wrapper = document.getElementById('oav-wrapper-' + seccionId);
    if (!wrapper) return;

    const preguntas = window.preguntasPorSeccion[seccionId];
    const st = oavState[seccionId];
    if (!st) return;

    const idx   = st.currentIdx;
    const total = st.total;
    const preg  = preguntas[idx];
    if (!preg) return;

    const scores   = getScores(seccionId);
    const answered = scores.filter(v => v !== null && v !== undefined).length;
    const correct  = scores.filter(v => v === 1).length;
    const wrong    = scores.filter(v => v === 0).length;
    const pct      = total > 0 ? (answered / total) * 100 : 0;

    const qStatus  = getQuestionStatus(seccionId, idx);
    const isGraded = qStatus !== 'pending';

    const shuffled      = getShuffledOptions(seccionId, idx, preg.opciones);
    const restoredMixed = getRestoredAnswers(seccionId, idx);
    const tipoInput     = preg.multiple ? 'checkbox' : 'radio';
    const qs  = getQuizState(seccionId);
    const inv = qs && qs.shuffleMap && qs.shuffleMap[idx];

    /* ── Header ── */
    const barClass    = correct > 0 ? 'oav-bar-correct' : (wrong > 0 ? 'oav-bar-wrong' : 'oav-bar-answered');
    const statusClass = qStatus === 'correct' ? 'oav-status-correct' : qStatus === 'wrong' ? 'oav-status-wrong' : 'oav-status-unanswered';
    const statusIcon  = qStatus === 'correct' ? '✓' : qStatus === 'wrong' ? '✗' : '?';

    /* ── Opciones ── */
    let opcionesHTML = '';
    shuffled.forEach((opt, mi) => {
      const isSelected = restoredMixed.includes(opt.mixedIndex);
      let optClass = '';
      let optIcon  = '';
      if (isGraded && inv) {
        const isCorrectOpt  = preg.correcta.includes(opt.originalIndex);
        const isSelectedOpt = restoredMixed.includes(opt.mixedIndex);
        if (isCorrectOpt)                        { optClass = 'oav-option-correct'; optIcon = '✓'; }
        else if (isSelectedOpt && !isCorrectOpt) { optClass = 'oav-option-wrong';   optIcon = '✗'; }
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

    /* ── Badge resultado ── */
    let resultBadgeHTML = '';
    if (isGraded) {
      resultBadgeHTML = qStatus === 'correct'
        ? '<span class="oav-result-badge oav-result-correct">✓ Correcto (+1)</span>'
        : '<span class="oav-result-badge oav-result-wrong">✗ Incorrecto (0)</span>';
    }

    /* ── Explicación ── */
    const expShown = qs && qs.explanationShown && qs.explanationShown[idx];
    let explicacionHTML = '';
    if (preg.explicacion && preg.explicacion.trim() !== '') {
      const expContent = expShown ? `
        <div class="oav-explanation" id="oav-exp-${seccionId}-${idx}">
          <div class="oav-explanation-title">💡 Explicación</div>
          <p class="oav-explanation-text">${escapeHTML(preg.explicacion)}</p>
          ${preg.imagen_explicacion ? `<img src="${preg.imagen_explicacion}" alt="Imagen de la explicación" onclick="window.open(this.src,'_blank')" title="Clic para ampliar">` : ''}
        </div>` : '';
      const expBtnText     = expShown ? 'Ocultar explicación' : 'Ver explicación';
      const expBtnDisabled = !isGraded ? 'disabled' : '';
      explicacionHTML = `
        <button class="oav-btn oav-btn-ghost" id="oav-btn-exp-${seccionId}-${idx}"
                ${expBtnDisabled}
                onclick="window._oavToggleExplicacion('${seccionId}',${idx})">
          💬 ${expBtnText}
        </button>
        ${expContent}`;
    }

    /* ── Mini-mapa: barra de segmentos horizontal ── */
    let minimapHTML = '<div class="oav-minimap" title="Navegá entre preguntas">';
    for (let i = 0; i < total; i++) {
      const st2 = getQuestionStatus(seccionId, i);
      const dotClass = i === idx         ? 'oav-dot-current' :
                       st2 === 'correct' ? 'oav-dot-correct' :
                       st2 === 'wrong'   ? 'oav-dot-wrong'   : '';
      minimapHTML += `<div class="oav-dot ${dotClass}" data-num="${i+1}" onclick="window._oavGoTo('${seccionId}',${i})"></div>`;
    }
    minimapHTML += '</div>';

    /* ── Render final ── */
    wrapper.innerHTML = `
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
            <div class="oav-bar-fill ${barClass}" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="oav-status-icon ${statusClass}">${statusIcon}</div>
      </div>

      <div class="oav-card">
        <div class="oav-card-body">
          <span class="oav-question-label">Pregunta ${idx + 1}</span>
          <div class="oav-question-text">${escapeHTML(preg.pregunta)}</div>
          ${preg.imagen ? `<img class="oav-question-img" src="${preg.imagen}" alt="Imagen" onclick="window.open(this.src,'_blank')" title="Clic para ampliar">` : ''}
          <div class="oav-options" id="oav-options-${seccionId}-${idx}">
            ${opcionesHTML}
          </div>
          ${resultBadgeHTML}
        </div>
        <div class="oav-card-footer">
          <div class="oav-btn-row">
            <button class="oav-btn oav-btn-primary"
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

    /* ── Listeners de selección ── */
    const optContainer = document.getElementById('oav-options-' + seccionId + '-' + idx);
    if (optContainer && !isGraded) {
      optContainer.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
          optContainer.querySelectorAll('.oav-option').forEach(lbl => lbl.classList.remove('oav-option-selected'));
          if (tipoInput === 'radio') {
            inp.closest('.oav-option').classList.add('oav-option-selected');
          } else {
            optContainer.querySelectorAll('input:checked').forEach(ci => {
              ci.closest('.oav-option').classList.add('oav-option-selected');
            });
          }
          _persistAnswers(seccionId, idx);
        });
      });
    }
  }

  /* ─────────────────────────────────────────────────────────
     PERSISTENCIA LOCAL
  ───────────────────────────────────────────────────────── */
  function _persistAnswers(seccionId, qIndex) {
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (!all[seccionId]) return;
      const inputs = Array.from(document.getElementsByName('pregunta' + seccionId + qIndex));
      const sel = inputs.map((inp, i) => inp.checked ? i : null).filter(v => v !== null);
      if (!all[seccionId].answers) all[seccionId].answers = {};
      all[seccionId].answers[qIndex] = sel;
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));
    } catch (e) {}
  }

  /* ─────────────────────────────────────────────────────────
     ACCIONES GLOBALES
  ───────────────────────────────────────────────────────── */
  window._oavGoTo = function (seccionId, idx) {
    const st = oavState[seccionId];
    if (!st) return;
    const total = (window.preguntasPorSeccion[seccionId] || []).length;
    if (idx < 0 || idx >= total) return;
    st.currentIdx = idx;
    renderOAVPage(seccionId);
    const cont = document.getElementById('cuestionario-' + seccionId);
    if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window._oavResponder = function (seccionId, qIndex) {
    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas) return;
    const preg = preguntas[qIndex];

    const inputs   = Array.from(document.getElementsByName('pregunta' + seccionId + qIndex));
    const selMixed = inputs.map((inp, i) => inp.checked ? i : null).filter(v => v !== null);

    if (selMixed.length === 0) {
      const card = document.querySelector('#oav-wrapper-' + seccionId + ' .oav-card');
      if (card) {
        card.style.boxShadow = '0 0 0 2px #dc2626, 0 4px 24px rgba(220,38,38,0.15)';
        setTimeout(() => { card.style.boxShadow = ''; }, 900);
      }
      return;
    }

    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (!all[seccionId]) {
        all[seccionId] = { shuffleMap: {}, answers: {}, graded: {}, explanationShown: {}, shuffleFrozen: false };
      }
      if (!all[seccionId].shuffleMap)    all[seccionId].shuffleMap    = {};
      if (!all[seccionId].answers)       all[seccionId].answers       = {};
      if (!all[seccionId].graded)        all[seccionId].graded        = {};
      if (!all[seccionId].explanationShown) all[seccionId].explanationShown = {};

      // Construir inv desde el DOM si no está guardado
      if (!all[seccionId].shuffleMap[qIndex]) {
        const invBuild = {};
        inputs.forEach((inp, mi) => {
          invBuild[mi] = parseInt(inp.getAttribute('data-original-index'), 10);
        });
        all[seccionId].shuffleMap[qIndex] = invBuild;
        all[seccionId].shuffleFrozen = true;
      }
      const inv = all[seccionId].shuffleMap[qIndex];

      const selOriginal     = selMixed.map(i => inv[i]).sort((a, b) => a - b);
      const correctOriginal = preg.correcta.slice().sort((a, b) => a - b);
      const isCorrect       = JSON.stringify(selOriginal) === JSON.stringify(correctOriginal);

      all[seccionId].answers[qIndex] = selMixed;
      all[seccionId].graded[qIndex]  = true;
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));

      // Actualizar puntajes en memoria
      if (!window.puntajesPorSeccion)                window.puntajesPorSeccion          = {};
      if (!window.puntajesPorSeccion[seccionId])     window.puntajesPorSeccion[seccionId] = Array(preguntas.length).fill(null);
      window.puntajesPorSeccion[seccionId][qIndex]   = isCorrect ? 1 : 0;

      // Temporizador simulacro
      if (seccionId === 'simulador') {
        const gradedCount = Object.keys(all[seccionId].graded).filter(k => all[seccionId].graded[k]).length;
        if (gradedCount === 1 && typeof window.iniciarTemporizador === 'function') {
          window.iniciarTemporizador();
        }
      }

      // Re-render la tarjeta actual
      renderOAVPage(seccionId);

      // Verificar si todas están respondidas
      const allAnswered = window.puntajesPorSeccion[seccionId].every(v => v !== null && v !== undefined);
      if (allAnswered && !all[seccionId].totalShown) {
        setTimeout(() => _mostrarResultadoFinalOAV(seccionId), 600);
      }

    } catch (e) {
      console.error('[OAV] Error al responder:', e);
    }
  };

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

  window._oavRevisar = function (seccionId) {
    if (!oavState[seccionId]) oavState[seccionId] = { total: 0 };
    oavState[seccionId].currentIdx = 0;
    renderOAVPage(seccionId);
  };

  window._oavReiniciar = function (seccionId) {
    if (typeof window.reiniciarExamen === 'function') {
      window.reiniciarExamen(seccionId);
    } else {
      try {
        const raw = localStorage.getItem('quiz_state_v3');
        const all = JSON.parse(raw || '{}');
        delete all[seccionId];
        localStorage.setItem('quiz_state_v3', JSON.stringify(all));
      } catch(e) {}
      if (window.puntajesPorSeccion) {
        window.puntajesPorSeccion[seccionId] = Array((window.preguntasPorSeccion[seccionId] || []).length).fill(null);
      }
      if (oavState[seccionId]) oavState[seccionId].currentIdx = 0;
      renderOAV(seccionId);
    }
  };

  /* ─────────────────────────────────────────────────────────
     PANTALLA DE RESULTADO FINAL
  ───────────────────────────────────────────────────────── */
  function _mostrarResultadoFinalOAV(seccionId) {
    const preguntas  = window.preguntasPorSeccion[seccionId] || [];
    const total      = preguntas.length;
    const scores     = getScores(seccionId);
    const totalScore = scores.reduce((a, b) => a + (b || 0), 0);
    const pct        = total > 0 ? (totalScore / total) * 100 : 0;
    const barColor   = pct >= 70 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
    const icon       = pct === 100 ? '🏆' : pct >= 70 ? '🌟' : pct >= 50 ? '💪' : '📚';
    const frase      = typeof window._getFraseMotivacional === 'function'
      ? window._getFraseMotivacional(totalScore, total)
      : _localFrase(pct);

    // Marcar totalShown
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (all[seccionId]) { all[seccionId].totalShown = true; localStorage.setItem('quiz_state_v3', JSON.stringify(all)); }
    } catch(e) {}

    // Disparar lógica original (checkmark, attemptLog)
    const resultNode = document.getElementById('resultado-total-' + seccionId);
    if (resultNode && !resultNode.dataset.oavFired) {
      resultNode.dataset.oavFired = '1';
      if (typeof window.mostrarResultadoFinal === 'function') {
        window.mostrarResultadoFinal(seccionId);
      }
    }

    const wrapper = document.getElementById('oav-wrapper-' + seccionId);
    if (!wrapper) return;

    wrapper.innerHTML = `
      <div class="oav-result-screen">
        <div class="oav-result-icon">${icon}</div>
        <div class="oav-result-score">${totalScore}<span style="font-size:1.2rem;color:#94a3b8;font-weight:500"> / ${total}</span></div>
        <div class="oav-result-label">${Math.round(pct)}% de respuestas correctas</div>
        <div class="oav-result-bar-wrap">
          <div class="oav-result-bar-fill" style="width:0%;background:${barColor}" id="oav-result-bar-${seccionId}"></div>
        </div>
        <div class="oav-result-phrase">${frase}</div>
        <div class="oav-result-actions">
          <button class="oav-btn oav-btn-primary" onclick="window._oavRevisar('${seccionId}')">🔍 Revisar respuestas</button>
          <button class="oav-btn oav-btn-ghost"   onclick="window._oavReiniciar('${seccionId}')">🔄 Nuevo intento</button>
        </div>
      </div>`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const bar = document.getElementById('oav-result-bar-' + seccionId);
        if (bar) bar.style.width = pct + '%';
      });
    });
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function _localFrase(pct) {
    if (pct === 100) return '🏆 ¡Perfecto! Dominás cada concepto con maestría.';
    if (pct >= 91)   return '🌟 ¡Excelente resultado! Estás muy cerca de la cima.';
    if (pct >= 81)   return '💪 ¡Muy bien! Tu preparación es sólida.';
    if (pct >= 71)   return '📈 ¡Buen trabajo! Tenés una base firme.';
    if (pct >= 61)   return '🔍 Vas por buen camino. Cada error es una oportunidad de aprendizaje.';
    if (pct >= 51)   return '🌱 Estás en la mitad del camino. La medicina se aprende paso a paso.';
    if (pct >= 41)   return '🔥 No te rindas. Los mejores médicos también tuvieron momentos difíciles.';
    if (pct >= 31)   return '💡 Este resultado te muestra exactamente dónde enfocar tu energía.';
    return '🌅 Cada experto fue alguna vez un principiante. ¡Volvé a intentarlo!';
  }

  /* ─────────────────────────────────────────────────────────
     INTEGRACIÓN CON script.js
     
     En lugar de parchear generarCuestionario con polling (frágil),
     exponemos renderOAV y oavState globalmente para que script.js
     los llame directamente al final de generarCuestionario.
     
     script.js ya tiene el llamado integrado:
       if (typeof window._oavRenderOAV === 'function') {
         window._oavRenderOAV(seccionId);
       }
     
     Esto garantiza que el modo tarjetita se active siempre,
     sin importar la velocidad de carga del navegador.
  ───────────────────────────────────────────────────────── */

  // Exponer funciones para script.js y para debug
  window._oavRenderOAV = renderOAV;
  window._oavState     = oavState;

  console.log('[OAV] ✅ Modo una-pregunta-por-vez listo.');

})();
