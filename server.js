// server.js - API + pagina web para recibir datos de un ESP32
// Se despliega en Railway y guarda los datos en PostgreSQL de Aiven.

require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Conexion a la base de datos (Aiven exige SSL) ----------
// Se quita "?sslmode=require" de la URI porque el SSL se configura abajo.
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || "").split("?")[0],
  ssl: process.env.DB_CA_CERT
    ? { ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n") }
    : { rejectUnauthorized: false },
  max: 5,
});

async function crearTabla() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lecturas (
      id SERIAL PRIMARY KEY,
      dispositivo VARCHAR(50) NOT NULL,
      sensor VARCHAR(50) NOT NULL,
      valor REAL NOT NULL,
      creado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("Tabla 'lecturas' lista");
}

// ---------- Seguridad minima: clave compartida con el ESP32 ----------
function revisarClave(req, res, next) {
  if (req.get("x-api-key") !== process.env.API_KEY) {
    return res.status(401).json({ error: "API key invalida" });
  }
  next();
}

// ---------- Rutas ----------
app.get("/api/salud", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "conectada" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// El ESP32 manda: {"dispositivo":"semaforo-aula","sensor":"amplitud","valor":23}
app.post("/api/lecturas", revisarClave, async (req, res) => {
  const { dispositivo, sensor, valor } = req.body;
  if (!dispositivo || !sensor || typeof valor !== "number") {
    return res.status(400).json({ error: "Faltan campos o 'valor' no es numero" });
  }
  try {
    const r = await pool.query(
      "INSERT INTO lecturas (dispositivo, sensor, valor) VALUES ($1, $2, $3) RETURNING id",
      [dispositivo, sensor, valor]
    );
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al guardar" });
  }
});

// La pagina web pide las ultimas lecturas
app.get("/api/lecturas", async (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 50, 500);
  try {
    const r = await pool.query(
      "SELECT * FROM lecturas ORDER BY id DESC LIMIT $1",
      [limite]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al leer" });
  }
});

// ---------- Arranque ----------
const PORT = process.env.PORT || 3000; // Railway define PORT solo
app.listen(PORT, async () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  try {
    await crearTabla();
  } catch (err) {
    console.error("No se pudo conectar a la base de datos:", err.message);
  }
});