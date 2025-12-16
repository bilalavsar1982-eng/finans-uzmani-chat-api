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
  if (updateLock) return { updated: false, reason: "locked" };
  updateLock = true;
  lastUpdateDay = todayKey();
  updateLock = false;
  return { updated: true, reason };
}

cron.schedule("0 10 * * *", () => {
  console.log("[CRON 10:00]", runDailyUpdate("cron_10_00"));
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

// =============================
// INTENT ALGILAMA
// =============================
function detectIntent(msg) {
  if (msg.includes("alayım") || msg.includes("alalım")) return "BUY";
  if (msg.includes("satayım") || msg.includes("satalım")) return "SELL";
  return "INFO";
}

// =============================
// KONU
// =============================
function detectTopic(msg) {
  if (msg.includes("çeyrek") || msg.includes("altın") || msg.includes("gram"))
    return "GOLD";
  return "GENERIC";
}

// =============================
// CEVAP ÜRETİMİ — GERÇEK VERİLİ
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

  const intent = detectIntent(msg);
  const topic = detectTopic(msg);

  // 🔥 ANDROID'DEN GELEN GERÇEK ANALİZ
  const signal = body.signal || "BEKLE";
  const finalScore = typeof body.finalScore === "number" ? body.finalScore : 0;
  const weekly = body.weeklyPct;
  const monthly = body.monthlyPct;

  // 🔥 GÜVEN YÜZDESİ (GERÇEK)
  const confidence = clamp(
    Math.round(50 + Math.abs(finalScore) * 10),
    50,
    85
  );

  let reply = "";

  if (topic === "GOLD") {
    reply +=
      "Altın tarafında mevcut fiyat hareketleri hem teknik hem de haber etkileriyle şekilleniyor.\n\n";
  }

  if (mem.horizon === "SHORT") {
    reply += "🔎 **Kısa vadeli (1 haftalık) değerlendirme:**\n";
    if (weekly !== undefined) {
      reply += `Son 7 günde yaklaşık %${weekly.toFixed(1)}’lik bir değişim görülüyor. `;
    }
    reply +=
      "Kısa vadede dalgalanma riski yüksek olduğu için daha temkinli bir yaklaşım öne çıkıyor.\n\n";
  }

  if (mem.horizon === "LONG") {
    reply += "📈 **Uzun vadeli değerlendirme:**\n";
    if (monthly !== undefined) {
      reply += `Son 1 ayda yaklaşık %${monthly.toFixed(1)}’lik bir hareket var. `;
    }
    reply +=
      "Uzun vadede ise genel trend ve makro koşullar daha belirleyici oluyor.\n\n";
  }

  reply += `Kararım: **${signal}** (Güven: %${confidence})`;

  return reply;
}

// =============================
// ROUTES
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
