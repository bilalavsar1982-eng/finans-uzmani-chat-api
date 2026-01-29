const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// CRON
// =============================
let updateLock = false;
cron.schedule(
  "0 10 * * *",
  () => {
    if (updateLock) return;
    updateLock = true;
    updateLock = false;
  },
  { timezone: "Europe/Istanbul" }
);

// =============================
// SESSION
// =============================
const sessions = {};
const getSession = (id) =>
  (sessions[id] ||= {
    horizon: null,
    askedHorizon: false,
    professionalUsedToday: false,
    professionalDate: null
  });

// =============================
// UTIL
// =============================
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pick = (arr, used) => {
  const pool = arr.filter((x) => !used.has(x));
  const sel =
    (pool.length ? pool : arr)[Math.floor(Math.random() * arr.length)];
  used.add(sel);
  return sel;
};

// =============================
// ENSTRÜMAN
// =============================
function detectInstrument(msg) {
  if (msg.includes("dolar")) return "USD";
  if (msg.includes("euro")) return "EUR";
  if (msg.includes("gümüş")) return "GUMUS";
  if (msg.includes("ons")) return "ONS";
  if (msg.includes("gram")) return "GRAM";
  if (msg.includes("çeyrek")) return "CEYREK";
  if (msg.includes("yarım")) return "YARIM";
  if (msg.includes("tam")) return "TAM";
  if (msg.includes("ata")) return "ATA";
  if (msg.includes("bilezik")) return "BILEZIK";
  if (msg.includes("altın")) return "ALTIN";
  return "GENERIC";
}

// =============================
// MAKRO
// =============================
function macroScore(msg) {
  let s = 0;
  if (msg.match(/savaş|ortadoğu|jeopolitik|rusya|ukrayna/)) s += 2;
  if (msg.match(/fed|faiz|merkez bankası/)) s += 1;
  if (msg.match(/enflasyon|resesyon|kriz/)) s += 1;
  if (msg.match(/çin|abd|amerika/)) s += 1;
  return s;
}

// =============================
// KARAR
// =============================
function decide(weekly, monthly, macro) {
  let s = 0;
  if (weekly > 0) s++;
  if (weekly < 0) s--;
  if (monthly > 0) s++;
  if (monthly < 0) s--;
  if (macro >= 2) s++;
  if (macro <= -2) s--;
  if (s >= 2) return "AL";
  if (s <= -2) return "SAT";
  return "BEKLE";
}

// =============================
// CEVAP
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const mem = getSession(body.sessionId || "x");
  const today = new Date().toISOString().slice(0, 10);
  const professionalMode = body.professionalMode === true;

  if (professionalMode) {
    if (mem.professionalDate !== today) {
      mem.professionalDate = today;
      mem.professionalUsedToday = false;
    }

    if (mem.professionalUsedToday) {
      return "Profesyonel Mod için günlük soru hakkın doldu. Yarın tekrar deneyebilirsin.";
    }

    mem.professionalUsedToday = true;
  }

  if (!professionalMode) {
    if (msg.includes("kısa")) mem.horizon = "SHORT";
    if (msg.includes("uzun")) mem.horizon = "LONG";

    if (!mem.horizon && !mem.askedHorizon) {
      mem.askedHorizon = true;
      return "Kısa vadeli mi bakalım, uzun vadeden mi konuşalım?";
    }
  }

  const inst = detectInstrument(msg);
  const macro = macroScore(msg);
  const weekly = body.weeklyPct || 0;
  const monthly = body.monthlyPct || 0;

  const signal = decide(weekly, monthly, macro);
  const conf = clamp(55 + macro * 10, 55, 85);

  const tone =
    conf >= 75 ? "STRONG" :
    conf >= 60 ? "NORMAL" :
    "SOFT";

  const used = new Set();
  let r = "🧠 Genel tablo:\n";
  r += "• " + pick(WORDS[inst] || WORDS.GENERIC, used) + "\n";
  r += "• " + pick(WORDS[inst] || WORDS.GENERIC, used) + "\n\n";

  r += "📌 Değerlendirme:\n";
  r += "• " + pick(SIGNAL_TONE[tone][signal], used) + "\n\n";
  r += `Sonuç: ${signal} (Güven: %${conf})`;

  return r;
}

// =============================
app.post("/finans-uzmani", (req, res) => {
  res.json({ reply: buildReply(req.body) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Çalışıyor:", PORT));
