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
function hash32(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick(arr, seed) {
  return arr[seed % arr.length];
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
// SEVİYE 7 YORUM
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const sessionId = body.sessionId || "anon";
  const mem = getSession(sessionId);

  if (msg.includes("kısa") || msg.includes("1 hafta")) mem.horizon = "SHORT";
  if (msg.includes("uzun")) mem.horizon = "LONG";

  if (!mem.horizon && !mem.askedHorizon) {
    mem.askedHorizon = true;
    return "Buna kısa vadeli mi (1 hafta) yoksa uzun vadeli mi bakmamı istersin?";
  }

  const intent = detectIntent(msg);
  const topic = detectTopic(msg);

  const daily = body.dailyPct;
  const weekly = body.weeklyPct;
  const monthly = body.monthlyPct;
  const risk = body.riskSignal || "HOLD";

  let text = "";

  if (topic === "GOLD") {
    text += "Altın tarafında son dönemde fiyat hareketleri dalgalı seyrediyor.\n\n";
  }

  if (weekly !== undefined) {
    text += `Son 7 günde fiyatlarda yaklaşık %${weekly.toFixed(1)}’lik bir değişim görülüyor.\n\n`;
  }

  if (intent === "BUY") {
    text += "Alım tarafında acele edilmesi, dalgalı dönemlerde psikolojik baskı oluşturabilir. ";
  } else if (intent === "SELL") {
    text += "Satış tarafında ise mevcut seviyeler panik gerektiren bir baskı üretmiyor. ";
  }

  if (mem.horizon === "SHORT") {
    text += "Kısa vadede belirsizlik ön planda olduğu için temkinli olmak daha dengeli bir yaklaşım olabilir.\n\n";
  } else {
    text += "Uzun vadede fiyatlar genellikle daha geniş bir perspektifle değerlendirilmelidir.\n\n";
  }

  text += "Bu değerlendirme, mevcut verilerin genel yorumuna dayanmaktadır.";

  return text;
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
