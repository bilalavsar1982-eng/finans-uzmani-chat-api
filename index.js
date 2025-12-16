const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

// =============================
// RENDER DEPLOY KORUMA (ÇÖKMEYİ ENGELLER)
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
// GÜNCELLEME KONTROL DEĞİŞKENLERİ
// =============================

// Son güncelleme günü (YYYY-MM-DD)
let lastUpdateDay = "";
// Aynı anda 2 kere çalışmasın diye basit kilit
let updateLock = false;

// Türkiye saatiyle bugünün tarihi
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// =============================
// GÜNCELLEME İŞİ (ŞİMDİLİK SADECE İŞARET)
// =============================
function runDailyUpdate(reason = "cron") {
  if (updateLock) return { updated: false, reason: "locked" };

  updateLock = true;
  const today = todayKey();

  // ⚠️ Buraya ileride gerçek fiyat çekme / sinyal güncelleme koyacaksın
  lastUpdateDay = today;

  updateLock = false;
  return { updated: true, reason };
}

// =============================
// CRON – GÜNDE 1 KERE 10:00
// =============================
cron.schedule(
  "0 10 * * *",
  () => {
    const result = runDailyUpdate("cron_10_00");
    console.log("[CRON 10:00]", result);
  },
  {
    timezone: "Europe/Istanbul",
  }
);

// =============================
// KULLANICI GİRİNCE KONTROL
// =============================
app.post("/check-update", (req, res) => {
  const today = todayKey();

  if (lastUpdateDay === today) {
    return res.json({
      ok: true,
      updated: false,
      message: "Bugün zaten güncellendi",
    });
  }

  const result = runDailyUpdate("user_open");
  return res.json({
    ok: true,
    updated: result.updated,
    message: "Kullanıcı girişinde güncellendi",
  });
});

// -----------------------------
// Deterministic seçim
// -----------------------------
function hash32(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick(arr, seed) {
  if (!arr || arr.length === 0) return "";
  return arr[seed % arr.length];
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// -----------------------------
// Ürün/Konu tespiti
// -----------------------------
function detectTopic(message = "", code = "") {
  const t = (message || "").toUpperCase();
  const c = (code || "").toUpperCase();

  if (c.includes("USD") || t.includes("DOLAR") || t.includes("USD")) return "USD";
  if (c.includes("EUR") || t.includes("EURO") || t.includes("EUR")) return "EUR";
  if (c.includes("ONS") || t.includes("ONS")) return "ONS";
  if (c.includes("GUMUS") || t.includes("GÜMÜŞ")) return "SILVER";
  if (
    t.includes("ALTIN") ||
    t.includes("GRAM") ||
    t.includes("ÇEYREK") ||
    t.includes("CEYREK") ||
    t.includes("ATA") ||
    t.includes("22")
  )
    return "GOLD";

  return "GENERIC";
}

// -----------------------------
// Basit sinyal
// -----------------------------
function decideSignal(body) {
  let signal = "BEKLE";
  let confidence = 55;

  if (body.trend === "UP") {
    signal = "AL";
    confidence = 65;
  } else if (body.trend === "DOWN") {
    signal = "SAT";
    confidence = 65;
  }

  return { signal, confidence };
}

// -----------------------------
// Cevap üretimi
// -----------------------------
function buildReply(body) {
  const message = body.message || "";
  const seed = hash32(message.toLowerCase());
  const topic = detectTopic(message, body.code || "");
  const { signal, confidence } = decideSignal(body);

  const openers = {
    GOLD: "Altın tarafında acele karar vermek risklidir.",
    USD: "Kur tarafında dalgalanma devam ediyor.",
    EUR: "Euro cephesinde yön teyidi önemli.",
    ONS: "Ons altın küresel verilerden etkileniyor.",
    SILVER: "Gümüş daha sert hareket edebilir.",
    GENERIC: "Bu tür sorularda temkinli olmak gerekir.",
  };

  let reply = "";
  reply += `${openers[topic]}\n\n`;
  reply += `Kararım: **${signal}** (Güven: %${confidence})\n\n`;
  reply += "Not: Bu yorum yatırım tavsiyesi değildir.";

  return reply;
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (req, res) => {
  res.send("Finans Uzmanı Chat API çalışıyor.");
});

app.post("/finans-uzmani", (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) {
      return res.json({ reply: "Mesaj boş görünüyor." });
    }
    const reply = buildReply(req.body);
    return res.json({ reply });
  } catch (e) {
    return res.status(500).json({
      reply: "Geçici bir hata oluştu, tekrar dener misin?",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
