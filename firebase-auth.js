/* ========== firebase-auth.js ==========
   Sistema de autenticación con Firebase
   - Login con email y contraseña
   - Sesión única por dispositivo
   - Sistema de licencias con verificación
   - Barra inferior estática con info de sesión
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, serverTimestamp, collection, addDoc, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB9aDHVHhgMGlhXmsiLfiVZcSzUs3994ws",
  authDomain: "examenesiaruba-d11fb.firebaseapp.com",
  projectId: "examenesiaruba-d11fb",
  storageBucket: "examenesiaruba-d11fb.firebasestorage.app",
  messagingSenderId: "967562801862",
  appId: "1:967562801862:web:61f618fe7a2ff51dd15dc7",
  measurementId: "G-CFRNQ9Z3SQ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_EMAIL = "micro2020uba@gmail.com";
const CONTACTO_EMAIL = "examenesiaruba@gmail.com";

// ======== DEMO ========
const DEMO_SECCIONES_PERMITIDAS = ["iarsep2020", "iaroct2020"];
const DEMO_DIAS = 3;
window._demoCheckEnabled = false;
window._demoSeccionesPermitidas = DEMO_SECCIONES_PERMITIDAS;

// Licencia en memoria (se llena al autenticar)
let licenciaActual = null;

function getDeviceId() {
  let did = sessionStorage.getItem("iar_device_id");
  if (!did) {
    did = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem("iar_device_id", did);
  }
  return did;
}

async function verificarLicencia(userId) {
  try {
    const licRef = doc(db, "licencias", userId);
    const licSnap = await getDoc(licRef);

    if (!licSnap.exists()) {
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
      background:linear-gradient(135deg,#0e7490 0%,#155e75 100%);
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
    .demo-restriccion-box { background:#fff;border-radius:16px;padding:36px 30px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center; }
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
      background:linear-gradient(135deg,#0e7490 0%,#155e75 100%);
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
      background:linear-gradient(135deg,#0e7490 0%,#155e75 100%);
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
        </div>
        <div id="form-registro" style="display:none;">
          <div class="demo-banner">
            <div class="demo-banner-titulo">🎉 Probá GRATIS por ${DEMO_DIAS} días</div>
            <div class="demo-banner-desc">Accedé a los cuestionarios de <strong>SEP 2020</strong> y <strong>OCT 2020</strong> sin cargo.</div>
          </div>
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
          <button id="reg-btn" class="login-btn" style="background:linear-gradient(135deg,#059669,#047857);">🚀 Crear cuenta demo gratis</button>
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

    await setDoc(doc(db, "licencias", user.uid), {
      esDemo: true, nombre, email, creadoEn: ahora, plan: "demo"
    });
    await addDoc(collection(db, "registros_demo"), {
      uid: user.uid, nombre, email, creadoEn: ahora, estado: "activo"
    });

    loading.textContent = "Verificando...";
    const licencia = await verificarLicencia(user.uid);
    licenciaActual = licencia;

    const deviceId = getDeviceId();
    const sessionRef = doc(db, "sessions", user.uid);
    await setDoc(sessionRef, { deviceId, email: user.email, loginAt: ahora, lastActivity: ahora });

    ocultarLogin();
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

  // Deshabilitar simulador
  document.querySelectorAll('li').forEach(li => {
    const oc = li.getAttribute('onclick') || '';
    if (oc.includes('simulador')) {
      li.style.opacity = '0.4'; li.style.pointerEvents = 'none';
      li.title = 'Disponible en el acceso completo';
    }
  });

  // Deshabilitar "Ver respuestas correctas"
  document.querySelectorAll('li, button, a').forEach(el => {
    const txt = (el.textContent || '').toLowerCase();
    const oc = (el.getAttribute('onclick') || '').toLowerCase();
    if (txt.includes('respuestas correctas') || oc.includes('mostrarrespuestascorrectas')) {
      el.style.opacity = '0.4'; el.style.pointerEvents = 'none';
      el.title = 'Disponible en el acceso completo';
    }
  });

  // Interceptar mostrarRespuestasCorrectas
  const origResp = window.mostrarRespuestasCorrectas;
  if (origResp) {
    window.mostrarRespuestasCorrectas = function() { mostrarModalRestriccionDemo(); };
  }
}

function mostrarModalRestriccionDemo() {
  if (document.getElementById("demo-restriccion-overlay")) {
    document.getElementById("demo-restriccion-overlay").style.display = "flex";
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = "demo-restriccion-overlay";
  overlay.innerHTML = `
    <div class="demo-restriccion-box">
      <div class="demo-restriccion-icon">🔒</div>
      <div class="demo-restriccion-titulo">Contenido exclusivo del acceso completo</div>
      <div class="demo-restriccion-msg">
        En la versión demo solo podés acceder a los cuestionarios de <strong>SEP 2020</strong> y <strong>OCT 2020</strong>.<br><br>
        Para acceder a todos los exámenes, el simulador y las respuestas correctas, adquirí el acceso completo.
      </div>
      <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:20px;text-align:left;">
        <div style="font-size:.8rem;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:10px;">📦 Planes disponibles</div>
        <div class="demo-plan-row"><span class="demo-plan-nombre">⚡ 1 semana</span><span class="demo-plan-precio">Consultar</span></div>
        <div class="demo-plan-row"><span class="demo-plan-nombre">📅 1 mes</span><span class="demo-plan-precio">Consultar</span></div>
      </div>
      <div style="margin-bottom:12px;font-size:.9rem;color:#475569;">Escribinos y te activamos el acceso:</div>
      <a class="demo-restriccion-email" href="mailto:${CONTACTO_EMAIL}">${CONTACTO_EMAIL}</a><br>
      <button class="login-btn" id="demo-restriccion-cerrar" style="max-width:200px;display:inline-block;margin-top:12px;">✕ Cerrar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("demo-restriccion-cerrar").addEventListener("click", () => { overlay.style.display = "none"; });
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
      handleLogout().then(() => { limpiarUI(); mostrarLicenciaVencida(licenciaActual?.esDemo ? `Tu período de prueba expiró.` : `Tu licencia expiró.`, licenciaActual?.esDemo); });
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

  const overlay = document.createElement("div");
  overlay.id = "solicitud-overlay";
  overlay.innerHTML = `
    <div class="solicitud-box">
      <div class="solicitud-titulo">📩 Solicitar acceso</div>
      <div class="solicitud-desc">
        Completá tus datos y nos comunicaremos con vos para coordinar el pago y activar tu acceso.
      </div>
      <div id="solicitud-error" class="login-error" style="display:none;"></div>
      <div id="solicitud-success" class="login-success" style="display:none;"></div>
      <div class="login-field">
        <label>Nombre completo</label>
        <input type="text" id="sol-nombre" placeholder="Tu nombre" />
      </div>
      <div class="login-field">
        <label>Email</label>
        <input type="email" id="sol-email" placeholder="tu@email.com" />
      </div>
      <div class="login-field">
        <label>Plan deseado</label>
        <select id="sol-plan" style="width:100%;padding:11px 14px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:.95rem;color:#1f2937;outline:none;box-sizing:border-box;">
          <option value="1 mes">1 mes</option>
          <option value="3 meses">3 meses</option>
          <option value="5 meses">5 meses</option>
          <option value="de por vida">De por vida</option>
        </select>
      </div>
      <button id="sol-btn-enviar" class="login-btn">Enviar solicitud</button>
      <div id="sol-loading" class="login-loading"></div>
      <button id="sol-btn-volver" class="login-btn-sec" style="margin-top:8px;">← Volver al login</button>
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
    await addDoc(collection(db, "solicitudes"), {
      nombre,
      email,
      plan,
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

function mostrarLicenciaVencida(mensaje, esDemo) {
  inyectarEstilos();
  document.body.style.overflow = "hidden";
  const loginOverlay = document.getElementById("login-overlay");
  if (loginOverlay) loginOverlay.style.display = "none";
  if (document.getElementById("licencia-vencida-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "licencia-vencida-overlay";
  overlay.innerHTML = `
    <div class="lv-box">
      <div class="lv-icon">${esDemo ? "⏱️" : "⏰"}</div>
      <div class="lv-titulo">${esDemo ? "Período de prueba finalizado" : "Licencia vencida"}</div>
      <div class="lv-msg">${mensaje}</div>
      ${esDemo ? '<div class="lv-msg" style="color:#059669;font-weight:600;">¡Esperamos que hayas disfrutado la prueba! 🎓</div>' : ''}
      <div class="lv-contacto">
        📦 <strong>Planes disponibles:</strong> 1 semana · 1 mes<br><br>
        Para activar tu acceso escribinos a:<br>
        <a href="mailto:${CONTACTO_EMAIL}" style="color:#0d7490;">${CONTACTO_EMAIL}</a>
      </div>
      <button class="lv-btn" id="lv-btn-renovar">✉️ Contactar por email</button>
      <br>
      <button class="lv-btn lv-btn-sec" id="lv-btn-cerrar" style="margin-top:8px;">Cerrar sesión</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("lv-btn-renovar").addEventListener("click", () => {
    const asunto = esDemo ? "Quiero+adquirir+acceso+completo+IAR" : "Renovar+licencia+IAR";
    window.open(`mailto:${CONTACTO_EMAIL}?subject=${asunto}`, "_blank");
  });
  document.getElementById("lv-btn-cerrar").addEventListener("click", handleLogout);
}

// ======== HANDLE LOGIN ========
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
      await signOut(auth);
      btn.disabled = false;
      loading.textContent = "";
      if (licencia.vencida) {
        mostrarLicenciaVencida(licencia.mensaje, licencia.esDemo);
      } else {
        errDiv.textContent = licencia.mensaje;
        errDiv.style.display = "block";
      }
      return;
    }

    loading.textContent = "Verificando sesión activa...";
    const sessionRef = doc(db, "sessions", user.uid);
    const sessionSnap = await getDoc(sessionRef);
    const deviceId = getDeviceId();

    if (sessionSnap.exists()) {
      const data = sessionSnap.data();
      if (data.deviceId && data.deviceId !== deviceId) {
        // Hay sesión activa en otro dispositivo
        // Verificar cuánto tiempo lleva inactiva
        const lastAct = data.lastActivity
          ? (data.lastActivity.toDate ? data.lastActivity.toDate() : new Date(data.lastActivity))
          : null;
        const minutosInactiva = lastAct ? (Date.now() - lastAct.getTime()) / 60000 : 999;

        if (minutosInactiva >= 2) {
          // Lleva 2+ minutos inactiva → tomar la sesión automáticamente
          console.log("Sesión anterior inactiva por 2+ min, tomando sesión...");
        } else {
          // Sesión reciente → bloquear y mostrar mensaje con cuenta regresiva
          await signOut(auth);
          btn.disabled = false;
          loading.textContent = "";
          const segsRestantes = Math.max(0, Math.ceil((2 * 60) - (minutosInactiva * 60)));
          errDiv.textContent = `⚠️ Hay una sesión activa en otro dispositivo. Se liberará automáticamente en ${segsRestantes} segundos, o cerrá sesión manualmente desde ese dispositivo.`;
          errDiv.style.display = "block";

          // Reintentar automáticamente cuando pasen los segundos restantes
          setTimeout(() => {
            if (document.getElementById("login-overlay")?.style.display !== "none") {
              handleLogin();
            }
          }, (segsRestantes + 3) * 1000);
          return;
        }
      }
    }

    await setDoc(sessionRef, {
      deviceId,
      email: user.email,
      loginAt: serverTimestamp(),
      lastActivity: serverTimestamp()
    });

    ocultarLogin();
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

function ocultarLogin() {
  const overlay = document.getElementById("login-overlay");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
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
    btnAdmin.textContent = "⚙️ Admin";
    btnAdmin.addEventListener("click", mostrarPanelAdmin);
    der.appendChild(btnAdmin);
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

// ======== PANEL ADMINISTRADOR ========
async function mostrarPanelAdmin() {
  if (document.getElementById("admin-overlay")) {
    document.getElementById("admin-overlay").style.display = "flex";
    await cargarDatosAdmin();
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "admin-overlay";
  overlay.innerHTML = `
    <div class="admin-box">
      <div class="admin-titulo">
        ⚙️ Panel de Administración
        <button class="admin-btn admin-btn-cerrar" id="admin-cerrar">✕ Cerrar</button>
      </div>
      <div class="admin-seccion">
        <h3>➕ Crear nuevo usuario</h3>
        <div class="admin-row">
          <div class="admin-field">
            <label>Email</label>
            <input type="email" id="admin-nuevo-email" placeholder="usuario@email.com" />
          </div>
          <div class="admin-field">
            <label>Contraseña</label>
            <input type="password" id="admin-nuevo-pass" placeholder="Mínimo 6 caracteres" />
          </div>
          <div class="admin-field" style="max-width:140px;">
            <label>Plan</label>
            <select id="admin-nuevo-plan">
              <option value="1semana">1 semana</option>
              <option value="1mes" selected>1 mes</option>
              <option value="devida">De por vida</option>
            </select>
          </div>
        </div>
        <button class="admin-btn admin-btn-primary" id="admin-btn-crear">Crear usuario</button>
        <div class="admin-msg" id="admin-msg-crear"></div>
      </div>
      <div class="admin-seccion">
        <h3>📋 Solicitudes pendientes</h3>
        <div id="admin-solicitudes"><em style="color:#94a3b8;font-size:.85rem;">Cargando...</em></div>
      </div>
      <div class="admin-seccion">
        <h3>👥 Usuarios con licencia</h3>
        <div id="admin-usuarios"><em style="color:#94a3b8;font-size:.85rem;">Cargando...</em></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("admin-cerrar").addEventListener("click", () => overlay.style.display = "none");
  document.getElementById("admin-btn-crear").addEventListener("click", crearUsuarioAdmin);
  await cargarDatosAdmin();
}

function calcularVencimiento(plan) {
  const dias = { "1dia":1, "1semana":7, "1mes":30, "3meses":90, "5meses":150 };
  if (plan === "devida") return null;
  const d = new Date();
  d.setDate(d.getDate() + dias[plan]);
  return d;
}

function formatFecha(ts) {
  if (!ts) return "De por vida";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });
}

async function crearUsuarioAdmin() {
  const email = document.getElementById("admin-nuevo-email").value.trim();
  const pass = document.getElementById("admin-nuevo-pass").value;
  const plan = document.getElementById("admin-nuevo-plan").value;
  const msg = document.getElementById("admin-msg-crear");

  msg.className = "admin-msg";
  msg.style.display = "none";

  if (!email || !pass) { msg.textContent = "Completá email y contraseña."; msg.className = "admin-msg err"; return; }
  if (pass.length < 6) { msg.textContent = "La contraseña debe tener al menos 6 caracteres."; msg.className = "admin-msg err"; return; }

  try {
    const apiKey = "AIzaSyB9aDHVHhgMGlhXmsiLfiVZcSzUs3994ws";
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, returnSecureToken: true })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const uid = data.localId;
    const venc = calcularVencimiento(plan);
    const planNombres = { "1dia":"1 día","1semana":"1 semana","1mes":"1 mes","3meses":"3 meses","5meses":"5 meses","devida":"de por vida" };
    const licData = venc
      ? { porVida: false, plan: planNombres[plan], vencimiento: venc }
      : { porVida: true, plan: planNombres[plan] };

    await setDoc(doc(db, "licencias", uid), licData);

    msg.textContent = `✅ Usuario ${email} creado con plan "${planNombres[plan]}".`;
    msg.className = "admin-msg ok";
    document.getElementById("admin-nuevo-email").value = "";
    document.getElementById("admin-nuevo-pass").value = "";
    await cargarDatosAdmin();
  } catch (err) {
    let m = "Error al crear usuario.";
    if (err.message === "EMAIL_EXISTS") m = "Ese email ya existe.";
    else if (err.message === "INVALID_EMAIL") m = "Email inválido.";
    msg.textContent = m;
    msg.className = "admin-msg err";
  }
}

async function cargarDatosAdmin() {
  const solDiv = document.getElementById("admin-solicitudes");
  const usrDiv = document.getElementById("admin-usuarios");
  if (!solDiv || !usrDiv) return;

  try {
    const { getDocs, collection: col, query, where } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    // Solicitudes pendientes
    const solSnap = await getDocs(query(col(db, "solicitudes"), where("estado", "==", "pendiente")));
    if (solSnap.empty) {
      solDiv.innerHTML = '<em style="color:#94a3b8;font-size:.85rem;">No hay solicitudes pendientes.</em>';
    } else {
      let html = '<table class="admin-tabla"><thead><tr><th>Nombre</th><th>Email</th><th>Plan</th><th>Fecha</th><th>Acción</th></tr></thead><tbody>';
      solSnap.forEach(d => {
        const s = d.data();
        const fecha = s.fecha ? (s.fecha.toDate ? s.fecha.toDate() : new Date(s.fecha)).toLocaleDateString("es-AR") : "-";
        html += `<tr>
          <td>${s.nombre||"-"}</td>
          <td>${s.email||"-"}</td>
          <td>${s.plan||"-"}</td>
          <td>${fecha}</td>
          <td>
            <button class="admin-btn admin-btn-success" style="font-size:.75rem;padding:5px 10px;"
              onclick="window.aprobarSolicitud('${d.id}','${s.email}','${s.plan}')">Aprobar</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
      solDiv.innerHTML = html;
    }

    // Usuarios con licencia
    const licSnap = await getDocs(col(db, "licencias"));
    if (licSnap.empty) {
      usrDiv.innerHTML = '<em style="color:#94a3b8;font-size:.85rem;">No hay usuarios con licencia.</em>';
    } else {
      let html = '<table class="admin-tabla"><thead><tr><th>UID</th><th>Plan</th><th>Vencimiento</th><th>Estado</th></tr></thead><tbody>';
      licSnap.forEach(d => {
        const l = d.data();
        const venc = l.porVida ? "De por vida" : formatFecha(l.vencimiento);
        const ahora = new Date();
        const vencDate = l.vencimiento ? (l.vencimiento.toDate ? l.vencimiento.toDate() : new Date(l.vencimiento)) : null;
        const estado = l.porVida ? "✅ Activo" : (vencDate && ahora > vencDate ? "❌ Vencido" : "✅ Activo");
        html += `<tr><td title="${d.id}">${d.id.substring(0,12)}...</td><td>${l.plan||"-"}</td><td>${venc}</td><td>${estado}</td></tr>`;
      });
      html += '</tbody></table>';
      usrDiv.innerHTML = html;
    }
  } catch(err) {
    console.error("Error cargando datos admin:", err);
    if (solDiv) solDiv.innerHTML = '<em style="color:#dc2626;">Error al cargar datos.</em>';
  }
}

window.aprobarSolicitud = async function(docId, email, plan) {
  const planMap = { "1 mes":"1mes","3 meses":"3meses","5 meses":"5meses","de por vida":"devida","1 día":"1dia","1 semana":"1semana" };
  const planKey = planMap[plan] || "1mes";
  document.getElementById("admin-nuevo-email").value = email;
  document.getElementById("admin-nuevo-plan").value = planKey;
  try {
    const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(doc(db, "solicitudes", docId), { estado: "aprobada" });
  } catch(e) {}
  await crearUsuarioAdmin();
};

// ======== LOGOUT ========
async function handleLogout() {
  try {
    const user = auth.currentUser;
    if (user) await deleteDoc(doc(db, "sessions", user.uid));
    await signOut(auth);
  } catch (err) {
    await signOut(auth).catch(() => {});
  }
}

// ======== MONITOREO DE SESIÓN + AUTO-LOGOUT POR INACTIVIDAD ========
let monitoreoInterval = null;
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
  if (monitoreoInterval) clearInterval(monitoreoInterval);
  const deviceId = getDeviceId();

  // Iniciar sistema de inactividad
  iniciarListenersActividad(user);

  monitoreoInterval = setInterval(async () => {
    try {
      if (!auth.currentUser) {
        clearInterval(monitoreoInterval);
        detenerListenersActividad();
        limpiarUI();
        mostrarLogin("Tu sesión fue cerrada. Ingresá nuevamente.");
        return;
      }
      const sessionRef = doc(db, "sessions", user.uid);
      const snap = await getDoc(sessionRef);
      if (!snap.exists()) {
        await signOut(auth);
        clearInterval(monitoreoInterval);
        detenerListenersActividad();
        limpiarUI();
        mostrarLogin("Tu sesión fue cerrada desde otro dispositivo.");
        return;
      }
      const data = snap.data();
      if (data.deviceId && data.deviceId !== deviceId) {
        await signOut(auth);
        clearInterval(monitoreoInterval);
        detenerListenersActividad();
        limpiarUI();
        mostrarLogin("⚠️ Tu sesión fue tomada por otro dispositivo.");
        return;
      }
      await setDoc(sessionRef, { ...data, lastActivity: serverTimestamp() });
    } catch (err) {
      console.warn("Error en monitoreo:", err);
    }
  }, 30000);
}

function limpiarUI() {
  document.body.style.paddingBottom = "";
  if (countdownBarInterval) { clearInterval(countdownBarInterval); countdownBarInterval = null; }
  window._demoCheckEnabled = false;
  licenciaActual = null;
  detenerListenersActividad();
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


onAuthStateChanged(auth, async (user) => {
  if (user) {
    const deviceId = getDeviceId();
    try {
      const licencia = await verificarLicencia(user.uid);
      licenciaActual = licencia;

      if (!licencia.valida) {
        await signOut(auth);
        if (licencia.vencida) mostrarLicenciaVencida(licencia.mensaje, licencia.esDemo);
        else mostrarLogin(licencia.mensaje);
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
