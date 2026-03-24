/* ========== firebase-auth.js ==========
   Sistema de autenticación con Firebase
   - Login con email y contraseña
   - Sesión única por dispositivo
   - Sistema de licencias con verificación
   - Barra inferior estática con info de sesión
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, serverTimestamp, collection, addDoc, Timestamp, increment, updateDoc, onSnapshot, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase, ref, set, onValue, onDisconnect, push, query as rtQuery, limitToLast, orderByChild, serverTimestamp as rtServerTimestamp, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB9aDHVHhgMGlhXmsiLfiVZcSzUs3994ws",
  authDomain: "examenesiaruba-d11fb.firebaseapp.com",
  projectId: "examenesiaruba-d11fb",
  storageBucket: "examenesiaruba-d11fb.firebasestorage.app",
  messagingSenderId: "967562801862",
  appId: "1:967562801862:web:61f618fe7a2ff51dd15dc7",
  measurementId: "G-CFRNQ9Z3SQ",
  databaseURL: "https://examenesiaruba-d11fb-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

const ADMIN_EMAIL = "micro2020uba@gmail.com";
const CONTACTO_EMAIL = "examenesiaruba@gmail.com";

// ======== DEMO ========
const DEMO_SECCIONES_PERMITIDAS = ["iarsep2020", "iaroct2020"];
const DEMO_DIAS = 3;
window._demoCheckEnabled = false;
window._demoSeccionesPermitidas = DEMO_SECCIONES_PERMITIDAS;

// Licencia en memoria (se llena al autenticar)
let licenciaActual = null;

// Listener en tiempo real de solicitudes pendientes
let _solicitudesUnsubscribe = null;
let _ultimoSnapshotSolicitudes = null; // guarda el último snapshot para renderizar al abrir el panel

function getDeviceId() {
  // sessionStorage es único por pestaña/ventana — incluso en el mismo navegador.
  // Esto permite detectar múltiples ventanas del mismo navegador como sesiones distintas.
  let did = sessionStorage.getItem("iar_session_id");
  if (!did) {
    did = "ses_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem("iar_session_id", did);
  }
  return did;
}

async function verificarLicencia(userId) {
  try {
    const licRef = doc(db, "licencias", userId);
    const licSnap = await getDoc(licRef);

    if (!licSnap.exists()) {
      // ── RECUPERACIÓN AUTOMÁTICA ──
      // El usuario existe en Firebase Auth pero no tiene licencia en Firestore.
      // Esto pasa cuando el setDoc falló al registrarse. Auto-crear licencia demo.
      try {
        const user = auth.currentUser;
        if (user && user.uid === userId) {
          const ahora = Timestamp.now();
          // Usar la fecha de creación de la cuenta como base del período demo
          const creadoEn = user.metadata?.creationTime
            ? Timestamp.fromDate(new Date(user.metadata.creationTime))
            : ahora;
          await setDoc(licRef, {
            esDemo: true,
            nombre: user.displayName || user.email?.split('@')[0] || 'Usuario',
            email: user.email,
            creadoEn: creadoEn,
            plan: "demo",
            recuperadaAutomaticamente: true
          });
          console.log('[IAR] Licencia demo recuperada automáticamente para', user.email);
          // Verificar nuevamente con la licencia recién creada
          const licSnapNuevo = await getDoc(licRef);
          if (licSnapNuevo.exists()) {
            const data = licSnapNuevo.data();
            const creadoEnDate = data.creadoEn.toDate ? data.creadoEn.toDate() : new Date(data.creadoEn);
            const expiracion = new Date(creadoEnDate.getTime() + DEMO_DIAS * 24 * 60 * 60 * 1000);
            const ahora2 = new Date();
            if (ahora2 > expiracion) {
              const fechaFormateada = expiracion.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
              return { valida: false, esDemo: true, vencida: true, mensaje: `Tu período de prueba de ${DEMO_DIAS} días venció el ${fechaFormateada}.` };
            }
            const msRestantes = expiracion - ahora2;
            const horasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60));
            return { valida: true, esDemo: true, expiracion, horasRestantes, msRestantes };
          }
        }
      } catch (recErr) {
        console.warn('[IAR] No se pudo recuperar licencia automáticamente:', recErr.message);
      }
      return { valida: false, mensaje: "No tenés una licencia activa.\nContactanos para adquirir acceso." };
    }

    const data = licSnap.data();

    // ── Licencia DEMO ──
    if (data.esDemo === true) {
      if (!data.creadoEn) return { valida: false, esDemo: true, mensaje: "Error en la licencia demo. Contactanos." };
      const creadoEn = data.creadoEn.toDate ? data.creadoEn.toDate() : new Date(data.creadoEn);
      const expiracion = new Date(creadoEn.getTime() + DEMO_DIAS * 24 * 60 * 60 * 1000);
      const ahora = new Date();
      if (ahora > expiracion) {
        const fechaFormateada = expiracion.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
        return { valida: false, esDemo: true, vencida: true, mensaje: `Tu período de prueba de ${DEMO_DIAS} días venció el ${fechaFormateada}.` };
      }
      const msRestantes = expiracion - ahora;
      const horasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60));
      return { valida: true, esDemo: true, expiracion, horasRestantes, msRestantes };
    }

    if (data.porVida === true) return { valida: true, porVida: true };

    if (!data.vencimiento) {
      return { valida: false, mensaje: "Tu licencia no tiene fecha configurada. Contactanos." };
    }

    const ahora = new Date();
    const vencimiento = data.vencimiento.toDate ? data.vencimiento.toDate() : new Date(data.vencimiento);

    if (ahora > vencimiento) {
      const fechaFormateada = vencimiento.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
      return { valida: false, vencida: true, mensaje: `Tu licencia venció el ${fechaFormateada}.` };
    }

    const msRestantes = vencimiento - ahora;
    const horasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60));
    const diasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60 * 24));
    return { valida: true, vencimiento, diasRestantes, horasRestantes, msRestantes };

  } catch (err) {
    console.error("Error verificando licencia:", err);
    return { valida: false, mensaje: "Error al verificar tu licencia. Verificá tu conexión." };
  }
}

// ======== ESTILOS ========
function inyectarEstilos() {
  if (document.getElementById("login-styles")) return;
  const style = document.createElement("style");
  style.id = "login-styles";
  style.textContent = `
    /* ── Login overlay ── */
    #login-overlay {
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:linear-gradient(135deg,#1a56a0 0%,#1e3a8a 100%);
      z-index:99999;display:flex;justify-content:center;align-items:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    }
    .login-box {
      background:#fff;border-radius:16px;padding:36px 32px 28px;
      width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.3);
      text-align:center;margin:16px;
    }
    .login-logo { font-size:3rem;font-weight:900;color:#0d7490;letter-spacing:4px;margin-bottom:6px; }
    .login-subtitle { font-size:.85rem;color:#64748b;margin-bottom:24px;line-height:1.4; }
    .login-field { text-align:left;margin-bottom:14px; }
    .login-field label {
      display:block;font-size:.82rem;font-weight:600;color:#475569;
      margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;
    }
    .login-field input {
      width:100%;padding:11px 14px;border:1.5px solid #cbd5e1;border-radius:8px;
      font-size:.95rem;color:#1f2937;outline:none;transition:border-color .15s;
      -webkit-user-select:text!important;user-select:text!important;box-sizing:border-box;
    }
    .login-field input:focus { border-color:#0d7490;box-shadow:0 0 0 3px rgba(13,116,144,.12); }
    .login-btn {
      width:100%;padding:12px;
      background:linear-gradient(135deg,#0d7490 0%,#0891b2 100%);
      color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:700;
      cursor:pointer;margin-top:6px;transition:all .15s;
    }
    .login-btn:hover { background:linear-gradient(135deg,#0891b2,#06b6d4);transform:translateY(-1px); }
    .login-btn:disabled { opacity:.6;cursor:not-allowed;transform:none; }
    .login-btn-sec {
      width:100%;padding:10px;margin-top:8px;
      background:#f1f5f9;color:#475569;border:1.5px solid #cbd5e1;
      border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .15s;
    }
    .login-btn-sec:hover { background:#e2e8f0; }
    .login-error {
      background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;
      padding:10px 14px;font-size:.88rem;margin-bottom:14px;font-weight:500;
      line-height:1.5;white-space:pre-line;text-align:left;
    }
    .login-success {
      background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:8px;
      padding:10px 14px;font-size:.88rem;margin-bottom:14px;font-weight:500;
      line-height:1.5;text-align:left;
    }
    .login-loading { color:#64748b;font-size:.88rem;margin-top:10px;min-height:18px; }
    .login-divider {
      display:flex;align-items:center;gap:10px;margin:14px 0 10px;color:#94a3b8;font-size:.8rem;
    }
    .login-divider::before,.login-divider::after {
      content:'';flex:1;height:1px;background:#e2e8f0;
    }

    /* ── Barra inferior estática — estilos en styles.css ── */

    /* ── Tabs login/registro ── */
    .login-tabs { display:flex;gap:0;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1.5px solid #e2e8f0; }
    .login-tab { flex:1;padding:10px;background:#f8fafc;color:#64748b;font-size:.88rem;font-weight:600;cursor:pointer;border:none;transition:all .15s; }
    .login-tab.activo { background:#0d7490;color:#fff; }
    .login-tab:hover:not(.activo) { background:#e2e8f0; }
    .demo-banner { background:linear-gradient(135deg,#d1fae5,#a7f3d0);border:1.5px solid #6ee7b7;border-radius:10px;padding:12px 14px;margin-bottom:16px;text-align:left; }
    .demo-banner-titulo { font-size:.9rem;font-weight:800;color:#065f46;margin-bottom:4px; }
    .demo-banner-desc { font-size:.82rem;color:#047857;line-height:1.5; }

    /* ── Modal restricción demo ── */
    #demo-restriccion-overlay {
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,.6);z-index:9999;
      display:flex;justify-content:center;align-items:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
      padding:16px;box-sizing:border-box;
    }
    .demo-restriccion-box { background:#fff;border-radius:14px;padding:22px 20px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center;max-height:90vh;overflow-y:auto; }
    .demo-restriccion-icon { font-size:2.8rem;margin-bottom:10px; }
    .demo-restriccion-titulo { font-size:1.2rem;font-weight:800;color:#d97706;margin-bottom:10px; }
    .demo-restriccion-msg { font-size:.92rem;color:#475569;line-height:1.6;margin-bottom:16px; }
    .demo-restriccion-email { display:inline-block;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:8px;padding:8px 16px;font-weight:700;color:#0d7490;font-size:.95rem;margin-bottom:20px;word-break:break-all; }
    .demo-plan-row { display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:.88rem; }
    .demo-plan-row:last-child { border-bottom:none; }
    .demo-plan-nombre { color:#334155;font-weight:600; }
    .demo-plan-precio { color:#0d7490;font-weight:700; }

    /* ── Cuenta regresiva en barra ── */
    #barra-countdown {
      display:inline-flex;align-items:center;gap:5px;
      background:#dc2626;color:#fff;border-radius:6px;padding:3px 10px;
      font-size:.8rem;font-weight:700;margin-left:6px;
      animation:pulseRed 1.5s ease-in-out infinite;
    }
    @keyframes pulseRed { 0%,100%{opacity:1}50%{opacity:.75} }

    /* ── Licencia vencida ── */
    #licencia-vencida-overlay {
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:linear-gradient(135deg,#1a56a0 0%,#1e3a8a 100%);
      z-index:99999;display:flex;justify-content:center;align-items:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    }
    .lv-box {
      background:#fff;border-radius:16px;padding:40px 36px;
      width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.3);
      text-align:center;margin:16px;
    }
    .lv-icon { font-size:3rem;margin-bottom:12px; }
    .lv-titulo { font-size:1.4rem;font-weight:800;color:#dc2626;margin-bottom:12px; }
    .lv-msg { font-size:.95rem;color:#475569;line-height:1.6;margin-bottom:8px; }
    .lv-contacto {
      font-size:.9rem;color:#0d7490;font-weight:600;
      margin-bottom:24px;
    }
    .lv-btn {
      display:inline-block;padding:12px 24px;
      background:linear-gradient(135deg,#0d7490 0%,#0891b2 100%);
      color:#fff;border:none;border-radius:8px;font-size:.92rem;font-weight:700;
      cursor:pointer;text-decoration:none;transition:all .15s;margin:4px;
    }
    .lv-btn:hover { transform:translateY(-1px); }
    .lv-btn-sec { background:#f1f5f9;color:#475569;border:1px solid #cbd5e1; }
    .lv-btn-sec:hover { background:#e2e8f0; }
    #lv-email-contacto, #demo-email-span {
      -webkit-user-select:text!important;
      -moz-user-select:text!important;
      -ms-user-select:text!important;
      user-select:text!important;
    }
    .lv-plan-card:hover { box-shadow:0 2px 8px rgba(0,0,0,.12);transform:translateY(-1px); }
    .demo-plan-sel-card:hover { box-shadow:0 2px 8px rgba(0,0,0,.12);transform:translateY(-1px); }

    /* ── Badge solicitudes en botón Admin ── */
    #btn-abrir-admin {
      position:relative;
    }
    #btn-abrir-admin .admin-sol-badge {
      position:absolute;top:-7px;right:-7px;
      background:#dc2626;color:#fff;
      font-size:.68rem;font-weight:800;
      min-width:18px;height:18px;
      border-radius:50%;display:flex;align-items:center;justify-content:center;
      padding:0 4px;box-shadow:0 2px 6px rgba(220,38,38,.5);
      animation:pulseBadge 1.5s ease-in-out infinite;
      pointer-events:none;
    }
    @keyframes pulseBadge {
      0%,100%{transform:scale(1);}
      50%{transform:scale(1.15);}
    }

    /* ── Panel Admin ── */
    #admin-overlay {
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,.6);z-index:99998;
      display:flex;justify-content:center;align-items:flex-start;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
      overflow-y:auto;padding:20px;box-sizing:border-box;
    }
    .admin-box {
      background:#f8fafc;border-radius:16px;padding:28px;
      width:100%;max-width:700px;box-shadow:0 20px 60px rgba(0,0,0,.3);margin:auto;
    }
    .admin-titulo {
      font-size:1.3rem;font-weight:800;color:#0d7490;
      margin-bottom:20px;padding-bottom:12px;
      border-bottom:2px solid #e2e8f0;display:flex;
      justify-content:space-between;align-items:center;
    }
    .admin-seccion {
      background:#fff;border-radius:10px;padding:20px;
      margin-bottom:16px;border:1px solid #e2e8f0;
      box-shadow:0 1px 4px rgba(0,0,0,.06);
    }
    .admin-seccion h3 {
      font-size:.9rem;font-weight:700;color:#475569;
      text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;
    }
    .admin-row { display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px; }
    .admin-field { display:flex;flex-direction:column;gap:4px;flex:1;min-width:140px; }
    .admin-field label { font-size:.75rem;font-weight:600;color:#64748b;text-transform:uppercase; }
    .admin-field input, .admin-field select {
      padding:8px 10px;border:1.5px solid #cbd5e1;border-radius:7px;
      font-size:.88rem;color:#1f2937;outline:none;background:#fff;
    }
    .admin-field input:focus, .admin-field select:focus { border-color:#0d7490; }
    .admin-btn {
      padding:8px 16px;border:none;border-radius:7px;font-size:.83rem;
      font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap;
    }
    .admin-btn-primary { background:linear-gradient(135deg,#0d7490,#0891b2);color:#fff; }
    .admin-btn-primary:hover { background:linear-gradient(135deg,#0891b2,#06b6d4); }
    .admin-btn-success { background:linear-gradient(135deg,#059669,#047857);color:#fff; }
    .admin-btn-cerrar { background:#e2e8f0;color:#475569;font-size:.85rem;padding:6px 14px; }
    .admin-btn-cerrar:hover { background:#cbd5e1; }
    .admin-tabla { width:100%;border-collapse:collapse;font-size:.83rem; }
    .admin-tabla th {
      background:#f1f5f9;padding:8px 10px;text-align:left;
      font-weight:700;color:#475569;font-size:.75rem;text-transform:uppercase;
    }
    .admin-tabla td { padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#334155; }
    .admin-tabla tr:hover td { background:#f8fafc; }
    .admin-msg {
      padding:8px 12px;border-radius:7px;font-size:.83rem;font-weight:600;
      margin-top:8px;display:none;
    }
    .admin-msg.ok { background:#d1fae5;color:#065f46;display:block; }
    .admin-msg.err { background:#fee2e2;color:#dc2626;display:block; }

    /* ── Solicitud de acceso ── */
    #solicitud-overlay {
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:linear-gradient(135deg,#1a56a0 0%,#1e3a8a 100%);
      z-index:99999;display:flex;justify-content:center;align-items:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    }
    .solicitud-box {
      background:#fff;border-radius:16px;padding:36px 32px 28px;
      width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.3);
      text-align:center;margin:16px;
    }
    .solicitud-titulo { font-size:1.3rem;font-weight:800;color:#0d7490;margin-bottom:8px; }
    .solicitud-desc { font-size:.88rem;color:#64748b;margin-bottom:20px;line-height:1.5; }
  `;
  document.head.appendChild(style);
}

// ======== LOGIN / REGISTRO ========
let pantallaActual = "login";

function mostrarLogin(mensajeError) {
  inyectarEstilos();
  document.body.style.overflow = "hidden";

  let overlay = document.getElementById("login-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-logo">IAR</div>
        <div class="login-subtitle">Sistema de Preparación para el Examen IAR</div>
        <div class="login-tabs">
          <button class="login-tab activo" id="tab-login">Iniciar sesión</button>
          <button class="login-tab" id="tab-registro">🆓 Probar gratis</button>
        </div>
        <div id="login-error" class="login-error" style="display:none;"></div>
        <div id="login-success" class="login-success" style="display:none;"></div>
        <div id="form-login">
          <div class="login-field">
            <label>Email</label>
            <input type="email" id="login-email" placeholder="tu@email.com" autocomplete="email" />
          </div>
          <div class="login-field">
            <label>Contraseña</label>
            <div style="position:relative;">
              <input type="password" id="login-password" placeholder="••••••••" autocomplete="current-password" style="padding-right:42px;" />
              <button type="button" id="toggle-password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;font-size:1.1rem;line-height:1;">👁</button>
            </div>
          </div>
          <button id="login-btn" class="login-btn">Ingresar</button>
          <div id="login-loading" class="login-loading"></div>
          <div style="text-align:center;margin-top:10px;">
            <button type="button" id="btn-olvide-password" style="background:none;border:none;color:#0d7490;font-size:.82rem;cursor:pointer;text-decoration:underline;padding:0;">
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <!-- Formulario recuperación (oculto por defecto) -->
          <div id="form-recuperar" style="display:none;margin-top:14px;padding:14px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:8px;">
            <div style="font-size:.82rem;font-weight:600;color:#0d7490;margin-bottom:8px;">Ingresá tu email registrado y te enviaremos un enlace para restablecer tu contraseña.</div>
            <div class="login-field" style="margin-bottom:8px;">
              <label>Email</label>
              <input type="email" id="recuperar-email" placeholder="tu@email.com" autocomplete="email" />
            </div>
            <div id="recuperar-msg" style="display:none;font-size:.82rem;font-weight:600;padding:7px 10px;border-radius:6px;margin-bottom:8px;"></div>
            <div style="display:flex;gap:8px;">
              <button type="button" id="btn-enviar-recuperar" class="login-btn" style="margin-top:0;font-size:.85rem;padding:9px;">Enviar email</button>
              <button type="button" id="btn-cancelar-recuperar" class="login-btn-sec" style="font-size:.85rem;padding:9px;">Cancelar</button>
            </div>
          </div>
        </div>
        <div id="form-registro" style="display:none;">
          <div class="login-field">
            <label>Nombre completo</label>
            <input type="text" id="reg-nombre" placeholder="Tu nombre completo" autocomplete="name" />
          </div>
          <div class="login-field">
            <label>Email</label>
            <input type="email" id="reg-email" placeholder="tu@email.com" autocomplete="email" />
          </div>
          <div class="login-field">
            <label>Contraseña</label>
            <div style="position:relative;">
              <input type="password" id="reg-password" placeholder="Mínimo 6 caracteres" style="padding-right:42px;" />
              <button type="button" id="toggle-reg-password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;font-size:1.1rem;line-height:1;">👁</button>
            </div>
          </div>
          <button id="reg-btn" class="login-btn" style="background:linear-gradient(135deg,#059669,#047857);">🚀 Crear cuenta DEMO gratis</button>
          <div id="reg-loading" class="login-loading"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("tab-login").addEventListener("click", () => cambiarTab("login"));
    document.getElementById("tab-registro").addEventListener("click", () => cambiarTab("registro"));
    document.getElementById("login-btn").addEventListener("click", handleLogin);
    document.getElementById("login-password").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
    document.getElementById("login-email").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("login-password").focus(); });

    // ── Recuperación de contraseña ──
    document.getElementById("btn-olvide-password").addEventListener("click", () => {
      const formRecuperar = document.getElementById("form-recuperar");
      const emailVal = document.getElementById("login-email").value.trim();
      if (emailVal) document.getElementById("recuperar-email").value = emailVal;
      formRecuperar.style.display = formRecuperar.style.display === "none" ? "block" : "none";
      document.getElementById("recuperar-msg").style.display = "none";
    });
    document.getElementById("btn-cancelar-recuperar").addEventListener("click", () => {
      document.getElementById("form-recuperar").style.display = "none";
      document.getElementById("recuperar-msg").style.display = "none";
    });
    document.getElementById("btn-enviar-recuperar").addEventListener("click", handleRecuperarPassword);
    document.getElementById("recuperar-email").addEventListener("keydown", e => { if (e.key === "Enter") handleRecuperarPassword(); });
    document.getElementById("toggle-password").addEventListener("click", () => {
      const inp = document.getElementById("login-password");
      const btn = document.getElementById("toggle-password");
      if (inp.type === "password") { inp.type = "text"; btn.textContent = "🙈"; btn.style.color = "#0d7490"; }
      else { inp.type = "password"; btn.textContent = "👁"; btn.style.color = "#94a3b8"; }
    });
    document.getElementById("reg-btn").addEventListener("click", handleRegistro);
    document.getElementById("reg-password").addEventListener("keydown", e => { if (e.key === "Enter") handleRegistro(); });
    document.getElementById("toggle-reg-password").addEventListener("click", () => {
      const inp = document.getElementById("reg-password");
      const btn = document.getElementById("toggle-reg-password");
      if (inp.type === "password") { inp.type = "text"; btn.textContent = "🙈"; btn.style.color = "#0d7490"; }
      else { inp.type = "password"; btn.textContent = "👁"; btn.style.color = "#94a3b8"; }
    });
  }

  const errDiv = document.getElementById("login-error");
  if (mensajeError) { errDiv.textContent = mensajeError; errDiv.style.display = "block"; }
  else errDiv.style.display = "none";
  document.getElementById("login-success").style.display = "none";

  const btn = document.getElementById("login-btn");
  if (btn) btn.disabled = false;
  const loading = document.getElementById("login-loading");
  if (loading) loading.textContent = "";

  overlay.style.display = "flex";
  cambiarTab(pantallaActual);
}

function cambiarTab(tab) {
  pantallaActual = tab;
  const tabLogin = document.getElementById("tab-login");
  const tabReg = document.getElementById("tab-registro");
  const formLogin = document.getElementById("form-login");
  const formReg = document.getElementById("form-registro");
  if (!tabLogin) return;
  if (tab === "login") {
    tabLogin.classList.add("activo"); tabReg.classList.remove("activo");
    formLogin.style.display = ""; formReg.style.display = "none";
  } else {
    tabReg.classList.add("activo"); tabLogin.classList.remove("activo");
    formReg.style.display = ""; formLogin.style.display = "none";
  }
  const err = document.getElementById("login-error");
  const suc = document.getElementById("login-success");
  if (err) err.style.display = "none";
  if (suc) suc.style.display = "none";
}

// ======== REGISTRO DEMO ========
async function handleRegistro() {
  const nombre = (document.getElementById("reg-nombre")?.value || "").trim();
  const email = (document.getElementById("reg-email")?.value || "").trim();
  const password = document.getElementById("reg-password")?.value || "";
  const errDiv = document.getElementById("login-error");
  const sucDiv = document.getElementById("login-success");
  const btn = document.getElementById("reg-btn");
  const loading = document.getElementById("reg-loading");

  errDiv.style.display = "none";
  sucDiv.style.display = "none";

  if (!nombre) { errDiv.textContent = "Por favor ingresá tu nombre completo."; errDiv.style.display = "block"; return; }
  if (!email)  { errDiv.textContent = "Por favor ingresá tu email."; errDiv.style.display = "block"; return; }
  if (password.length < 6) { errDiv.textContent = "La contraseña debe tener al menos 6 caracteres."; errDiv.style.display = "block"; return; }

  btn.disabled = true;
  loading.textContent = "Creando cuenta...";

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const ahora = Timestamp.now();

    // Intentar escribir la licencia hasta 3 veces antes de rendirse
    let licEscrita = false;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        await setDoc(doc(db, "licencias", user.uid), {
          esDemo: true, nombre, email, creadoEn: ahora, plan: "demo"
        });
        licEscrita = true;
        break;
      } catch (writeErr) {
        console.warn(`[IAR] Intento ${intento} de escribir licencia falló:`, writeErr.code || writeErr.message);
        if (intento < 3) await new Promise(r => setTimeout(r, 800));
      }
    }

    if (!licEscrita) {
      // La cuenta en Auth fue creada pero no se pudo guardar la licencia.
      // Igual dejamos al usuario entrar — verificarLicencia tiene recuperación automática.
      console.warn('[IAR] No se pudo escribir licencia tras 3 intentos. Se usará recuperación automática.');
    }

    // registros_demo es opcional, no bloquear si falla
    try {
      await addDoc(collection(db, "registros_demo"), {
        uid: user.uid, nombre, email, creadoEn: ahora, estado: "activo"
      });
    } catch(e) {
      console.warn('[IAR] No se pudo guardar registro_demo:', e.code || e.message);
    }

    loading.textContent = "Verificando...";
    const licencia = await verificarLicencia(user.uid);
    licenciaActual = licencia;

    const deviceId = getDeviceId();
    const sessionRef = doc(db, "sessions", user.uid);
    await setDoc(sessionRef, { deviceId, email: user.email, loginAt: ahora, lastActivity: ahora });

    ocultarLogin(true);
    aplicarRestriccionesDemo();
    mostrarBarraSesion(user.email, licencia);
    iniciarMonitoreoSesion(user);
    iniciarCountdownLicencia(licencia);

  } catch (err) {
    btn.disabled = false;
    loading.textContent = "";
    let msg = "Error al crear la cuenta.";
    if (err.code === "auth/email-already-in-use") msg = "Ese email ya tiene una cuenta. Iniciá sesión.";
    else if (err.code === "auth/invalid-email") msg = "El email ingresado no es válido.";
    else if (err.code === "auth/network-request-failed") msg = "Error de conexión. Verificá tu internet.";
    errDiv.textContent = msg;
    errDiv.style.display = "block";
  }
}

// ======== RESTRICCIONES DEMO ========
function aplicarRestriccionesDemo() {
  window._demoCheckEnabled = true;

  // ── Deshabilitar visualmente el simulador en el menú ──
  document.querySelectorAll('li').forEach(li => {
    const oc = li.getAttribute('onclick') || '';
    if (oc.includes('simulador') || oc.includes('simulacro')) {
      li.style.opacity = '0.4'; li.style.pointerEvents = 'none';
      li.title = 'Disponible en el acceso completo';
    }
  });

  // ── "Ver respuestas correctas": en DEMO se permite entrar al panel,
  //    pero los exámenes individuales no permitidos están bloqueados (se hace abajo) ──
  // (No deshabilitar el botón principal en el menú)

  // ── Deshabilitar cuestionarios NO permitidos en el submenú IAR ──
  // y agregar candado visual a ítems de respuestas correctas no permitidos ──
  document.querySelectorAll('li').forEach(li => {
    const oc = li.getAttribute('onclick') || '';
    const m = oc.match(/mostrarCuestionario\('([^']+)'\)/);
    if (m && !DEMO_SECCIONES_PERMITIDAS.includes(m[1])) {
      li.style.opacity = '0.4'; li.style.pointerEvents = 'none';
      li.title = 'Disponible en el acceso completo';
    }
    // Ítems de respuestas correctas no permitidos: mostrar candado y permitir clic para modal
    const mr = oc.match(/mostrarRespuestasExamen\('([^']+)'\)/);
    if (mr && !DEMO_SECCIONES_PERMITIDAS.includes(mr[1])) {
      li.style.opacity = '0.55';
      li.style.cursor = 'pointer';
      li.title = 'Disponible en el acceso completo — clic para más info';
      // Agregar ícono de candado si no tiene
      if (!li.querySelector('.demo-lock-icon')) {
        const lock = document.createElement('span');
        lock.className = 'demo-lock-icon';
        lock.textContent = ' 🔒';
        lock.style.fontSize = '.8em';
        li.appendChild(lock);
      }
      // Reemplazar onclick para mostrar modal
      li.setAttribute('onclick', 'window.mostrarModalRestriccionDemo && window.mostrarModalRestriccionDemo()');
    }
  });

  // ── Interceptar mostrarRespuestasCorrectas (lista completa) ──
  // En DEMO se permite entrar al panel; el bloqueo ocurre al intentar abrir un examen no permitido
  // (no se intercepta aquí)

  // ── Interceptar mostrarRespuestasExamen (cuestionario individual) ──
  const origRespExamen = window.mostrarRespuestasExamen;
  if (origRespExamen) {
    window.mostrarRespuestasExamen = function(seccionId) {
      if (!DEMO_SECCIONES_PERMITIDAS.includes(seccionId)) {
        mostrarModalRestriccionDemo(); return;
      }
      origRespExamen(seccionId);
    };
  }

  // ── Interceptar simulacro ──
  const origSim = window.mostrarCuestionario;
  if (origSim) {
    window.mostrarCuestionario = function(seccionId) {
      if (seccionId === 'simulacro_iar' || seccionId === 'simulador') {
        mostrarModalRestriccionDemo(); return;
      }
      if (!DEMO_SECCIONES_PERMITIDAS.includes(seccionId)) {
        mostrarModalRestriccionDemo(); return;
      }
      origSim(seccionId);
    };
  }
}

// Helper global para abrir el mail de contacto (accesible desde onclick inline)
window._abrirCorreoContacto = function() {
  const url = `mailto:${CONTACTO_EMAIL}?subject=Consulta%20precios%20por%20planes%20disponibles`;
  // Crear un <a> temporal y hacer clic programático — método más confiable en todos los navegadores
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch(e) {} }, 300);
};

function mostrarModalRestriccionDemo() {
  const existente = document.getElementById("demo-restriccion-overlay");
  if (existente) {
    existente.style.display = "flex";
    // Restaurar el botón y los mensajes por si el usuario tiene una solicitud
    // rechazada y quiere volver a enviar
    const btnExistente = document.getElementById('demo-btn-solicitar-plan');
    const sucExistente = document.getElementById('demo-sol-exito');
    const errExistente = document.getElementById('demo-sol-error');
    if (btnExistente) { btnExistente.style.display = ''; btnExistente.disabled = false; btnExistente.textContent = '📩 Solicitar un plan'; }
    if (sucExistente) sucExistente.style.display = 'none';
    if (errExistente) errExistente.style.display = 'none';
    // Re-verificar si tiene pendiente real para decidir si ocultar el botón
    const user = auth.currentUser;
    if (user && btnExistente) {
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(({ getDocs, query: q, where: w, collection: col }) => {
        getDocs(q(col(db, 'solicitudes'), w('uid', '==', user.uid), w('estado', '==', 'pendiente')))
          .then(snap => {
            if (!snap.empty) {
              btnExistente.style.display = 'none';
              if (sucExistente) { sucExistente.textContent = '✅ Ya tenés una solicitud pendiente. Te contactaremos a la brevedad.'; sucExistente.style.display = 'block'; }
            }
          }).catch(() => {});
      }).catch(() => {});
    }
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = "demo-restriccion-overlay";
  overlay.innerHTML = `
    <div class="demo-restriccion-box" style="-webkit-user-select:auto;user-select:auto;max-width:400px;">
      <div class="demo-restriccion-icon" style="font-size:2rem;margin-bottom:6px;">🎓</div>
      <div class="demo-restriccion-titulo" style="font-size:1rem;margin-bottom:6px;">Contenido exclusivo</div>
      <div class="demo-restriccion-msg" style="font-size:.82rem;margin-bottom:12px;">
        En la <strong>versión demo</strong> podés explorar libremente los exámenes de
        <strong>SEP 2020</strong> y <strong>OCT 2020</strong>.<br><br>
        Solicitá tu acceso completo para desbloquear todos los exámenes, el simulador y las respuestas. 🚀
      </div>

      <!-- Selección de plan -->
      <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:12px 14px;margin-bottom:12px;text-align:left;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">📦 Elegí tu plan:</div>
        <div style="display:flex;gap:8px;" id="demo-planes-container">
          <div class="demo-plan-sel-card" data-plan="1 semana"
            onclick="window._seleccionarPlanDemo('1 semana')"
            style="flex:1;background:#fff;border:2px solid #93c5fd;border-radius:8px;padding:10px;text-align:center;cursor:pointer;transition:all .15s;">
            <div style="font-size:1.2rem;">⚡</div>
            <div style="font-weight:700;color:#0d7490;font-size:.85rem;">1 semana</div>
            <div style="font-weight:700;color:#059669;font-size:.85rem;margin-top:3px;">$10.000</div>
          </div>
          <div class="demo-plan-sel-card" data-plan="1 mes"
            onclick="window._seleccionarPlanDemo('1 mes')"
            style="flex:1;background:#fff;border:2px solid #93c5fd;border-radius:8px;padding:10px;text-align:center;cursor:pointer;transition:all .15s;">
            <div style="font-size:1.2rem;">📅</div>
            <div style="font-weight:700;color:#0d7490;font-size:.85rem;">1 mes</div>
            <div style="font-weight:700;color:#059669;font-size:.85rem;margin-top:3px;">$30.000</div>
          </div>
        </div>
        <div id="demo-plan-sel-msg" style="display:none;font-size:.78rem;color:#0d7490;font-weight:600;margin-top:6px;text-align:center;"></div>
      </div>

      <!-- Mensajes feedback -->
      <div id="demo-sol-exito" style="display:none;background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:8px 12px;font-size:.82rem;color:#065f46;font-weight:600;margin-bottom:8px;"></div>
      <div id="demo-sol-error" style="display:none;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:.82rem;color:#dc2626;font-weight:600;margin-bottom:8px;"></div>

      <!-- Botón solicitar -->
      <button id="demo-btn-solicitar-plan"
        onclick="window._enviarSolicitudDemo(); return false;"
        style="width:100%;background:linear-gradient(135deg,#0d7490,#0891b2);color:#fff;border:none;border-radius:8px;padding:11px;font-size:.9rem;font-weight:700;cursor:pointer;pointer-events:auto;margin-bottom:8px;">
        📩 Solicitar un plan
      </button>

      <!-- Email contacto -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:10px;text-align:left;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">✉️ Para más información escribinos a:</div>
        <span
          onclick="window._copiarEmailDemo()"
          title="Clic para copiar"
          id="demo-email-span"
          style="display:inline-block;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:8px;padding:7px 12px;font-weight:700;color:#0d7490;font-size:.9rem;cursor:pointer;pointer-events:auto;-webkit-user-select:text!important;user-select:text!important;word-break:break-all;">
          ${CONTACTO_EMAIL}
        </span>
        <div id="demo-copy-msg" style="font-size:.72rem;color:#059669;display:none;margin-top:4px;">✅ Copiado</div>
      </div>

      <div style="display:flex;gap:8px;justify-content:center;">
        <button
          onclick="document.getElementById('demo-restriccion-overlay').style.display='none'; return false;"
          style="background:#e2e8f0;color:#475569;border:none;border-radius:8px;padding:10px 24px;font-size:.88rem;font-weight:700;cursor:pointer;pointer-events:auto;">
          ✕ Cerrar
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Estado local del modal
  let _planDemo = null;

  window._seleccionarPlanDemo = function(plan) {
    _planDemo = plan;
    document.querySelectorAll('.demo-plan-sel-card').forEach(c => {
      c.style.borderColor = c.dataset.plan === plan ? '#059669' : '#93c5fd';
      c.style.boxShadow = c.dataset.plan === plan ? '0 0 0 2px #059669' : '';
    });
    const m = document.getElementById('demo-plan-sel-msg');
    if (m) { m.textContent = `Plan seleccionado: ${plan}`; m.style.display = 'block'; }
  };

  window._copiarEmailDemo = function() {
    try {
      navigator.clipboard.writeText(CONTACTO_EMAIL).then(() => {
        const m = document.getElementById('demo-copy-msg');
        if (m) { m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 2500); }
      });
    } catch(e) {}
  };

  window._enviarSolicitudDemo = async function() {
    const errDiv = document.getElementById('demo-sol-error');
    const sucDiv = document.getElementById('demo-sol-exito');
    errDiv.style.display = 'none'; sucDiv.style.display = 'none';
    if (!_planDemo) {
      errDiv.textContent = 'Seleccioná un plan primero.';
      errDiv.style.display = 'block'; return;
    }
    const btn = document.getElementById('demo-btn-solicitar-plan');
    btn.disabled = true; btn.textContent = 'Verificando...';
    try {
      const user = auth.currentUser;
      const userEmail = user ? user.email : '';
      const userId = user ? user.uid : '';

      // Verificar si ya existe una solicitud PENDIENTE de este usuario
      // (solo estado=='pendiente', las rechazadas no cuentan)
      try {
        const { getDocs: gd3, query: q3, where: w3, collection: col3 } =
          await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        const solExistQ = await gd3(q3(col3(db, 'solicitudes'), w3('uid', '==', userId), w3('estado', '==', 'pendiente')));
        if (!solExistQ.empty) {
          sucDiv.textContent = '✅ Ya tenés una solicitud pendiente. Te contactaremos a la brevedad.';
          sucDiv.style.display = 'block';
          btn.style.display = 'none';
          return;
        }
      } catch(queryErr) {
        // Si no se puede leer (por reglas de Firestore), igual intentamos escribir
        console.warn('[IAR] No se pudo verificar solicitudes existentes:', queryErr.code || queryErr.message);
      }

      btn.textContent = 'Enviando...';
      await addDoc(collection(db, 'solicitudes'), {
        nombre: userEmail,
        email: userEmail,
        uid: userId,
        plan: _planDemo,
        tipo: 'nuevo',
        estado: 'pendiente',
        fecha: serverTimestamp()
      });
      sucDiv.textContent = `✅ Solicitud enviada (${_planDemo}). Te contactaremos a la brevedad.`;
      sucDiv.style.display = 'block';
      btn.style.display = 'none';
    } catch(e) {
      console.error('[IAR] Error al enviar solicitud demo:', e.code, e.message);
      errDiv.textContent = 'Error al enviar. ' + (e.code === 'permission-denied' ? 'Sin permisos. Verificá que tenés sesión activa.' : 'Verificá tu conexión. (' + (e.code || e.message) + ')');
      errDiv.style.display = 'block';
      btn.disabled = false; btn.textContent = '📩 Solicitar un plan';
    }
  };
}

// ======== COUNTDOWN EN BARRA ========
let countdownBarInterval = null;

function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

function iniciarCountdownEnBarra(msIniciales) {
  if (countdownBarInterval) clearInterval(countdownBarInterval);
  let ms = msIniciales;
  countdownBarInterval = setInterval(() => {
    ms -= 1000;
    const el = document.getElementById("barra-countdown");
    if (!el) { clearInterval(countdownBarInterval); return; }
    if (ms <= 0) {
      el.textContent = "⏳ 00:00:00";
      clearInterval(countdownBarInterval);
      limpiarUI(); mostrarLicenciaVencida(licenciaActual?.esDemo ? `Tu período de prueba expiró.` : `Tu licencia expiró.`, licenciaActual?.esDemo);
      return;
    }
    el.textContent = "⏳ " + formatCountdown(ms);
  }, 1000);
}

function iniciarCountdownLicencia(licencia) {
  if (!licencia.msRestantes) return;
  if (licencia.msRestantes <= 24 * 60 * 60 * 1000) {
    const izq = document.getElementById("barra-sesion-izq");
    if (izq && !document.getElementById("barra-countdown")) {
      const countdown = document.createElement("span");
      countdown.id = "barra-countdown";
      countdown.textContent = "⏳ " + formatCountdown(licencia.msRestantes);
      izq.appendChild(countdown);
    }
    iniciarCountdownEnBarra(licencia.msRestantes);
  }
}

// ======== SOLICITUD DE ACCESO ========
function mostrarFormularioSolicitud() {
  inyectarEstilos();

  if (document.getElementById("solicitud-overlay")) {
    document.getElementById("solicitud-overlay").style.display = "flex";
    return;
  }

  // Pre-fill email and name from current user if logged in (demo user)
  const currentUser = auth.currentUser;
  const prefillEmail = currentUser ? (currentUser.email || '') : '';

  const overlay = document.createElement("div");
  overlay.id = "solicitud-overlay";
  overlay.innerHTML = `
    <div class="solicitud-box">
      <div class="solicitud-titulo">📩 Solicitar acceso completo</div>
      <div class="solicitud-desc">
        Elegí tu plan y enviá la solicitud. Una vez que confirmemos el pago, activamos tu acceso de inmediato.
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
        <div style="font-weight:700;color:#065f46;margin-bottom:6px;">💰 Planes disponibles:</div>
        <div style="font-size:.92rem;color:#047857;"><strong>1 semana</strong> — $10.000</div>
        <div style="font-size:.92rem;color:#047857;margin-top:4px;"><strong>1 mes</strong> — $30.000</div>
      </div>
      <div id="solicitud-error" class="login-error" style="display:none;"></div>
      <div id="solicitud-success" class="login-success" style="display:none;"></div>
      <div class="login-field">
        <label>Nombre completo</label>
        <input type="text" id="sol-nombre" placeholder="Tu nombre" />
      </div>
      <div class="login-field">
        <label>Email (con el que te registraste)</label>
        <input type="email" id="sol-email" placeholder="tu@email.com" value="${prefillEmail}" ${prefillEmail ? 'readonly style="background:#f8fafc;color:#64748b;"' : ''} />
      </div>
      <div class="login-field">
        <label>Plan deseado</label>
        <select id="sol-plan" style="width:100%;padding:11px 14px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:.95rem;color:#1f2937;outline:none;box-sizing:border-box;">
          <option value="1 semana">1 semana — $10.000</option>
          <option value="1 mes" selected>1 mes — $30.000</option>
        </select>
      </div>
      <button id="sol-btn-enviar" class="login-btn">Enviar solicitud</button>
      <div id="sol-loading" class="login-loading"></div>
      <button id="sol-btn-volver" class="login-btn-sec" style="margin-top:8px;">← Volver</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("sol-btn-enviar").addEventListener("click", enviarSolicitud);
  document.getElementById("sol-btn-volver").addEventListener("click", () => {
    overlay.style.display = "none";
  });
}

async function enviarSolicitud() {
  const nombre = (document.getElementById("sol-nombre").value || "").trim();
  const email = (document.getElementById("sol-email").value || "").trim();
  const plan = document.getElementById("sol-plan").value;
  const errDiv = document.getElementById("solicitud-error");
  const sucDiv = document.getElementById("solicitud-success");
  const btn = document.getElementById("sol-btn-enviar");
  const loading = document.getElementById("sol-loading");

  errDiv.style.display = "none";
  sucDiv.style.display = "none";

  if (!nombre || !email) {
    errDiv.textContent = "Completá tu nombre y email.";
    errDiv.style.display = "block";
    return;
  }

  btn.disabled = true;
  loading.textContent = "Enviando solicitud...";

  try {
    const currentUserLocal = auth.currentUser;
    await addDoc(collection(db, "solicitudes"), {
      nombre,
      email,
      uid: currentUserLocal ? currentUserLocal.uid : "",
      plan,
      tipo: "nuevo",
      estado: "pendiente",
      fecha: serverTimestamp()
    });

    sucDiv.textContent = `✅ Solicitud enviada. Nos comunicaremos a ${email} a la brevedad para coordinar el acceso.`;
    sucDiv.style.display = "block";
    btn.style.display = "none";
    loading.textContent = "";
    document.getElementById("sol-nombre").value = "";
    document.getElementById("sol-email").value = "";

  } catch(err) {
    errDiv.textContent = "Error al enviar la solicitud. Verificá tu conexión.";
    errDiv.style.display = "block";
    btn.disabled = false;
    loading.textContent = "";
  }
}

function mostrarLicenciaVencida(mensaje, esDemo, userData) {
  inyectarEstilos();
  document.body.style.overflow = "hidden";
  const loginOverlay = document.getElementById("login-overlay");
  if (loginOverlay) loginOverlay.style.display = "none";
  if (document.getElementById("licencia-vencida-overlay")) return;

  // userData puede venir como parámetro o del auth actual (usuario sigue logueado mientras ve el overlay)
  const currentUser = auth.currentUser
    ? { email: auth.currentUser.email, uid: auth.currentUser.uid }
    : (userData || null);

  const overlay = document.createElement("div");
  overlay.id = "licencia-vencida-overlay";
  overlay.innerHTML = `
    <div class="lv-box">
      <div class="lv-icon">${esDemo ? "⏱️" : "⏰"}</div>
      <div class="lv-titulo">Licencia Vencida</div>
      <div class="lv-msg">${esDemo ? "Tu período de prueba finalizó." : mensaje}</div>
      ${esDemo ? '<div class="lv-msg" style="color:#059669;font-weight:600;">¡Esperamos que hayas disfrutado la prueba! 🎓</div>' : ''}

      <div class="lv-contacto" style="text-align:left;">
        <div style="font-weight:700;color:#1e3a8a;margin-bottom:10px;">💰 Elegí un plan para renovar:</div>
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;" id="lv-planes-container">
          <div class="lv-plan-card" data-plan="1 semana" onclick="window._seleccionarPlanLV('1 semana')" style="flex:1;min-width:120px;background:#eff6ff;border:2.5px solid #93c5fd;border-radius:10px;padding:12px;text-align:center;cursor:pointer;transition:all .15s;">
            <div style="font-size:1.4rem;margin-bottom:4px;">⚡</div>
            <div style="font-weight:800;font-size:1rem;color:#1e40af;">1 semana</div>
            <div style="font-size:1.1rem;font-weight:700;color:#1e3a8a;margin-top:4px;">$10.000</div>
          </div>
          <div class="lv-plan-card" data-plan="1 mes" onclick="window._seleccionarPlanLV('1 mes')" style="flex:1;min-width:120px;background:#eff6ff;border:2.5px solid #3b82f6;border-radius:10px;padding:12px;text-align:center;cursor:pointer;transition:all .15s;">
            <div style="font-size:1.4rem;margin-bottom:4px;">📅</div>
            <div style="font-weight:800;font-size:1rem;color:#1e40af;">1 mes</div>
            <div style="font-size:1.1rem;font-weight:700;color:#1e3a8a;margin-top:4px;">$30.000</div>
          </div>
        </div>
        <div id="lv-plan-seleccionado" style="display:none;background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:8px 12px;font-size:.85rem;color:#065f46;font-weight:600;margin-bottom:10px;text-align:center;"></div>

        <div style="margin-top:8px;margin-bottom:4px;font-size:.9rem;color:#334155;font-weight:600;">Para más información escribinos a:</div>
        <span
          id="lv-email-contacto"
          onclick="window._copiarEmailLV()"
          title="Clic para copiar"
          style="display:inline-block;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:8px;padding:8px 16px;font-weight:700;color:#0d7490;font-size:.95rem;cursor:pointer;-webkit-user-select:text!important;user-select:text!important;word-break:break-all;margin-bottom:4px;">
          ${CONTACTO_EMAIL}
        </span>
        <div id="lv-copy-msg" style="font-size:.75rem;color:#059669;display:none;margin-bottom:6px;">✅ Copiado al portapapeles</div>
      </div>

      <div id="lv-renovar-msg" style="display:none;background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:10px 12px;font-size:.85rem;color:#065f46;font-weight:600;margin-bottom:10px;text-align:center;"></div>
      <div id="lv-renovar-err" style="display:none;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 12px;font-size:.85rem;color:#dc2626;font-weight:600;margin-bottom:10px;text-align:center;"></div>

      <button class="lv-btn" id="lv-btn-renovar" style="background:linear-gradient(135deg,#059669,#047857);width:100%;">🔄 Renovar Plan</button>
      <br>
      <button class="lv-btn lv-btn-sec" id="lv-btn-cerrar" style="margin-top:8px;width:100%;">Cerrar sesión</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Selección de plan
  let planSeleccionado = null;
  window._seleccionarPlanLV = function(plan) {
    planSeleccionado = plan;
    document.querySelectorAll('.lv-plan-card').forEach(card => {
      if (card.dataset.plan === plan) {
        card.style.boxShadow = '0 0 0 3px #059669';
        card.style.borderColor = '#059669';
      } else {
        card.style.boxShadow = '';
        card.style.borderColor = card.dataset.plan === '1 semana' ? '#93c5fd' : '#3b82f6';
      }
    });
    const sel = document.getElementById('lv-plan-seleccionado');
    if (sel) { sel.textContent = `✅ Plan seleccionado: ${plan}`; sel.style.display = 'block'; }
  };

  // Copiar email
  window._copiarEmailLV = function() {
    try {
      navigator.clipboard.writeText(CONTACTO_EMAIL).then(() => {
        const m = document.getElementById('lv-copy-msg');
        if (m) { m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 2500); }
      });
    } catch(e) {
      // fallback: seleccionar texto
      const el = document.getElementById('lv-email-contacto');
      if (el) { const r = document.createRange(); r.selectNode(el); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); }
    }
  };

  document.getElementById("lv-btn-renovar").addEventListener("click", async () => {
    const errDiv = document.getElementById("lv-renovar-err");
    const sucDiv = document.getElementById("lv-renovar-msg");
    errDiv.style.display = "none"; sucDiv.style.display = "none";
    if (!planSeleccionado) {
      errDiv.textContent = "Por favor seleccioná un plan (1 semana o 1 mes).";
      errDiv.style.display = "block"; return;
    }
    const btn = document.getElementById("lv-btn-renovar");
    btn.disabled = true; btn.textContent = "Verificando...";
    try {
      const userEmail = currentUser ? currentUser.email : "";
      const userId = currentUser ? currentUser.uid : "";

      // Verificar si ya existe una solicitud pendiente de este usuario
      // (envuelto en try/catch propio porque las reglas de Firestore pueden no
      // permitir lectura de 'solicitudes' a usuarios normales)
      try {
        const { getDocs: gd2, query: q2, where: w2, collection: col2 } =
          await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        const solExistQ = await gd2(q2(col2(db, "solicitudes"), w2("uid", "==", userId)));
        const tienePendiente2 = !solExistQ.empty && solExistQ.docs.some(d => d.data().estado === "pendiente");
        if (tienePendiente2) {
          sucDiv.textContent = "✅ Ya tenés una solicitud pendiente. Te contactaremos a la brevedad.";
          sucDiv.style.display = "block";
          btn.style.display = "none";
          return;
        }
      } catch(queryErr) {
        // Si no se puede leer (por reglas de Firestore), igual intentamos escribir
        console.warn('[IAR] No se pudo verificar solicitudes existentes:', queryErr.code || queryErr.message);
      }

      btn.textContent = "Enviando...";
      await addDoc(collection(db, "solicitudes"), {
        nombre: userEmail,
        email: userEmail,
        uid: userId,
        plan: planSeleccionado,
        tipo: "renovacion",
        estado: "pendiente",
        fecha: serverTimestamp()
      });
      sucDiv.textContent = `✅ Solicitud de renovación enviada (${planSeleccionado}). Te contactaremos a la brevedad.`;
      sucDiv.style.display = "block";
      btn.style.display = "none";
    } catch(e) {
      console.error('[IAR] Error al enviar solicitud renovación:', e.code, e.message);
      errDiv.textContent = "Error al enviar la solicitud. " + (e.code === 'permission-denied' ? 'Sin permisos de escritura. Verificá que tenés sesión activa.' : 'Verificá tu conexión. (' + (e.code || e.message) + ')');
      errDiv.style.display = "block";
      btn.disabled = false; btn.textContent = "🔄 Renovar Plan";
    }
  });

  document.getElementById("lv-btn-cerrar").addEventListener("click", async () => {
    const ov = document.getElementById("licencia-vencida-overlay");
    if (ov) ov.remove();
    await handleLogout();
    mostrarLogin();
  });
}

// ======== HANDLE LOGIN ========
// ======== RECUPERACIÓN DE CONTRASEÑA ========
async function handleRecuperarPassword() {
  const email = (document.getElementById("recuperar-email")?.value || "").trim();
  const msgDiv = document.getElementById("recuperar-msg");
  const btn = document.getElementById("btn-enviar-recuperar");
  if (!msgDiv || !btn) return;

  if (!email) {
    msgDiv.textContent = "Por favor ingresá tu email.";
    msgDiv.style.cssText = "display:block;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-size:.82rem;font-weight:600;padding:7px 10px;border-radius:6px;margin-bottom:8px;";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Enviando...";
  msgDiv.style.display = "none";

  try {
    await sendPasswordResetEmail(auth, email);
    msgDiv.textContent = "✅ Te enviamos un email con el enlace para restablecer tu contraseña. Revisá también la carpeta de spam.";
    msgDiv.style.cssText = "display:block;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;font-size:.82rem;font-weight:600;padding:7px 10px;border-radius:6px;margin-bottom:8px;";
    btn.style.display = "none";
  } catch(err) {
    let msg = "Error al enviar el email. Verificá tu conexión.";
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
      msg = "No encontramos una cuenta con ese email.";
    } else if (err.code === "auth/too-many-requests") {
      msg = "Demasiados intentos. Esperá unos minutos.";
    }
    msgDiv.textContent = msg;
    msgDiv.style.cssText = "display:block;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-size:.82rem;font-weight:600;padding:7px 10px;border-radius:6px;margin-bottom:8px;";
    btn.disabled = false;
    btn.textContent = "Enviar email";
  }
}

async function handleLogin() {
  const email = (document.getElementById("login-email").value || "").trim();
  const password = document.getElementById("login-password").value || "";
  const errDiv = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");
  const loading = document.getElementById("login-loading");

  errDiv.style.display = "none";
  if (!email || !password) {
    errDiv.textContent = "Por favor completá el email y la contraseña.";
    errDiv.style.display = "block";
    return;
  }

  btn.disabled = true;
  loading.textContent = "Verificando credenciales...";

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    loading.textContent = "Verificando licencia...";
    const licencia = await verificarLicencia(user.uid);
    licenciaActual = licencia;

    if (!licencia.valida) {
      btn.disabled = false;
      loading.textContent = "";
      if (licencia.vencida) {
        // NO hacemos signOut aquí — el usuario sigue autenticado para poder enviar
        // la solicitud de renovación a Firestore. El signOut ocurre al presionar
        // "Cerrar sesión" dentro del overlay de licencia vencida.
        const userDataParaVencida = { email: user.email, uid: user.uid };
        mostrarLicenciaVencida(licencia.mensaje, licencia.esDemo, userDataParaVencida);
      } else {
        await signOut(auth);
        errDiv.textContent = licencia.mensaje;
        errDiv.style.display = "block";
      }
      return;
    }

    loading.textContent = "Verificando sesión activa...";
    const sessionRef = doc(db, "sessions", user.uid);
    const deviceId = getDeviceId();

    // Siempre sobreescribir la sesión con el nuevo deviceId.
    // El onSnapshot activo en cualquier otra ventana o dispositivo
    // detectará el cambio y mostrará la pantalla de "sesión desplazada"
    // automáticamente, cerrando esa sesión anterior.
    // El admin puede abrir sesión libremente sin restricciones.

    await setDoc(sessionRef, {
      deviceId,
      email: user.email,
      loginAt: serverTimestamp(),
      lastActivity: serverTimestamp()
    });

    ocultarLogin(true);
    if (licencia.esDemo) aplicarRestriccionesDemo();
    mostrarBarraSesion(user.email, licencia);
    iniciarMonitoreoSesion(user);
    iniciarCountdownLicencia(licencia);

  } catch (err) {
    btn.disabled = false;
    loading.textContent = "";
    let msg = "Error al ingresar. Verificá tus datos.";
    if (["auth/user-not-found","auth/wrong-password","auth/invalid-credential"].includes(err.code)) msg = "Email o contraseña incorrectos.";
    else if (err.code === "auth/too-many-requests") msg = "Demasiados intentos. Esperá unos minutos.";
    else if (err.code === "auth/network-request-failed") msg = "Error de conexión. Verificá tu internet.";
    errDiv.textContent = msg;
    errDiv.style.display = "block";
  }
}

function ocultarLogin(navegarAMenu = false) {
  const overlay = document.getElementById("login-overlay");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
  if (navegarAMenu) {
    window.location.hash = "menu";
  }
}

// ======== BARRA INFERIOR ESTÁTICA ========
function mostrarBarraSesion(email, licencia) {
  // Eliminar barra anterior si existe (para re-renderizar)
  const barraVieja = document.getElementById("barra-sesion");
  if (barraVieja) barraVieja.remove();

  const barra = document.createElement("div");
  barra.id = "barra-sesion";

  // Izquierda: usuario + badge licencia
  const izq = document.createElement("div");
  izq.id = "barra-sesion-izq";

  const info = document.createElement("div");
  info.id = "usuario-info";
  info.title = email;
  info.textContent = "👤 " + (email.length > 28 ? email.substring(0, 25) + "..." : email);

  const badge = document.createElement("div");
  badge.id = "licencia-badge";
  if (licencia.esDemo) {
    badge.textContent = `🆓 DEMO — ${licencia.horasRestantes}hs restantes`;
    badge.className = licencia.horasRestantes <= 24 ? "vence-pronto" : "";
  } else if (licencia.porVida) {
    badge.textContent = "✅ De por vida";
    badge.className = "por-vida";
  } else if (licencia.diasRestantes !== undefined) {
    if (licencia.diasRestantes <= 7) {
      badge.textContent = `⚠️ Vence en ${licencia.diasRestantes}d`;
      badge.className = "vence-pronto";
    } else {
      const fecha = licencia.vencimiento.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
      badge.textContent = `📅 Hasta ${fecha}`;
      badge.className = "";
    }
  }

  izq.appendChild(info);
  izq.appendChild(badge);

  // Derecha: botones cerrar sesión (y admin si corresponde)
  const der = document.createElement("div");
  der.id = "barra-sesion-der";

  // Botón admin solo para el admin
  if (email === ADMIN_EMAIL) {
    const btnAdmin = document.createElement("button");
    btnAdmin.id = "btn-abrir-admin";
    btnAdmin.innerHTML = "⚙️ Admin";
    btnAdmin.style.position = "relative";
    btnAdmin.addEventListener("click", mostrarPanelAdmin);
    der.appendChild(btnAdmin);
    // Iniciar listener en tiempo real de solicitudes pendientes
    iniciarListenerSolicitudes();
  }

  const btnLogout = document.createElement("button");
  btnLogout.id = "btn-cerrar-sesion";
  btnLogout.textContent = "Cerrar sesión";
  btnLogout.addEventListener("click", handleLogout);
  der.appendChild(btnLogout);

  barra.appendChild(izq);
  barra.appendChild(der);
  document.body.appendChild(barra);

  // Padding para que el contenido no quede tapado por la barra
  document.body.style.paddingBottom = "46px";
}

// ======== LISTENER TIEMPO REAL SOLICITUDES ========
function iniciarListenerSolicitudes() {
  if (_solicitudesUnsubscribe) return; // ya activo

  const q = query(collection(db, "solicitudes"), where("estado", "==", "pendiente"));

  _solicitudesUnsubscribe = onSnapshot(q, (snapshot) => {
    // Guardar siempre el último snapshot para renderizarlo cuando se abra el panel
    _ultimoSnapshotSolicitudes = snapshot;
    const total = snapshot.size;

    // Actualizar badge en el botón Admin
    const btn = document.getElementById("btn-abrir-admin");
    if (btn) {
      let badge = btn.querySelector(".admin-sol-badge");
      if (total > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "admin-sol-badge";
          btn.appendChild(badge);
        }
        badge.textContent = total > 99 ? "99+" : String(total);
      } else {
        if (badge) badge.remove();
      }
    }

    // Si el panel está abierto, renderizar solicitudes en tiempo real
    const overlay = document.getElementById("admin-overlay");
    if (overlay && overlay.style.display !== "none") {
      renderizarSolicitudesAdmin(snapshot);
    }
  }, (err) => {
    console.warn("[IAR Admin] Error en listener solicitudes:", err.code);
  });
}

function detenerListenerSolicitudes() {
  if (_solicitudesUnsubscribe) {
    _solicitudesUnsubscribe();
    _solicitudesUnsubscribe = null;
  }
  _ultimoSnapshotSolicitudes = null;
}

function renderizarSolicitudesAdmin(snapshot) {
  const solNuevosDiv = document.getElementById("admin-sol-nuevos");
  const solRenovDiv = document.getElementById("admin-sol-renovaciones");
  if (!solNuevosDiv || !solRenovDiv) return;

  const nuevos = [], renovaciones = [];
  snapshot.forEach(d => {
    const tipo = d.data().tipo;
    if (tipo === "renovacion") renovaciones.push(d);
    else nuevos.push(d);
  });

  function renderTabla(docs, tipo) {
    if (docs.length === 0) {
      return `<em style="color:#94a3b8;font-size:.82rem;">Sin solicitudes ${tipo === "nuevo" ? "de nuevos usuarios" : "de renovación"} pendientes.</em>`;
    }
    let html = `<div style="overflow-x:auto;"><table class="admin-tabla"><thead><tr>
      <th>Email</th><th>UID</th><th>Plan</th><th>Fecha</th><th>Acciones</th>
    </tr></thead><tbody>`;
    docs.forEach(d => {
      const s = d.data();
      const fecha = s.fecha ? (s.fecha.toDate ? s.fecha.toDate() : new Date(s.fecha)).toLocaleDateString("es-AR") : "-";
      const uid = s.uid || "-";
      const uidCorto = uid !== "-" ? uid.substring(0,10)+"…" : "-";
      html += `<tr>
        <td style="font-size:.8rem;max-width:160px;word-break:break-all;">${s.email||"-"}</td>
        <td style="font-family:monospace;font-size:.72rem;" title="${uid}">${uidCorto}</td>
        <td>
          <select id="sol-plan-sel-${d.id}" style="font-size:.75rem;padding:3px 6px;border:1px solid #cbd5e1;border-radius:4px;">
          <option value="1 semana" ${s.plan==="1 semana"||!s.plan?"selected":""}>1 semana</option>
          <option value="1 mes" ${s.plan==="1 mes"?"selected":""}>1 mes</option>            
          <option value="1 min TEST" ${s.plan==="1 min TEST"?"selected":""} style="color:#d97706;font-style:italic;">⚙️ 1 min (TEST)</option>
          </select>
        </td>
        <td style="font-size:.8rem;">${fecha}</td>
        <td style="white-space:nowrap;">
          <button class="admin-btn admin-btn-success" style="font-size:.75rem;padding:5px 10px;"
            onclick="window.aprobarSolicitud('${d.id}','${s.email}','${uid}')">✅ Aprobar</button>
          <button class="admin-btn-rechazar"
            onclick="window.rechazarSolicitud('${d.id}')">✕ Rechazar</button>
        </td>
      </tr>`;
    });
    html += "</tbody></table></div>";
    return html;
  }

  solNuevosDiv.innerHTML = renderTabla(nuevos, "nuevo");
  solRenovDiv.innerHTML = renderTabla(renovaciones, "renovacion");
}

// ======== PANEL ADMINISTRADOR ========
async function mostrarPanelAdmin() {
  if (document.getElementById("admin-overlay")) {
    document.getElementById("admin-overlay").style.display = "flex";
    // Renderizar solicitudes guardadas inmediatamente antes de cargar el resto
    if (_ultimoSnapshotSolicitudes) {
      renderizarSolicitudesAdmin(_ultimoSnapshotSolicitudes);
    }
    await cargarDatosAdmin();
    return;
  }

  // Estilos extra para el panel admin mejorado
  if (!document.getElementById("admin-extra-styles")) {
    const s = document.createElement("style");
    s.id = "admin-extra-styles";
    s.textContent = `
      .admin-badge {
        display:inline-block;padding:3px 10px;border-radius:20px;font-size:.73rem;font-weight:700;letter-spacing:.03em;
      }
      .badge-activo { background:#d1fae5;color:#065f46; }
      .badge-vencido { background:#fee2e2;color:#dc2626; }
      .badge-demo { background:#fef3c7;color:#92400e; }
      .badge-nuevo { background:#dbeafe;color:#1e40af; }
      .badge-renovacion { background:#ede9fe;color:#5b21b6; }
      .admin-sol-section { margin-bottom:12px; }
      .admin-sol-section-titulo {
        font-size:.75rem;font-weight:800;color:#475569;text-transform:uppercase;
        letter-spacing:.06em;padding:6px 10px;background:#f1f5f9;
        border-radius:6px;margin-bottom:6px;border-left:3px solid #0d7490;
      }
      .admin-tabla td, .admin-tabla th { vertical-align:middle; }
      .admin-btn-rechazar {
        background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;
        font-size:.72rem;padding:4px 9px;border-radius:6px;cursor:pointer;font-weight:700;
        transition:all .15s;margin-left:3px;
      }
      .admin-btn-rechazar:hover { background:#fca5a5; }
      .admin-dias-restantes { font-size:.72rem;color:#059669;font-weight:700; }
      .admin-dias-vencido { font-size:.72rem;color:#dc2626;font-weight:700; }
    `;
    document.head.appendChild(s);
  }

  const overlay = document.createElement("div");
  overlay.id = "admin-overlay";
  overlay.innerHTML = `
    <div class="admin-box" style="max-width:1100px;">
      <div class="admin-titulo">
        ⚙️ Panel de Administración
        <button class="admin-btn admin-btn-cerrar" id="admin-cerrar">✕ Cerrar</button>
      </div>

      <!-- Estadísticas -->
      <div class="admin-seccion">
        <h3>📊 Visitas únicas</h3>
        <div id="admin-visitas"><em style="color:#94a3b8;font-size:.85rem;">Cargando...</em></div>
      </div>

      <!-- Solicitudes Pendientes: 2 subsecciones -->
      <div class="admin-seccion">
        <h3>📋 Solicitudes Pendientes</h3>
        <div id="admin-msg-acciones" class="admin-msg" style="display:none;margin-bottom:8px;"></div>

        <!-- Subsección 1: Solicitudes desde DEMO (nuevos) -->
        <div class="admin-sol-section">
          <div class="admin-sol-section-titulo" style="border-left-color:#1e40af;">
            🆕 Solicitudes desde DEMO — Nuevos usuarios
          </div>
          <div id="admin-sol-nuevos"><em style="color:#94a3b8;font-size:.82rem;">Cargando...</em></div>
        </div>

        <!-- Subsección 2: Renovaciones de licencia -->
        <div class="admin-sol-section" style="margin-top:14px;">
          <div class="admin-sol-section-titulo" style="border-left-color:#5b21b6;">
            🔄 Renovaciones de Licencia — Usuarios existentes
          </div>
          <div id="admin-sol-renovaciones"><em style="color:#94a3b8;font-size:.82rem;">Cargando...</em></div>
        </div>
      </div>

      <!-- Usuarios con licencia -->
      <div class="admin-seccion">
        <h3>👥 Usuarios con licencia</h3>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
          <button class="admin-btn" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-size:.78rem;padding:5px 12px;" onclick="window.limpiarVencidosAdmin()">
            🗑️ Eliminar vencidos hace +3 meses
          </button>
          <span id="admin-limpiar-msg" style="font-size:.78rem;color:#64748b;"></span>
        </div>
        <div id="admin-usuarios"><em style="color:#94a3b8;font-size:.85rem;">Cargando...</em></div>
      </div>

      <!-- Administrar Chat -->
      <div class="admin-seccion" style="border-top:2px solid #fee2e2;padding-top:16px;margin-top:4px;">
        <h3 style="color:#dc2626;">🗑️ Administrar Chat</h3>
        <p style="font-size:.82rem;color:#64748b;margin-bottom:10px;">Borra permanentemente todos los mensajes del chat global.</p>
        <button class="admin-btn" style="background:#dc2626;color:white;font-size:.82rem;padding:7px 16px;" onclick="window.borrarTodosLosChats()">
          🗑️ Borrar todos los mensajes del chat
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("admin-cerrar").addEventListener("click", () => overlay.style.display = "none");
  await cargarDatosAdmin();
}

function calcularVencimiento(plan) {
  if (plan === "devida") return null;
  const d = new Date();
  if (plan === "1min") {
    d.setTime(d.getTime() + 60 * 1000);
    return d;
  }
  const dias = { "1semana":7, "1mes":30 };
  d.setDate(d.getDate() + (dias[plan] || 30));
  return d;
}

function formatFecha(ts) {
  if (!ts) return "De por vida";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
}

async function cargarDatosAdmin() {
  const solNuevosDiv = document.getElementById("admin-sol-nuevos");
  const solRenovDiv = document.getElementById("admin-sol-renovaciones");
  const usrDiv = document.getElementById("admin-usuarios");
  const visDiv = document.getElementById("admin-visitas");
  if (!usrDiv) return;

  try {
    const { getDocs, collection: col, query, where, orderBy } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    // Estadísticas de visitas únicas
    if (visDiv) {
      try {
        const statsSnap = await getDoc(doc(db, "estadisticas", "visitas"));
        if (statsSnap.exists()) {
          const s = statsSnap.data();
          visDiv.innerHTML = `
            <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:4px;">
              <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 20px;text-align:center;">
                <div style="font-size:1.8rem;font-weight:700;color:#0369a1;">${s.total || 0}</div>
                <div style="font-size:.78rem;color:#64748b;margin-top:2px;">TOTAL</div>
              </div>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 20px;text-align:center;">
                <div style="font-size:1.8rem;font-weight:700;color:#15803d;">${s.totalPago || 0}</div>
                <div style="font-size:.78rem;color:#64748b;margin-top:2px;">PAGO</div>
              </div>
              <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 20px;text-align:center;">
                <div style="font-size:1.8rem;font-weight:700;color:#b45309;">${s.totalDemo || 0}</div>
                <div style="font-size:.78rem;color:#64748b;margin-top:2px;">DEMO</div>
              </div>
            </div>
            <p style="font-size:.75rem;color:#94a3b8;margin-top:6px;">Cada usuario se cuenta una sola vez, sin importar cuántas veces inicie sesión.</p>`;
        } else {
          visDiv.innerHTML = '<em style="color:#94a3b8;font-size:.85rem;">Sin datos aún.</em>';
        }
      } catch(e) { visDiv.innerHTML = '<em style="color:#dc2626;">Error al cargar visitas.</em>'; }
    }

    // ── Solicitudes pendientes ──
    // Si ya tenemos un snapshot guardado del listener, renderizarlo inmediatamente
    if (_ultimoSnapshotSolicitudes) {
      renderizarSolicitudesAdmin(_ultimoSnapshotSolicitudes);
    } else {
      if (solNuevosDiv) solNuevosDiv.innerHTML = '<em style="color:#94a3b8;font-size:.82rem;">Esperando datos en tiempo real...</em>';
      if (solRenovDiv) solRenovDiv.innerHTML = '<em style="color:#94a3b8;font-size:.82rem;">Esperando datos en tiempo real...</em>';
    }
    // Si el listener aún no está activo (ej: admin abre panel desde otra ruta), arrancarlo
    if (!_solicitudesUnsubscribe) iniciarListenerSolicitudes();

    // ── Usuarios con licencia ──
    const licSnap = await getDocs(col(db, "licencias"));
    if (licSnap.empty) {
      usrDiv.innerHTML = '<em style="color:#94a3b8;font-size:.85rem;">No hay usuarios con licencia.</em>';
    } else {
      const ahora = new Date();
      const docs = [];
      licSnap.forEach(d => docs.push(d));
      // Activos primero, vencidos al final
      docs.sort((a, b) => {
        const getTs = d => {
          const v = d.data().vencimiento;
          if (!v) return 0;
          return (v.toDate ? v.toDate() : new Date(v)).getTime();
        };
        const aV = a.data().porVida ? Infinity : getTs(a);
        const bV = b.data().porVida ? Infinity : getTs(b);
        return aV - bV;
      });
      let html = `<div style="overflow-x:auto;"><table class="admin-tabla"><thead><tr>
        <th>Email</th><th>UID</th><th>Plan</th><th>Aprobado el</th><th>Vence el</th><th>Tiempo restante</th><th>Estado</th><th>Reactivar</th><th>Eliminar</th>
      </tr></thead><tbody>`;
      docs.forEach(d => {
        const l = d.data();
        const uid = d.id;
        const emailUsr = l.email || '-';
        const vencDate = l.vencimiento ? (l.vencimiento.toDate ? l.vencimiento.toDate() : new Date(l.vencimiento)) : null;
        const aprobadoDate = l.aprobadoEn ? (l.aprobadoEn.toDate ? l.aprobadoEn.toDate() : new Date(l.aprobadoEn)) : null;
        const esDemo = l.esDemo === true;
        const vencido = !l.porVida && !esDemo && vencDate && ahora > vencDate;

        // Estado badge
        let estadoBadge;
        if (esDemo) estadoBadge = '<span class="admin-badge badge-demo">🆓 Demo</span>';
        else if (l.porVida) estadoBadge = '<span class="admin-badge badge-activo">✅ Activo</span>';
        else if (vencido) estadoBadge = '<span class="admin-badge badge-vencido">❌ Vencido</span>';
        else estadoBadge = '<span class="admin-badge badge-activo">✅ Activo</span>';

        // Tiempo restante
        let tiempoRestante = '-';
        if (esDemo) {
          tiempoRestante = '<span style="color:#92400e;font-size:.75rem;">—</span>';
        } else if (l.porVida) {
          tiempoRestante = '<span style="color:#065f46;font-size:.75rem;">∞ Sin límite</span>';
        } else if (vencDate) {
          const diffMs = vencDate - ahora;
          if (diffMs <= 0) {
            const diasVenc = Math.floor(Math.abs(diffMs) / (1000*60*60*24));
            tiempoRestante = `<span class="admin-dias-vencido">Venció hace ${diasVenc}d</span>`;
          } else {
            const dias = Math.floor(diffMs / (1000*60*60*24));
            const horas = Math.floor((diffMs % (1000*60*60*24)) / (1000*60*60));
            tiempoRestante = dias > 0
              ? `<span class="admin-dias-restantes">⏳ ${dias}d ${horas}h</span>`
              : `<span class="admin-dias-vencido">⚠️ ${horas}h restantes</span>`;
          }
        }

        const rowStyle = vencido ? 'style="background:#fff7f7;"' : (esDemo ? 'style="background:#fffbeb;"' : '');
        const aprobadoStr = aprobadoDate ? aprobadoDate.toLocaleDateString("es-AR", {day:"2-digit",month:"2-digit",year:"numeric"}) : '-';
        const vencStr = l.porVida ? '∞' : (vencDate ? vencDate.toLocaleDateString("es-AR", {day:"2-digit",month:"2-digit",year:"numeric"}) : '-');

        html += `<tr ${rowStyle}>
          <td style="font-size:.8rem;max-width:150px;word-break:break-all;" title="${emailUsr}">${emailUsr}</td>
          <td title="${uid}" style="font-family:monospace;font-size:.72rem;">${uid.substring(0,10)}…</td>
          <td style="font-size:.82rem;">${l.plan||"-"}</td>
          <td style="font-size:.8rem;">${aprobadoStr}</td>
          <td style="font-size:.8rem;">${vencStr}</td>
          <td>${tiempoRestante}</td>
          <td>${estadoBadge}</td>
          <td style="white-space:nowrap;">
            <select id="sel-plan-${uid}" style="font-size:.72rem;padding:2px 4px;border:1px solid #cbd5e1;border-radius:4px;">
              <option value="1semana" selected>1 semana</option>
              <option value="1mes">1 mes</option>
              <option value="1min" style="color:#d97706;font-style:italic;">⚙️ 1 min (TEST)</option>
            </select>
            <button class="admin-btn admin-btn-success" style="font-size:.72rem;padding:3px 8px;margin-left:3px;"
              onclick="window.reactivarUsuario('${uid}')">▶ Activar</button>
          </td>
          <td>
            <button class="admin-btn" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-size:.72rem;padding:3px 8px;"
              onclick="window.eliminarUsuario('${uid}')">🗑</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table></div>';
      usrDiv.innerHTML = html;
    }
  } catch(err) {
    console.error("Error cargando datos admin:", err);
    if (solNuevosDiv) solNuevosDiv.innerHTML = '<em style="color:#dc2626;">Error al cargar datos.</em>';
  }
}
// ── Aprobar solicitud ─────────────────────────────────────────────────────
// El vencimiento se calcula desde el momento exacto de aprobación.
// Si el usuario ya existe en "licencias" (renovación), se actualiza su plan.
// Si es nuevo, se crea su entrada. La solicitud se elimina de Firestore para
// que desaparezca de la lista inmediatamente. El cache local del snapshot
// también se actualiza para evitar re-aparición por race condition.
window.aprobarSolicitud = async function(docId, email, uidSolicitud, planLabel) {
  // Leer el valor del select en el momento del click (puede venir como string o como value)
  const selEl = document.getElementById('sol-plan-sel-' + docId);
  const planLabelFinal = selEl ? selEl.value : (planLabel || "1 mes");

  const planMap = { "1 mes":"1mes","1 semana":"1semana","1 min TEST":"1min" };
  const planKey = planMap[planLabelFinal] || "1mes";
  const planNombres = { "1semana":"1 semana","1mes":"1 mes","1min":"1 min (TEST)" };

  const venc = calcularVencimiento(planKey);
  const ahora = new Date();

  const licData = {
    porVida: false,
    esDemo: false,
    plan: planNombres[planKey],
    email,
    vencimiento: venc,
    aprobadoEn: ahora
  };

  const msgDiv = document.getElementById("admin-msg-acciones");
  try {
    const { getDocs, collection: col2, query: q2, where: w2 } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    // Escribir/actualizar la licencia en Firebase
    let licSet = false;

    // 1) Si tiene UID, intentar directo
    if (uidSolicitud && uidSolicitud !== '-') {
      try {
        await setDoc(doc(db, "licencias", uidSolicitud), licData, { merge: false });
        licSet = true;
      } catch(e) { console.warn("No se pudo setDoc por UID directo:", e); }
    }

    // 2) Si no se pudo por UID, buscar por email en licencias existentes
    if (!licSet) {
      const licQ = await getDocs(q2(col2(db, "licencias"), w2("email", "==", email)));
      if (!licQ.empty) {
        const promises = [];
        licQ.forEach(d2 => promises.push(setDoc(doc(db, "licencias", d2.id), licData)));
        await Promise.all(promises);
        licSet = true;
      }
    }

    // 3) Si el usuario es completamente nuevo (sin licencia previa), crear con UID de la solicitud
    //    o con un ID generado a partir del email
    if (!licSet) {
      const nuevoId = (uidSolicitud && uidSolicitud !== '-')
        ? uidSolicitud
        : email.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now().toString(36);
      await setDoc(doc(db, "licencias", nuevoId), licData);
      licSet = true;
    }

    // 1. Respuesta visual inmediata: ocultar la fila del DOM
    document.querySelectorAll(".admin-tabla tr").forEach(row => {
      if (row.innerHTML.includes(docId)) row.style.display = "none";
    });

    // 2. Actualizar cache local ANTES de los writes para evitar re-aparición por race condition
    if (_ultimoSnapshotSolicitudes) {
      const docsActualizados = [];
      _ultimoSnapshotSolicitudes.forEach(d => { if (d.id !== docId) docsActualizados.push(d); });
      const fakeSnap = { size: docsActualizados.length, forEach: (fn) => docsActualizados.forEach(fn) };
      _ultimoSnapshotSolicitudes = fakeSnap;
      renderizarSolicitudesAdmin(fakeSnap);
    }

    // 3. Marcar como 'aprobada' primero (el listener filtra estado=='pendiente'
    //    y el doc sale del snapshot automáticamente)
    await updateDoc(doc(db, "solicitudes", docId), { estado: "aprobada" });

    // 4. Eliminar físicamente la solicitud aprobada
    await deleteDoc(doc(db, "solicitudes", docId));

    // 5. Eliminar también cualquier otra solicitud pendiente del mismo usuario
    //    (por UID y por email) para no dejar duplicados
    try {
      const { getDocs: gd4, query: q4, where: w4, collection: col4 } =
        await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const extraPromises = [];
      if (uidSolicitud && uidSolicitud !== '-') {
        const qUid = await gd4(q4(col4(db, "solicitudes"), w4("uid", "==", uidSolicitud)));
        qUid.forEach(d => { if (d.id !== docId) extraPromises.push(deleteDoc(doc(db, "solicitudes", d.id))); });
      }
      if (email) {
        const qEmail = await gd4(q4(col4(db, "solicitudes"), w4("email", "==", email)));
        qEmail.forEach(d => { if (d.id !== docId) extraPromises.push(deleteDoc(doc(db, "solicitudes", d.id))); });
      }
      if (extraPromises.length > 0) await Promise.all(extraPromises);
    } catch(cleanErr) {
      console.warn("[IAR] No se pudieron limpiar solicitudes extra:", cleanErr.message);
    }

    if (msgDiv) {
      msgDiv.style.display = "block";
      const vencStr = planKey === "1min" ? "en 1 minuto (TEST)" : (venc ? "el " + venc.toLocaleDateString("es-AR") : "ahora");
      msgDiv.textContent = `✅ Licencia activada para ${email} (${planNombres[planKey]}) — vence ${vencStr}`;
      msgDiv.className = "admin-msg ok";
      setTimeout(() => { if (msgDiv) { msgDiv.style.display = "none"; msgDiv.className = "admin-msg"; } }, 5000);
    }

    // Recargar solo la tabla de usuarios con licencia (las solicitudes ya se actualizaron en tiempo real)
    await cargarDatosAdmin();
  } catch(e) {
    console.error("Error aprobando solicitud:", e);
    // Restaurar visibilidad si falló
    document.querySelectorAll(".admin-tabla tr").forEach(row => {
      if (row.innerHTML.includes(docId)) row.style.display = "";
    });
    if (msgDiv) {
      msgDiv.style.display = "block";
      msgDiv.textContent = "❌ Error al aprobar: " + (e.message || e);
      msgDiv.className = "admin-msg err";
    }
  }
};

// ── Rechazar solicitud ────────────────────────────────────────────────────
// Primero actualiza estado='rechazado' (el listener filtra por estado=='pendiente'
// y el doc desaparece del snapshot), luego elimina físicamente el doc.
// El usuario podrá volver a solicitar porque no quedará doc pendiente a su nombre.
window.rechazarSolicitud = async function(docId) {
  const msgDiv = document.getElementById("admin-msg-acciones");
  try {
    // 1. Respuesta visual inmediata: ocultar la fila del DOM
    document.querySelectorAll(".admin-tabla tr").forEach(row => {
      if (row.innerHTML.includes(docId)) row.style.display = "none";
    });

    // 2. Actualizar cache local ANTES de los writes para evitar re-aparición por race condition
    if (_ultimoSnapshotSolicitudes) {
      const docsActualizados = [];
      _ultimoSnapshotSolicitudes.forEach(d => { if (d.id !== docId) docsActualizados.push(d); });
      const fakeSnap = { size: docsActualizados.length, forEach: (fn) => docsActualizados.forEach(fn) };
      _ultimoSnapshotSolicitudes = fakeSnap;
      renderizarSolicitudesAdmin(fakeSnap);
    }

    // 3. Actualizar estado a 'rechazado' → el onSnapshot (estado=='pendiente')
    //    eliminará el doc del snapshot y re-renderizará automáticamente sin él.
    await updateDoc(doc(db, "solicitudes", docId), { estado: "rechazado" });

    // 4. Eliminar físicamente el doc (el usuario puede volver a solicitar)
    await deleteDoc(doc(db, "solicitudes", docId));

    if (msgDiv) {
      msgDiv.style.display = "block";
      msgDiv.textContent = "Solicitud rechazada. El usuario podrá solicitar nuevamente.";
      msgDiv.className = "admin-msg err";
      setTimeout(() => { if (msgDiv) { msgDiv.style.display = "none"; msgDiv.className = "admin-msg"; } }, 3000);
    }
  } catch(e) {
    console.error("Error rechazando solicitud:", e);
    // Restaurar visibilidad si falló
    document.querySelectorAll(".admin-tabla tr").forEach(row => {
      if (row.innerHTML.includes(docId)) row.style.display = "";
    });
    if (msgDiv) {
      msgDiv.style.display = "block";
      msgDiv.textContent = "❌ Error al rechazar: " + (e.message || e);
      msgDiv.className = "admin-msg err";
    }
  }
};

// ── Reactivar plan ────────────────────────────────────────────────────────
window.reactivarUsuario = async function(uid) {
  const sel = document.getElementById("sel-plan-" + uid);
  if (!sel) return;
  const plan = sel.value;
  const planNombres = { "1semana":"1 semana","1mes":"1 mes","1min":"1 min (TEST)" };
  const venc = calcularVencimiento(plan);
  const ahora = new Date();
  const licData = { porVida: false, plan: planNombres[plan], vencimiento: venc, aprobadoEn: ahora };
  try {
    const snap = await getDoc(doc(db, "licencias", uid));
    let emailUsuario = null;
    if (snap.exists() && snap.data().email) {
      emailUsuario = snap.data().email;
      licData.email = emailUsuario;
    }
    await setDoc(doc(db, "licencias", uid), licData);

    // Eliminar solicitudes pendientes de este usuario (queries simples sin índice compuesto)
    const { getDocs: gd3, query: q3, where: w3, collection: col3 } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const elimPromises = [];
    try {
      // Buscar por uid (query simple, sin índice compuesto)
      const solQ = await gd3(q3(col3(db, "solicitudes"), w3("uid", "==", uid)));
      solQ.forEach(d => {
        if (d.data().estado === "pendiente") elimPromises.push(deleteDoc(doc(db, "solicitudes", d.id)));
      });
      // Si no encontró por uid, buscar por email
      if (elimPromises.length === 0 && emailUsuario) {
        const solQEmail = await gd3(q3(col3(db, "solicitudes"), w3("email", "==", emailUsuario)));
        solQEmail.forEach(d => {
          if (d.data().estado === "pendiente") elimPromises.push(deleteDoc(doc(db, "solicitudes", d.id)));
        });
      }
      if (elimPromises.length > 0) await Promise.all(elimPromises);
    } catch(solErr) {
      // No bloquear la reactivación si falla la limpieza de solicitudes
      console.warn("[IAR] No se pudo limpiar solicitudes pendientes:", solErr.message);
    }

    await cargarDatosAdmin();
  } catch(err) { alert("Error al reactivar: " + (err.message || err)); }
};

// ── Eliminar usuario ──────────────────────────────────────────────────────
window.eliminarUsuario = async function(uid) {
  if (!confirm("¿Eliminar este usuario?\nUID: " + uid + "\n\nSe borrará su licencia y sesión de Firestore.")) return;
  try {
    await deleteDoc(doc(db, "licencias", uid));
    await deleteDoc(doc(db, "sessions", uid)).catch(() => {});
    await cargarDatosAdmin();
  } catch(err) { alert("Error al eliminar: " + (err.message || err)); }
};

// ── Eliminar vencidos hace +3 meses ──────────────────────────────────────
window.limpiarVencidosAdmin = async function() {
  const msgEl = document.getElementById("admin-limpiar-msg");
  if (msgEl) msgEl.textContent = "Calculando...";
  try {
    const { getDocs, collection: col3 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const licSnap = await getDocs(col3(db, "licencias"));
    const ahora = new Date();
    const tresM = new Date(ahora); tresM.setMonth(tresM.getMonth() - 3);
    const aEliminar = [];
    licSnap.forEach(d => {
      const l = d.data();
      if (l.porVida || l.esDemo) return;
      const vencDate = l.vencimiento ? (l.vencimiento.toDate ? l.vencimiento.toDate() : new Date(l.vencimiento)) : null;
      if (vencDate && vencDate < tresM) aEliminar.push(d.id);
    });
    if (aEliminar.length === 0) { if (msgEl) msgEl.textContent = "No hay usuarios vencidos hace más de 3 meses."; return; }
    if (!confirm(`Se eliminarán ${aEliminar.length} usuario(s) vencidos hace más de 3 meses. ¿Confirmás?`)) { if (msgEl) msgEl.textContent = ""; return; }
    for (const uid of aEliminar) {
      await deleteDoc(doc(db, "licencias", uid)).catch(() => {});
      await deleteDoc(doc(db, "sessions", uid)).catch(() => {});
    }
    if (msgEl) msgEl.textContent = `✅ ${aEliminar.length} usuario(s) eliminado(s).`;
    await cargarDatosAdmin();
  } catch(err) { if (msgEl) msgEl.textContent = "Error: " + (err.message || err); }
};

// ── Borrar todos los chats ────────────────────────────────────────────────
window.borrarTodosLosChats = async function() {
  if (!confirm("¿Borrar TODOS los mensajes del chat?\n\nEsta acción no se puede deshacer.")) return;
  try {
    const { remove: rtRemove } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    await rtRemove(ref(rtdb, 'chat/mensajes'));
    // Clear local welcome flag so it shows again
    localStorage.removeItem('iar_chat_welcome_shown_v1');
    // Re-render chat if open
    const container = document.getElementById('chat-mensajes');
    if (container) container.innerHTML = '<div class="chat-vacio">Chat limpiado. ¡Sé el primero en escribir!</div>';
    alert("✅ Todos los mensajes del chat fueron eliminados.");
  } catch(err) { alert("Error al borrar chat: " + (err.message || err)); }
};

// ======== LOGOUT ========
async function handleLogout() {
  try {
    // ── CRÍTICO: detener el listener de sesión ANTES de borrar el doc ──
    // Si no se hace, el onSnapshot detecta que el doc desapareció y muestra
    // la pantalla "Sesión finalizada por el administrador" — que es incorrecta
    // cuando el propio usuario está cerrando sesión voluntariamente.
    if (monitoreoSnapshot) { monitoreoSnapshot(); monitoreoSnapshot = null; }
    if (monitoreoInterval) { clearInterval(monitoreoInterval); monitoreoInterval = null; }
    detenerListenersActividad();

    const user = auth.currentUser;
    if (user) await deleteDoc(doc(db, "sessions", user.uid));
    await signOut(auth);
  } catch (err) {
    await signOut(auth).catch(() => {});
  }
}

// ======== PANTALLA SESIÓN DESPLAZADA ========
function mostrarPantallaDesplazada(tipo) {
  ["login-overlay", "sesion-desplazada-overlay"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  document.body.style.overflow = "hidden";

  const esEliminada = tipo === "eliminada";
  const overlay = document.createElement("div");
  overlay.id = "sesion-desplazada-overlay";
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(15,23,42,0.92);
    z-index:999999;display:flex;justify-content:center;align-items:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
  `;
  overlay.innerHTML = `
    <div style="
      background:#fff;border-radius:20px;padding:44px 36px;
      width:100%;max-width:420px;margin:16px;text-align:center;
      box-shadow:0 32px 80px rgba(0,0,0,0.4);
    ">
      <div style="
        width:72px;height:72px;border-radius:50%;
        background:linear-gradient(135deg,#fef3c7,#fde68a);
        display:flex;align-items:center;justify-content:center;
        font-size:2.2rem;margin:0 auto 20px;
      ">🔐</div>
      <h2 style="font-size:1.25rem;font-weight:800;color:#0f172a;margin:0 0 10px;">
        ${esEliminada ? "Sesión finalizada" : "Sesión abierta en otro lugar"}
      </h2>
      <p style="font-size:.92rem;color:#475569;line-height:1.65;margin:0 0 28px;">
        ${esEliminada
          ? "Tu sesión fue cerrada por el administrador. Si creés que es un error, iniciá sesión nuevamente o contactá al soporte."
          : "Tu cuenta fue abierta en <strong>otra ventana, pestaña o dispositivo</strong>. Para evitar el uso simultáneo, esta sesión fue cerrada automáticamente. Solo puede haber una sesión activa a la vez."
        }
      </p>
      <div style="
        background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;
        padding:14px 18px;margin-bottom:28px;
        display:flex;align-items:center;gap:12px;text-align:left;
      ">
        <span style="font-size:1.4rem;flex-shrink:0;">ℹ️</span>
        <p style="font-size:.8rem;color:#64748b;margin:0;line-height:1.5;">
          ${esEliminada
            ? `Si necesitás acceso, comunicate con el administrador al correo <strong>${CONTACTO_EMAIL}</strong>`
            : "Si fuiste vos quien abrió la otra sesión, podés cerrar esta ventana. Si no reconocés ese acceso, cambiá tu contraseña."
          }
        </p>
      </div>
      <button id="btn-sesion-desplazada-ok" style="
        width:100%;padding:13px;
        background:linear-gradient(135deg,#1e3a8a,#2563eb);
        color:#fff;border:none;border-radius:10px;
        font-size:.95rem;font-weight:700;cursor:pointer;transition:all .15s;
      ">Iniciar sesión nuevamente</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("btn-sesion-desplazada-ok").addEventListener("click", () => {
    overlay.remove();
    mostrarLogin();
  });
}

// ======== MONITOREO DE SESIÓN + AUTO-LOGOUT POR INACTIVIDAD ========
let monitoreoInterval = null;
let monitoreoSnapshot = null;
let _monitoreoUserRef = null;
let inactividadTimeout = null;
let inactividadAviso1 = null;   // aviso a los 20 min
let inactividadAviso2 = null;   // aviso a los 25 min
let inactividadAviso3 = null;   // aviso a los 29 min (cuenta regresiva)
let cuentaRegresivaInterval = null;
let ultimaActividad = Date.now();

const INACTIVIDAD_TOTAL_MS  = 30 * 60 * 1000;  // 30 min → cierre
const AVISO_1_MS            = 20 * 60 * 1000;  // 20 min → primer aviso
const AVISO_2_MS            = 25 * 60 * 1000;  // 25 min → segundo aviso
const AVISO_3_MS            = 29 * 60 * 1000;  // 29 min → cuenta regresiva 60s

// Registrar actividad del usuario
function registrarActividad() {
  ultimaActividad = Date.now();
  // Si hay un modal de inactividad abierto, cerrarlo
  const modal = document.getElementById("inactividad-modal");
  if (modal) modal.remove();
  if (cuentaRegresivaInterval) { clearInterval(cuentaRegresivaInterval); cuentaRegresivaInterval = null; }
  reiniciarTimersInactividad();
}

function reiniciarTimersInactividad() {
  [inactividadAviso1, inactividadAviso2, inactividadAviso3, inactividadTimeout].forEach(t => { if (t) clearTimeout(t); });

  inactividadAviso1 = setTimeout(() => mostrarAvisoInactividad(
    "⏰ Inactividad detectada",
    "Llevas 20 minutos sin actividad. Tu sesión se cerrará automáticamente en 10 minutos si no hacés nada.",
    false
  ), AVISO_1_MS);

  inactividadAviso2 = setTimeout(() => mostrarAvisoInactividad(
    "⚠️ Sesión a punto de cerrarse",
    "Llevas 25 minutos sin actividad. Tu sesión se cerrará en 5 minutos.",
    false
  ), AVISO_2_MS);

  inactividadAviso3 = setTimeout(() => mostrarAvisoInactividad(
    "🚨 Cerrando sesión",
    "Tu sesión se cerrará por inactividad en:",
    true  // con cuenta regresiva
  ), AVISO_3_MS);

  inactividadTimeout = setTimeout(async () => {
    const modal = document.getElementById("inactividad-modal");
    if (modal) modal.remove();
    if (cuentaRegresivaInterval) clearInterval(cuentaRegresivaInterval);
    limpiarTimersInactividad();
    await handleLogout();
    limpiarUI();
    mostrarLogin("⏰ Tu sesión se cerró por inactividad.");
  }, INACTIVIDAD_TOTAL_MS);
}

function limpiarTimersInactividad() {
  [inactividadAviso1, inactividadAviso2, inactividadAviso3, inactividadTimeout].forEach(t => { if (t) clearTimeout(t); });
  if (cuentaRegresivaInterval) { clearInterval(cuentaRegresivaInterval); cuentaRegresivaInterval = null; }
}

function mostrarAvisoInactividad(titulo, mensaje, conCuentaRegresiva) {
  // Remover modal anterior si existe
  const viejo = document.getElementById("inactividad-modal");
  if (viejo) viejo.remove();
  if (cuentaRegresivaInterval) { clearInterval(cuentaRegresivaInterval); cuentaRegresivaInterval = null; }

  // Inyectar estilos del modal si no existen
  if (!document.getElementById("inactividad-styles")) {
    const s = document.createElement("style");
    s.id = "inactividad-styles";
    s.textContent = `
      #inactividad-modal {
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,.55);z-index:99990;
        display:flex;justify-content:center;align-items:center;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
      }
      .inac-box {
        background:#fff;border-radius:16px;padding:36px 32px;
        width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.35);
        text-align:center;margin:16px;
      }
      .inac-titulo { font-size:1.2rem;font-weight:800;color:#d97706;margin-bottom:12px; }
      .inac-msg { font-size:.92rem;color:#475569;line-height:1.6;margin-bottom:20px; }
      .inac-contador {
        font-size:2.8rem;font-weight:900;color:#dc2626;
        margin-bottom:20px;line-height:1;
      }
      .inac-btn {
        padding:11px 28px;background:linear-gradient(135deg,#0d7490,#0891b2);
        color:#fff;border:none;border-radius:8px;font-size:.95rem;
        font-weight:700;cursor:pointer;transition:all .15s;
      }
      .inac-btn:hover { background:linear-gradient(135deg,#0891b2,#06b6d4);transform:translateY(-1px); }
    `;
    document.head.appendChild(s);
  }

  const modal = document.createElement("div");
  modal.id = "inactividad-modal";
  modal.innerHTML = `
    <div class="inac-box">
      <div class="inac-titulo">${titulo}</div>
      <div class="inac-msg">${mensaje}</div>
      ${conCuentaRegresiva ? '<div class="inac-contador" id="inac-contador">60</div>' : ''}
      <button class="inac-btn" id="inac-btn-seguir">✅ Seguir usando</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("inac-btn-seguir").addEventListener("click", () => {
    registrarActividad();
  });

  if (conCuentaRegresiva) {
    let segundos = 60;
    cuentaRegresivaInterval = setInterval(() => {
      segundos--;
      const el = document.getElementById("inac-contador");
      if (el) el.textContent = segundos;
      if (segundos <= 0) {
        clearInterval(cuentaRegresivaInterval);
      }
    }, 1000);
  }
}

function iniciarListenersActividad(userObj) {
  // La cuenta admin no tiene cierre por inactividad
  if (userObj && userObj.email === ADMIN_EMAIL) return;
  // Escuchar eventos de actividad del usuario
  ["mousemove","keydown","click","touchstart","scroll"].forEach(ev => {
    document.addEventListener(ev, registrarActividad, { passive: true });
  });
  reiniciarTimersInactividad();
}

function detenerListenersActividad() {
  ["mousemove","keydown","click","touchstart","scroll"].forEach(ev => {
    document.removeEventListener(ev, registrarActividad);
  });
  limpiarTimersInactividad();
}

function iniciarMonitoreoSesion(user) {
  if (monitoreoInterval) { clearInterval(monitoreoInterval); monitoreoInterval = null; }
  if (monitoreoSnapshot) { monitoreoSnapshot(); monitoreoSnapshot = null; }

  const deviceId = getDeviceId();
  iniciarListenersActividad(user);

  // ── LISTENER EN TIEMPO REAL ──────────────────────────────────────────
  // Detecta INMEDIATAMENTE si otra ventana o dispositivo inició sesión.
  // Reacciona en menos de 1 segundo, sin depender de polling.
  const sessionRef = doc(db, "sessions", user.uid);
  let primeraLectura = true;

  monitoreoSnapshot = onSnapshot(sessionRef,
    (snap) => {
      if (primeraLectura) { primeraLectura = false; return; }

      // Documento eliminado → sesión cerrada externamente (ej: admin eliminó usuario)
      if (!snap.exists()) {
        if (monitoreoSnapshot) { monitoreoSnapshot(); monitoreoSnapshot = null; }
        if (monitoreoInterval) { clearInterval(monitoreoInterval); monitoreoInterval = null; }
        detenerListenersActividad();
        limpiarUI();
        mostrarPantallaDesplazada("eliminada");
        return;
      }

      const data = snap.data();
      const esAdmin = user.email === ADMIN_EMAIL;

      // deviceId cambió → otra ventana o dispositivo tomó la sesión
      if (!esAdmin && data.deviceId && data.deviceId !== deviceId) {
        if (monitoreoSnapshot) { monitoreoSnapshot(); monitoreoSnapshot = null; }
        if (monitoreoInterval) { clearInterval(monitoreoInterval); monitoreoInterval = null; }
        detenerListenersActividad();
        limpiarUI();
        mostrarPantallaDesplazada("desplazada");
      }
    },
    (error) => {
      console.warn("[IAR] Error en listener de sesión:", error.code || error.message);
    }
  );

  // ── HEARTBEAT ────────────────────────────────────────────────────────
  // Actualiza lastActivity cada 60s. Se pausa cuando la pestaña está oculta
  // para evitar escrituras innecesarias.
  let _heartbeatPausado = false;

  function _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      _heartbeatPausado = true;
    } else {
      setTimeout(() => { _heartbeatPausado = false; }, 3000);
    }
  }
  document.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('focus', () => setTimeout(() => { _heartbeatPausado = false; }, 2000));

  _monitoreoUserRef = user;
  user._cleanupVisibility = () => {
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  };

  monitoreoInterval = setInterval(async () => {
    if (_heartbeatPausado || document.visibilityState === 'hidden') return;
    if (!auth.currentUser) return;
    try {
      const snap = await getDoc(sessionRef);
      if (!snap.exists()) return; // onSnapshot ya lo detectó o lo detectará
      const data = snap.data();
      const esAdmin = user.email === ADMIN_EMAIL;
      // Admin: sincronizar deviceId en heartbeat. Usuario: solo actualizar lastActivity.
      const updateData = esAdmin
        ? { ...data, deviceId, lastActivity: serverTimestamp() }
        : { ...data, lastActivity: serverTimestamp() };
      await setDoc(sessionRef, updateData);
    } catch (err) {
      console.warn("[IAR] Error en heartbeat:", err.code || err.message);
    }
  }, 60000);
}

function limpiarUI() {
  document.body.style.paddingBottom = "";
  if (countdownBarInterval) { clearInterval(countdownBarInterval); countdownBarInterval = null; }
  if (monitoreoInterval) { clearInterval(monitoreoInterval); monitoreoInterval = null; }
  if (monitoreoSnapshot) { monitoreoSnapshot(); monitoreoSnapshot = null; }
  if (_monitoreoUserRef && _monitoreoUserRef._cleanupVisibility) {
    _monitoreoUserRef._cleanupVisibility();
    _monitoreoUserRef = null;
  }
  window._demoCheckEnabled = false;
  licenciaActual = null;
  detenerListenersActividad();
  detenerListenerSolicitudes();
  if (auth.currentUser) detenerPresencia(auth.currentUser.uid);
  detenerChat();
  ["barra-sesion", "licencia-vencida-overlay", "admin-overlay", "inactividad-modal", "demo-restriccion-overlay"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

// ======== CACHÉ Y CARGA DE PREGUNTAS DESDE FIRESTORE ========
const cachePreguntas = {};

async function cargarSeccion(seccionId) {
  if (cachePreguntas[seccionId]) return cachePreguntas[seccionId];
  try {
    const snap = await getDoc(doc(db, "preguntas", seccionId));
    if (snap.exists()) {
      const preguntas = snap.data().preguntas || [];
      cachePreguntas[seccionId] = preguntas;
      return preguntas;
    }
    return null;
  } catch(err) {
    console.error("[IAR] Error cargando sección '" + seccionId + "':", err.code || err.message || err);
    return null;
  }
}

window.cargarSeccionFirestore = cargarSeccion;
window.mostrarModalRestriccionDemo = mostrarModalRestriccionDemo;

// ======== CONTADOR DE VISITAS ÚNICAS ========
// Registra en Firestore el primer acceso de cada usuario (una sola vez).
// El doc "estadisticas/visitas" acumula: totalPago, totalDemo, total.
async function registrarVisitaUnica(uid, esDemo) {
  try {
    const visitaRef = doc(db, "visitas_unicas", uid);
    const snap = await getDoc(visitaRef);
    if (snap.exists()) return; // ya fue registrado antes → no contar de nuevo

    // Primer acceso de este usuario: guardar marca y sumar al contador global
    await setDoc(visitaRef, { registradoEn: serverTimestamp(), esDemo: !!esDemo });

    const statsRef = doc(db, "estadisticas", "visitas");
    const campo = esDemo ? "totalDemo" : "totalPago";
    await setDoc(statsRef, {
      [campo]: increment(1),
      total: increment(1)
    }, { merge: true });
  } catch(err) {
    console.warn("[IAR] No se pudo registrar visita única:", err.message);
  }
}


onAuthStateChanged(auth, async (user) => {
  if (user) {
    const deviceId = getDeviceId();
    try {
      const licencia = await verificarLicencia(user.uid);
      licenciaActual = licencia;

      if (!licencia.valida) {
        const emailUsuario = user.email || '';
        if (licencia.vencida) {
          // NO hacemos signOut — el usuario sigue autenticado para poder enviar
          // la solicitud de renovación. El signOut ocurre al presionar "Cerrar sesión".
          mostrarLicenciaVencida(licencia.mensaje, licencia.esDemo);
        } else {
          await signOut(auth);
          const msgCompleto = `No tenés una licencia activa para ${emailUsuario}.\n\nEscribinos a ${CONTACTO_EMAIL} con tu email y te activamos el acceso.`;
          mostrarLogin(msgCompleto);
        }
        return;
      }
      const sessionRef = doc(db, "sessions", user.uid);
      const snap = await getDoc(sessionRef);

      if (snap.exists() && snap.data().deviceId === deviceId) {
        ocultarLogin();
        if (licencia.esDemo) aplicarRestriccionesDemo();
        mostrarBarraSesion(user.email, licencia);
        iniciarMonitoreoSesion(user);
        iniciarCountdownLicencia(licencia);
        registrarVisitaUnica(user.uid, licencia.esDemo);
        iniciarPresencia(user.uid, user.email);
        iniciarChat(user.email, licencia.esDemo);
      } else if (snap.exists() && snap.data().deviceId !== deviceId) {
        const data = snap.data();
        const lastAct = data.lastActivity
          ? (data.lastActivity.toDate ? data.lastActivity.toDate() : new Date(data.lastActivity))
          : null;
        const minutosInactiva = lastAct ? (Date.now() - lastAct.getTime()) / 60000 : 999;

        if (minutosInactiva >= 2) {
          await setDoc(sessionRef, { deviceId, email: user.email, loginAt: serverTimestamp(), lastActivity: serverTimestamp() });
          ocultarLogin();
          if (licencia.esDemo) aplicarRestriccionesDemo();
          mostrarBarraSesion(user.email, licencia);
          iniciarMonitoreoSesion(user);
          iniciarCountdownLicencia(licencia);
          registrarVisitaUnica(user.uid, licencia.esDemo);
          iniciarPresencia(user.uid, user.email);
          iniciarChat(user.email, licencia.esDemo);
        } else {
          await signOut(auth);
          mostrarLogin("⚠️ Ya hay una sesión activa en otro dispositivo.");
        }
      } else {
        await setDoc(sessionRef, { deviceId, email: user.email, loginAt: serverTimestamp(), lastActivity: serverTimestamp() });
        ocultarLogin();
        if (licencia.esDemo) aplicarRestriccionesDemo();
        mostrarBarraSesion(user.email, licencia);
        iniciarMonitoreoSesion(user);
        iniciarCountdownLicencia(licencia);
        registrarVisitaUnica(user.uid, licencia.esDemo);
        iniciarPresencia(user.uid, user.email);
        iniciarChat(user.email, licencia.esDemo);
      }
    } catch (err) {
      console.error("Error al inicializar:", err);
      mostrarLogin("Error al verificar tu acceso. Intentá nuevamente.");
    }
  } else {
    if (monitoreoInterval) { clearInterval(monitoreoInterval); monitoreoInterval = null; }
    limpiarUI();
    mostrarLogin();
  }
});

// ======================================================
// ======== PRESENCIA ONLINE + CHAT EN TIEMPO REAL ========
// ======================================================

let _presenciaRef = null;
let _chatEsUsuarioPago = true; // todos pueden usar el chat
let _chatNombreUsuario = '';
let _chatUnsubscribe = null;
let _ultimoTsLeido = Date.now();

// ── Iniciar presencia online ──
function iniciarPresencia(uid, email) {
  const presRef = ref(rtdb, `presencia/${uid}`);
  _presenciaRef = presRef;
  const nombre = email.split('@')[0];

  // Escribir presencia actual
  set(presRef, { online: true, nombre, uid, ts: Date.now() });

  // Al desconectarse, marcar offline automáticamente
  onDisconnect(presRef).set({ online: false, nombre, uid, ts: Date.now() });

  // Escuchar contador global y actualizar badge en barra
  const presenciaAllRef = ref(rtdb, 'presencia');
  onValue(presenciaAllRef, (snapshot) => {
    const data = snapshot.val() || {};
    const online = Object.values(data).filter(u => u.online).length;
    _actualizarContadorOnline(online);
  });
}

function _actualizarContadorOnline(cantidad) {
  // Actualizar en barra de sesión
  let badge = document.getElementById('badge-online');
  if (!badge) {
    const izq = document.getElementById('barra-sesion-izq');
    if (!izq) return;
    badge = document.createElement('span');
    badge.id = 'badge-online';
    badge.title = 'Usuarios conectados ahora';
    izq.appendChild(badge);
  }
  badge.textContent = `🟢 ${cantidad} en línea`;
  badge.className = 'badge-online-count';

  // Actualizar también dentro del chat si está abierto
  const chatOnlineEl = document.getElementById('chat-online-count');
  if (chatOnlineEl) chatOnlineEl.textContent = `🟢 ${cantidad} en línea`;
}

// ── Detener presencia al cerrar sesión ──
function detenerPresencia(uid) {
  if (_presenciaRef) {
    set(_presenciaRef, { online: false, nombre: '', uid, ts: Date.now() });
    _presenciaRef = null;
  }
}

// ──────────────────────────────────────────────────────
// ── CHAT ──────────────────────────────────────────────
// ──────────────────────────────────────────────────────

function iniciarChat(email, esDemo) {
  _chatEsUsuarioPago = true; // pago y demo pueden chatear
  _chatNombreUsuario = email.split('@')[0];
  _inyectarBotonChat();
}

function _inyectarBotonChat() {
  if (document.getElementById('btn-chat-flotante')) return;

  // Botón flotante
  const btn = document.createElement('button');
  btn.id = 'btn-chat-flotante';
  btn.innerHTML = '💬';
  btn.title = 'Chat de estudiantes';
  btn.setAttribute('aria-label', 'Abrir chat');
  btn.addEventListener('click', () => _toggleChat());
  document.body.appendChild(btn);

  // Ventana del chat
  const ventana = document.createElement('div');
  ventana.id = 'chat-ventana';
  ventana.innerHTML = `
    <div id="chat-header">
      <div style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-weight:700;font-size:.95rem;">💬 Chat IAR</span>
        <span id="chat-online-count" style="font-size:.72rem;opacity:.85;">🟢 cargando...</span>
      </div>
      <button id="chat-cerrar" title="Cerrar chat">✕</button>
    </div>
    <div id="chat-mensajes"></div>
    <div id="chat-input-area">
      <input id="chat-input" type="text" placeholder="Escribí tu mensaje..." maxlength="300" autocomplete="off" />
      <button id="chat-enviar">➤</button>
    </div>
  `;
  document.body.appendChild(ventana);

  document.getElementById('chat-cerrar').addEventListener('click', () => _toggleChat(false));

  const input = document.getElementById('chat-input');
  document.getElementById('chat-enviar').addEventListener('click', _enviarMensaje);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _enviarMensaje(); } });

  // Suscribir a mensajes en tiempo real (últimos 50 ordenados por timestamp)
  const mensajesRef = rtQuery(ref(rtdb, 'chat/mensajes'), orderByChild('ts'), limitToLast(50));
  
  _chatUnsubscribe = onValue(mensajesRef, (snapshot) => {
    const msgs = [];
    snapshot.forEach(child => {
      const val = child.val();
      if (val && val.texto) msgs.push({ id: child.key, ...val });
    });
    _renderMensajes(msgs);
    const onlineEl = document.getElementById('chat-online-count');
    if (onlineEl && (onlineEl.textContent.includes('cargando') || onlineEl.textContent.includes('error'))) {
      onlineEl.textContent = '🟢 conectado';
    }
  }, (error) => {
    console.warn('[IAR Chat] Error en suscripción:', error.code, error.message);
    const onlineEl = document.getElementById('chat-online-count');
    if (onlineEl) onlineEl.textContent = '🔴 Error de conexión';
    const container = document.getElementById('chat-mensajes');
    if (container) {
      container.innerHTML = `<div class="chat-vacio" style="color:#dc2626;font-size:.82rem;padding:16px;">
        ⚠️ No se puede conectar al chat.<br><br>
        Verificá tu conexión a internet.<br><br>
        <small>Error: ${error.code || error.message}</small>
      </div>`;
    }
  });
}

function _toggleChat(forzarEstado) {
  const ventana = document.getElementById('chat-ventana');
  const btn = document.getElementById('btn-chat-flotante');
  if (!ventana) return;
  const visible = ventana.classList.contains('chat-visible');
  const abrir = forzarEstado !== undefined ? forzarEstado : !visible;
  if (abrir) {
    ventana.classList.add('chat-visible');
    btn.classList.add('chat-abierto');
    btn.innerHTML = '✕';
    // Scroll al final
    const msgs = document.getElementById('chat-mensajes');
    if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 100);
    // Limpiar badge y marcar mensajes como leídos
    _ultimoTsLeido = Date.now();
    btn.removeAttribute('data-nuevos');
  } else {
    ventana.classList.remove('chat-visible');
    btn.classList.remove('chat-abierto');
    btn.innerHTML = '💬';
  }
}

function _renderMensajes(msgs) {
  const container = document.getElementById('chat-mensajes');
  if (!container) return;
  const estabaAbajo = container.scrollHeight - container.scrollTop - container.clientHeight < 60;

  container.innerHTML = '';
  if (msgs.length === 0) {
    container.innerHTML = '<div class="chat-vacio">Todavía no hay mensajes. ¡Sé el primero en escribir!</div>';
    return;
  }

  let lastFecha = '';
  msgs.forEach(msg => {
    const esPropio = msg.nombre === _chatNombreUsuario;
    const fecha = msg.ts ? new Date(msg.ts) : null;
    const fechaStr = fecha ? fecha.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' }) : '';
    const horaStr = fecha ? fecha.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }) : '';

    // Separador de fecha
    if (fechaStr && fechaStr !== lastFecha) {
      const sep = document.createElement('div');
      sep.className = 'chat-fecha-sep';
      sep.textContent = fechaStr;
      container.appendChild(sep);
      lastFecha = fechaStr;
    }

    const burbuja = document.createElement('div');
    burbuja.className = 'chat-msg' + (esPropio ? ' chat-msg-propio' : ' chat-msg-otro');

    if (!esPropio) {
      const nombreEl = document.createElement('span');
      nombreEl.className = 'chat-nombre';
      nombreEl.textContent = msg.nombre || 'Anónimo';
      burbuja.appendChild(nombreEl);
    }

    const textoEl = document.createElement('span');
    textoEl.className = 'chat-texto';
    textoEl.textContent = msg.texto;
    burbuja.appendChild(textoEl);

    const horaEl = document.createElement('span');
    horaEl.className = 'chat-hora';
    horaEl.textContent = horaStr;
    burbuja.appendChild(horaEl);

    container.appendChild(burbuja);
  });

  if (estabaAbajo) container.scrollTop = container.scrollHeight;

  // Badge: si el chat está abierto, marcar todo como leído automáticamente
  const ventana = document.getElementById('chat-ventana');
  const btn = document.getElementById('btn-chat-flotante');
  if (btn && ventana) {
    if (ventana.classList.contains('chat-visible')) {
      // Chat abierto → actualizar _ultimoTsLeido con el mensaje más reciente
      if (msgs.length > 0) {
        const tsMax = Math.max(...msgs.map(m => m.ts || 0));
        if (tsMax > _ultimoTsLeido) _ultimoTsLeido = tsMax;
      }
      btn.removeAttribute('data-nuevos');
    } else {
      // Chat cerrado → mostrar cantidad de no leídos
      const noLeidos = msgs.filter(m => m.ts && m.nombre !== _chatNombreUsuario && m.ts > _ultimoTsLeido).length;
      if (noLeidos > 0) {
        btn.setAttribute('data-nuevos', noLeidos > 99 ? '99+' : String(noLeidos));
      } else {
        btn.removeAttribute('data-nuevos');
      }
    }
  }
}

async function _enviarMensaje() {
  const input = document.getElementById('chat-input');
  const btnEnviar = document.getElementById('chat-enviar');
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;
  input.value = '';
  if (btnEnviar) btnEnviar.disabled = true;
  try {
    await push(ref(rtdb, 'chat/mensajes'), {
      nombre: _chatNombreUsuario,
      texto,
      ts: Date.now()
    });
  } catch(err) {
    console.warn('[IAR Chat] Error al enviar:', err.code, err.message);
    input.value = texto; // restaurar si falla
    // Mostrar error visible en el chat
    const container = document.getElementById('chat-mensajes');
    if (container) {
      const errEl = document.createElement('div');
      errEl.style.cssText = 'color:#dc2626;font-size:.75rem;text-align:center;padding:4px 8px;background:#fee2e2;border-radius:6px;margin:4px 8px;';
      errEl.textContent = '⚠️ No se pudo enviar. Error: ' + (err.code || err.message);
      container.appendChild(errEl);
      container.scrollTop = container.scrollHeight;
      setTimeout(() => errEl.remove(), 5000);
    }
  } finally {
    if (btnEnviar) btnEnviar.disabled = false;
    if (input) input.focus();
  }
}

function detenerChat() {
  if (_chatUnsubscribe) { _chatUnsubscribe(); _chatUnsubscribe = null; }
  const v = document.getElementById('chat-ventana');
  const b = document.getElementById('btn-chat-flotante');
  if (v) v.remove();
  if (b) b.remove();
}
