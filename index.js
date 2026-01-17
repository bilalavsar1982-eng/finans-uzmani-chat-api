const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

// =============================
// RENDER DEPLOY KORUMA
// =============================
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// GÜNCELLEME KONTROL
// =============================
let lastUpdateDay = "";
let updateLock = false;

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function runDailyUpdate() {
  if (updateLock) return;
  updateLock = true;
  lastUpdateDay = todayKey();
  updateLock = false;
}

cron.schedule("0 10 * * *", runDailyUpdate, {
  timezone: "Europe/Istanbul",
});

// =============================
// UTIL
// =============================
function sanitizeNumber(v) {
  return typeof v === "number" && !isNaN(v) ? v : 0;
}

// =============================
// ROUTE — SADE VERİ
// =============================
app.post("/finans-uzmani", (req, res) => {
  try {
    const body = req.body || {};

    return res.json({
      signal: body.signal || "HOLD",
      technicalScore: sanitizeNumber(body.technicalScore),
      newsScore: sanitizeNumber(body.newsScore),
      finalScore: sanitizeNumber(body.finalScore),
      dailyPct: sanitizeNumber(body.dailyPct),
      weeklyPct: sanitizeNumber(body.weeklyPct),
      monthlyPct: sanitizeNumber(body.monthlyPct),
      newsTitles: Array.isArray(body.newsTitles)
        ? body.newsTitles.slice(0, 3)
        : [],
    });
  } catch (e) {
    console.error("API ERROR:", e);
    return res.status(500).json({
      error: "SERVICE_TEMPORARILY_UNAVAILABLE",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor (sessiz mod), port:", PORT);
});
