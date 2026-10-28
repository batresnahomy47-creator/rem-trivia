// REM · Trivia express para stand
// Servidor sin dependencias: solo necesita Node.js 18 o superior.
// Uso:  node server.js        (puerto 3000 por defecto)
// Variables opcionales: PORT, PUBLIC_URL (dirección pública si lo subes a internet), CLAVE_ADMIN

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const PREGUNTAS = require("./preguntas.js");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const CLAVE_ADMIN = process.env.CLAVE_ADMIN || "rem2026";
const DATA_FILE = path.join(__dirname, "datos.json");
// Busca los archivos en /public y, si esa carpeta no existe, junto a server.js
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, "public", "jugar.html")) ? path.join(__dirname, "public") : __dirname;
// Solo estos archivos se pueden descargar (así nadie ve las respuestas en preguntas.js)
const PERMITIDOS = new Set(["jugar.html", "pantalla.html", "admin.html", "logo-blanco.png", "logo-naranja.png", "qrcode.js"]);

const PREGUNTAS_POR_PARTIDA = 5;
const SEGUNDOS_POR_PREGUNTA = 12;

// ---------- Datos ----------
let datos = { jugadores: [] };
try { datos = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}
function guardar() {
  fs.writeFile(DATA_FILE, JSON.stringify(datos, null, 2), () => {});
}

const sesiones = new Map(); // sid -> partida en curso

function ranking(n = 10) {
  return [...datos.jugadores]
    .sort((a, b) => b.puntaje - a.puntaje || a.tiempoMs - b.tiempoMs)
    .slice(0, n)
    .map(j => ({ nombre: j.nombre, puntaje: j.puntaje, aciertos: j.aciertos, id: j.id }));
}

// ---------- Pantalla en vivo (Server-Sent Events) ----------
const pantallas = new Set();
function avisarPantallas(extra) {
  const msg = `data: ${JSON.stringify({ ranking: ranking(10), total: datos.jugadores.length, ...extra })}\n\n`;
  for (const res of pantallas) res.write(msg);
}
setInterval(() => { for (const res of pantallas) res.write(": ping\n\n"); }, 20000);

