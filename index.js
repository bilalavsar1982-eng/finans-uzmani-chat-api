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

function runDailyUpdate(reason = "cron") {
  if (updateLock) return { updated: false };
  updateLock = true;
  lastUpdateDay = todayKey();
  updateLock = false;
  return { updated: true };
}

cron.schedule("0 10 * * *", () => {
  runDailyUpdate("cron");
}, { timezone: "Europe/Istanbul" });

// =============================
// HAFIZA
// =============================
const sessions = {};
function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      horizon: null,
      askedHorizon: false,
    };
  }
  return sessions[id];
}

// =============================
// UTIL
// =============================
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function translateSignal(sig) {
  if (sig === "BUY") return "AL";
  if (sig === "SELL") return "SAT";
  return "BEKLE";
}

// =============================
// KONU
// =============================
function detectTopic(msg) {
  if (msg.includes("altın") || msg.includes("gram") || msg.includes("çeyrek"))
    return "GOLD";
  return "GENERIC";
}

// =============================
// CEVAP ÜRETİMİ — GERÇEK ANALİZLİ
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const sessionId = body.sessionId || "anon";
  const mem = getSession(sessionId);

  if (msg.includes("kısa") || msg.includes("1 hafta")) mem.horizon = "SHORT";
  if (msg.includes("uzun")) mem.horizon = "LONG";

  if (!mem.horizon && !mem.askedHorizon) {
    mem.askedHorizon = true;
    return "Buna kısa vadeli (1 hafta) mi yoksa uzun vadeli mi bakmamı istersin?";
  }

  const topic = detectTopic(msg);

  // 🔥 GERÇEK ANALİZ
  const rawSignal = body.signal || "HOLD";
  const signal = translateSignal(rawSignal);
  const finalScore = typeof body.finalScore === "number" ? body.finalScore : 0;
  const technical = body.technicalScore || 0;
  const news = body.newsScore || 0;

  const weekly = body.weeklyPct;
  const monthly = body.monthlyPct;

  const confidence = clamp(
    Math.round(50 + Math.abs(finalScore) * 10),
    50,
    85
  );

  let reply = "";

  if (topic === "GOLD") {
    reply +=
      "Altın tarafında fiyat hareketleri hem teknik göstergeler hem de haber akışıyla birlikte değerlendiriliyor.\n\n";
  }

  // =============================
  // KISA VADE
  // =============================
  if (mem.horizon === "SHORT") {
    reply += "🔎 **Kısa vadeli (1 haftalık) değerlendirme:**\n";

    if (weekly !== undefined) {
      reply += `Son 7 günde yaklaşık %${weekly.toFixed(
        1
      )}’lik bir fiyat hareketi var. `;
    }

    if (news > technical) {
      reply +=
        "Kısa vadede karar üzerinde özellikle **haber etkisinin** daha baskın olduğu görülüyor. ";
    } else {
      reply +=
        "Kısa vadede fiyat yönünde **teknik göstergeler** daha belirleyici görünüyor. ";
    }

    reply +=
      "Bu nedenle ani dalgalanmalara karşı temkinli olunması daha dengeli bir yaklaşım olabilir.\n\n";
  }

  // =============================
  // UZUN VADE
  // =============================
  if (mem.horizon === "LONG") {
    reply += "📈 **Uzun vadeli değerlendirme:**\n";

    if (monthly !== undefined) {
      reply += `Son 1 ayda yaklaşık %${monthly.toFixed(
        1
      )}’lik bir değişim söz konusu. `;
    }

    reply +=
      "Uzun vadede genel trend, enflasyon beklentileri ve küresel risk algısı daha belirleyici oluyor.\n\n";
  }

  reply += `Kararım: **${signal}** (Güven: %${confidence})`;

  return reply;
}

// =============================
// ROUTE
// =============================
app.post("/finans-uzmani", (req, res) => {
  try {
    return res.json({ reply: buildReply(req.body) });
  } catch (e) {
    return res.status(500).json({ reply: "Geçici bir hata oluştu." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
