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
// TARİH
// =============================
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// =============================
// GÜNLÜK LİMİT HAFIZASI
// =============================
const dailyUsage = {};
const DAILY_LIMIT = 3;

function getClientKey(req) {
  const deviceId = req.body?.sessionId || "unknown";
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "ip";
  return `${todayKey()}_${deviceId}_${ip}`;
}

// =============================
// ADMIN İSTATİSTİK
// =============================
const adminStats = {
  totalRequests: 0,
  blockedRequests: 0,
  uniqueClients: new Set(),
};

// =============================
// GÜNCELLEME KONTROL
// =============================
let updateLock = false;

function runDailyUpdate() {
  if (updateLock) return;
  updateLock = true;

  // her gün sıfırla
  for (const k in dailyUsage) delete dailyUsage[k];
  adminStats.uniqueClients.clear();
  adminStats.totalRequests = 0;
  adminStats.blockedRequests = 0;

  updateLock = false;
}

cron.schedule("0 0 * * *", runDailyUpdate, {
  timezone: "Europe/Istanbul",
});

// =============================
// HAFIZA (CHAT KONUŞMASI)
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
// ENSTRÜMAN TESPİTİ
// =============================
function detectInstrument(msg) {
  if (msg.includes("dolar") || msg.includes("usd")) return "USDTRY";
  if (msg.includes("euro") || msg.includes("eur")) return "EURTRY";
  if (msg.includes("ons")) return "ONS";
  if (msg.includes("ata")) return "ATA";
  if (msg.includes("çeyrek")) return "CEYREK";
  if (msg.includes("yarım")) return "YARIM";
  if (msg.includes("tam")) return "TAM";
  if (msg.includes("bilezik")) return "BILEZIK_22";
  if (msg.includes("gram")) return "GRAM";
  if (msg.includes("gümüş")) return "GUMUS";
  if (msg.includes("altın")) return "ALTIN_GENEL";
  return "GENERIC";
}

// =============================
// CEVAP ÜRETİMİ
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const sessionId = body.sessionId || "anon";
  const mem = getSession(sessionId);

  if (msg.includes("kısa") || msg.includes("kisa") || msg.includes("1 hafta"))
    mem.horizon = "SHORT";
  if (msg.includes("uzun")) mem.horizon = "LONG";

  if (!mem.horizon && !mem.askedHorizon) {
    mem.askedHorizon = true;
    return "Kısa vadeli mi (1 hafta) yoksa uzun vadeli mi bakayım?";
  }

  const instrument = detectInstrument(msg);
  const signal = translateSignal(body.signal || "HOLD");
  const finalScore = typeof body.finalScore === "number" ? body.finalScore : 0;
  const weekly = body.weeklyPct;
  const monthly = body.monthlyPct;

  const confidence = clamp(
    Math.round(50 + Math.abs(finalScore) * 10),
    50,
    85
  );

  let reply = "";

  if (instrument === "USDTRY")
    reply += "Dolar/TL değerlendirmesi yapılmıştır.\n\n";
  if (instrument === "GRAM")
    reply += "Gram altın değerlendirmesi yapılmıştır.\n\n";

  if (mem.horizon === "SHORT") {
    reply += "🔎 Kısa vadeli:\n";
    if (weekly !== undefined)
      reply += `• 7 günlük değişim %${weekly.toFixed(1)}\n`;
    reply += "\n";
  }

  if (mem.horizon === "LONG") {
    reply += "📈 Uzun vadeli:\n";
    if (monthly !== undefined)
      reply += `• 1 aylık değişim %${monthly.toFixed(1)}\n`;
    reply += "\n";
  }

  reply += `Karar: ${signal} (Güven %${confidence})`;
  return reply;
}

// =============================
// ROUTE — FİNANS UZMANI
// =============================
app.post("/finans-uzmani", (req, res) => {
  const clientKey = getClientKey(req);

  adminStats.totalRequests++;
  adminStats.uniqueClients.add(clientKey);

  dailyUsage[clientKey] = (dailyUsage[clientKey] || 0) + 1;

  if (dailyUsage[clientKey] > DAILY_LIMIT) {
    adminStats.blockedRequests++;
    return res.status(429).json({
      reply: "Günlük ücretsiz soru limitin doldu (3/3).",
    });
  }

  try {
    return res.json({ reply: buildReply(req.body) });
  } catch (e) {
    return res.status(500).json({
      reply: "Geçici bir hata oluştu.",
    });
  }
});

// =============================
// ADMIN PANEL (JSON)
// =============================
app.get("/admin/stats", (req, res) => {
  const auth = req.headers.authorization || "";
  if (auth !== "Bearer admin123") {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  res.json({
    totalRequests: adminStats.totalRequests,
    blockedRequests: adminStats.blockedRequests,
    uniqueUsers: adminStats.uniqueClients.size,
    date: todayKey(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