// ---------- Utilidades ----------
function ipLocal() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "localhost";
}
function urlJuego(req) {
  if (PUBLIC_URL) return PUBLIC_URL + "/";
  const host = req.headers.host || `localhost:${PORT}`;
  if (/^(localhost|127\.)/.test(host)) return `http://${ipLocal()}:${PORT}/`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}/`;
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function leerCuerpo(req) {
  return new Promise(resolve => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > 1e4) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}
function limpiar(t, max) { return String(t || "").replace(/[<>]/g, "").trim().slice(0, max); }
function mezclar(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".css": "text/css" };
function archivo(res, nombre) {
  if (!PERMITIDOS.has(nombre)) { res.writeHead(404); return res.end("No encontrado"); }
  const p = path.join(PUBLIC_DIR, nombre);
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
}
function csv(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }

// ---------- Rutas ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const r = url.pathname;

  if (req.method === "GET" && (r === "/" || r === "/jugar")) return archivo(res, "jugar.html");
  if (req.method === "GET" && r === "/pantalla") return archivo(res, "pantalla.html");
  if (req.method === "GET" && r === "/admin") return archivo(res, "admin.html");

  if (req.method === "GET" && r === "/api/config") return json(res, 200, { urlJuego: urlJuego(req) });
  if (req.method === "GET" && r === "/api/ranking") return json(res, 200, { ranking: ranking(10), total: datos.jugadores.length });

  if (req.method === "GET" && r === "/api/eventos") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ ranking: ranking(10), total: datos.jugadores.length })}\n\n`);
    pantallas.add(res);
    req.on("close", () => pantallas.delete(res));
    return;
  }

  // Empezar partida
  if (req.method === "POST" && r === "/api/empezar") {
    const b = await leerCuerpo(req);
    const nombre = limpiar(b.nombre, 24);
    const contacto = limpiar(b.contacto, 80);
    if (!nombre || !contacto) return json(res, 400, { error: "Escribe tu nombre y un contacto para avisarte si ganas." });
    const elegidas = mezclar(PREGUNTAS).slice(0, PREGUNTAS_POR_PARTIDA).map(p => {
      const ops = mezclar(p.opciones.map((t, i) => ({ t, ok: i === 0 })));
      return { texto: p.texto, opciones: ops.map(o => o.t), correcta: ops.findIndex(o => o.ok) };
    });
    const sid = crypto.randomUUID();
    sesiones.set(sid, {
      nombre, contacto, empresa: limpiar(b.empresa, 60), consentimiento: !!b.consentimiento,
      preguntas: elegidas, actual: 0, mostradaEn: Date.now(), puntaje: 0, aciertos: 0, tiempoMs: 0, creada: Date.now(),
    });
    return json(res, 200, {
      sid, segundos: SEGUNDOS_POR_PREGUNTA,
      preguntas: elegidas.map(p => ({ texto: p.texto, opciones: p.opciones })),
    });
  }

  // Marcar que el celular ya muestra la pregunta (inicia el reloj del servidor)
  if (req.method === "POST" && r === "/api/mostrar") {
    const b = await leerCuerpo(req);
    const s = sesiones.get(b.sid);
    if (s && b.indice === s.actual) s.mostradaEn = Date.now();
    return json(res, 200, { ok: true });
  }

  // Responder una pregunta
  if (req.method === "POST" && r === "/api/responder") {
    const b = await leerCuerpo(req);
    const s = sesiones.get(b.sid);
    if (!s || s.terminada) return json(res, 400, { error: "La partida ya no está activa." });
    if (b.indice !== s.actual) return json(res, 400, { error: "Pregunta fuera de orden." });
    const p = s.preguntas[s.actual];
    const ms = Math.min(Date.now() - s.mostradaEn, SEGUNDOS_POR_PREGUNTA * 1000);
    const enTiempo = ms < SEGUNDOS_POR_PREGUNTA * 1000 + 800;
    const ok = enTiempo && b.opcion === p.correcta;
    let puntos = 0;
    if (ok) {
      const restante = Math.max(0, SEGUNDOS_POR_PREGUNTA * 1000 - ms) / (SEGUNDOS_POR_PREGUNTA * 1000);
      puntos = 100 + Math.round(50 * restante);
      s.aciertos++;
    }
    s.puntaje += puntos;
    s.tiempoMs += ms;
    s.actual++;
    s.mostradaEn = Date.now();
    return json(res, 200, { correcta: ok, indiceCorrecto: p.correcta, puntos, puntaje: s.puntaje });
  }

  // Terminar y guardar
  if (req.method === "POST" && r === "/api/terminar") {
    const b = await leerCuerpo(req);
    const s = sesiones.get(b.sid);
    if (!s) return json(res, 400, { error: "La partida ya no está activa." });
    if (!s.terminada) {
      s.terminada = true;
      const clave = s.contacto.toLowerCase();
      const previo = datos.jugadores.find(j => j.contacto.toLowerCase() === clave);
      let registro;
      if (previo) {
        previo.partidas = (previo.partidas || 1) + 1;
        if (s.puntaje > previo.puntaje || (s.puntaje === previo.puntaje && s.tiempoMs < previo.tiempoMs)) {
          Object.assign(previo, { nombre: s.nombre, puntaje: s.puntaje, aciertos: s.aciertos, tiempoMs: s.tiempoMs, fecha: new Date().toISOString() });
        }
        if (s.consentimiento) previo.consentimiento = true;
        registro = previo;
      } else {
        registro = {
          id: crypto.randomUUID().slice(0, 8), nombre: s.nombre, contacto: s.contacto, empresa: s.empresa,
          consentimiento: s.consentimiento, puntaje: s.puntaje, aciertos: s.aciertos, tiempoMs: s.tiempoMs,
          partidas: 1, fecha: new Date().toISOString(),
        };
        datos.jugadores.push(registro);
      }
      guardar();
      s.registroId = registro.id;
      avisarPantallas({ nuevo: { nombre: s.nombre, puntaje: s.puntaje, aciertos: s.aciertos, id: registro.id } });
      setTimeout(() => sesiones.delete(b.sid), 60000);
    }
    // Posición que ocupa ESTA partida (si el jugador repite, se guarda su mejor puntaje)
    const mejores = datos.jugadores.filter(j => j.id !== s.registroId &&
      (j.puntaje > s.puntaje || (j.puntaje === s.puntaje && j.tiempoMs < s.tiempoMs))).length;
    return json(res, 200, { puntaje: s.puntaje, aciertos: s.aciertos, total: s.preguntas.length, posicion: mejores + 1, jugadores: datos.jugadores.length });
  }

  // ---------- Administración ----------
  if (r.startsWith("/api/admin/")) {
    if (url.searchParams.get("clave") !== CLAVE_ADMIN) return json(res, 403, { error: "Clave incorrecta." });
    if (req.method === "GET" && r === "/api/admin/jugadores") return json(res, 200, { jugadores: datos.jugadores });
    if (req.method === "GET" && r === "/api/admin/csv") {
      const filas = [["nombre", "contacto", "empresa", "acepta_contacto", "puntaje", "aciertos", "tiempo_seg", "partidas", "fecha"]]
        .concat(datos.jugadores.map(j => [j.nombre, j.contacto, j.empresa, j.consentimiento ? "si" : "no", j.puntaje, j.aciertos, (j.tiempoMs / 1000).toFixed(1), j.partidas, j.fecha]));
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rem-jugadores.csv"' });
      return res.end("\ufeff" + filas.map(f => f.map(csv).join(",")).join("\n"));
    }
    if (req.method === "POST" && r === "/api/admin/borrar") {
      datos.jugadores = []; guardar(); avisarPantallas({ reinicio: true });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && r === "/api/admin/ganadores") {
      avisarPantallas({ revelar: true });
      return json(res, 200, { ok: true });
    }
  }

  // Archivos estáticos (logo, librería de QR)
  if (req.method === "GET" && /^\/[\w.-]+\.(png|js|css)$/.test(r)) return archivo(res, r.slice(1));

  res.writeHead(404); res.end("No encontrado");
});

server.listen(PORT, () => {
  const ip = ipLocal();
  console.log("\n  REM · Trivia express lista\n");
  console.log(`  Pantalla del stand:  http://localhost:${PORT}/pantalla`);
  console.log(`  Juego (celulares):   ${PUBLIC_URL || `http://${ip}:${PORT}`}/`);
  console.log(`  Administración:      http://localhost:${PORT}/admin   (clave: ${CLAVE_ADMIN})\n`);
});
