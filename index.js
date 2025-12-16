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

cron.schedule(
  "0 10 * * *",
  () => {
    console.log("[CRON 10:00]", runDailyUpdate("cron_10_00"));
  },
  { timezone: "Europe/Istanbul" }
);

app.post("/check-update", (req, res) => {
  const today = todayKey();
  if (lastUpdateDay === today) {
    return res.json({ ok: true, updated: false });
  }
  return res.json({ ok: true, ...runDailyUpdate("user_open") });
});

// =============================
// 🔥 HAFIZA (ÇOKLU KULLANICI)
// =============================
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      horizon: null,
      prevHorizon: null,
      askedHorizon: false,
      lastTopic: null,
      updatedAt: Date.now(),
    };
  }
  sessions[id].updatedAt = Date.now();
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
// KONU TESPİTİ
// =============================
function detectTopic(message = "", code = "") {
  const t = message.toUpperCase();
  const c = code.toUpperCase();

  if (c.includes("USD") || t.includes("DOLAR")) return "USD";
  if (c.includes("EUR") || t.includes("EURO")) return "EUR";
  if (c.includes("ONS")) return "ONS";
  if (t.includes("GUMUS") || t.includes("GÜMÜŞ")) return "SILVER";
  if (
    t.includes("ALTIN") ||
    t.includes("GRAM") ||
    t.includes("ÇEYREK") ||
    t.includes("ATA")
  )
    return "GOLD";
  return "GENERIC";
}

// =============================
// SİNYAL (BASİT)
// =============================
function decideSignal(body) {
  if (body.trend === "UP") return { signal: "AL", confidence: 65 };
  if (body.trend === "DOWN") return { signal: "SAT", confidence: 65 };
  return { signal: "BEKLE", confidence: 55 };
}

// =============================
// CÜMLE HAVUZLARI
// =============================
const OPENERS = {
  GOLD: [
    "Altın tarafında şu an temkinli bir görünüm var.",
    "Altında karar verirken acele etmemek gerekiyor.",
    "Altın cephesinde netlik henüz tam oluşmuş değil.",
  ],
  USD: [
    "Kur tarafında hareketler dalgalı.",
    "Dolar/TL kısa sürede yön değiştirebilir.",
  ],
  GENERIC: [
    "Piyasa şu an net bir yön vermiyor.",
    "Bu koşullarda dikkatli ilerlemek daha sağlıklı.",
  ],
};

const HORIZON_ASK = [
  "Buna 1 haftalık mı yoksa daha uzun vadeli mi bakmamı istersin?",
  "Kısa vade (1 hafta) mi, uzun vade mi düşünüyorsun?",
];

const HORIZON_SWITCH = {
  SHORT: "Tamam, kısa vadeye (1 hafta) geçiyorum.",
  LONG: "Anladım, uzun vadeli bakış açısına geçiyorum.",
};

const HORIZON_STYLE = {
  SHORT: {
    confirm: [
      "1 haftalık kısa vadeli bakış açısıyla değerlendiriyorum.",
      "Kısa vadede (1 hafta) fiyat hareketlerine odaklanıyorum.",
    ],
    advice: {
      AL: "Kısa vadede alım yapılacaksa hızlı dalgalanmalara dikkat edilmeli.",
      SAT: "Kısa vadede zararın büyümemesi için temkinli olmak önemli.",
      BEKLE: "Kısa vadede net yön oluşmadan işlem açmamak daha sağlıklı.",
    },
  },
  LONG: {
    confirm: [
      "Uzun vadeli perspektifle değerlendiriyorum.",
      "Daha geniş zaman dilimine göre yorumluyorum.",
    ],
    advice: {
      AL: "Uzun vadede alımların parçalı yapılması riski azaltır.",
      SAT: "Uzun vadede kâr realizasyonu düşünülebilir.",
      BEKLE: "Uzun vadede daha net seviyeler beklenebilir.",
    },
  },
};

// =============================
// CEVAP ÜRETİMİ — SEVİYE 3
// =============================
function buildReply(body) {
  const message = (body.message || "").toLowerCase();
  const sessionId = body.sessionId || "anon";
  const mem = getSession(sessionId);

  // Vade yakala
  if (message.includes("1 hafta") || message.includes("kısa")) {
    mem.prevHorizon = mem.horizon;
    mem.horizon = "SHORT";
  } else if (message.includes("uzun")) {
    mem.prevHorizon = mem.horizon;
    mem.horizon = "LONG";
  }

  const topic = detectTopic(message, body.code || "");
  mem.lastTopic = topic;

  // İlk defa vade sor
  if (!mem.horizon && !mem.askedHorizon) {
    mem.askedHorizon = true;
    return pick(HORIZON_ASK, hash32(sessionId));
  }

  const { signal, confidence } = decideSignal(body);

  // 🔥 SEED artık VADeyi de içeriyor → cevap değişir
  const seed = hash32(sessionId + topic + signal + mem.horizon);

  let reply = "";

  // Vade değiştiyse bunu söyle
  if (mem.prevHorizon && mem.prevHorizon !== mem.horizon) {
    reply += HORIZON_SWITCH[mem.horizon] + "\n\n";
  }

  reply += pick(OPENERS[topic] || OPENERS.GENERIC, seed) + "\n\n";

  if (mem.horizon) {
    reply += pick(HORIZON_STYLE[mem.horizon].confirm, seed) + "\n\n";
    reply += HORIZON_STYLE[mem.horizon].advice[signal] + "\n\n";
  }

  reply += `Kararım: **${signal}** (Güven: %${confidence})`;

  return reply;
}

// =============================
// ROUTES
// =============================
app.get("/", (req, res) => {
  res.send("Finans Uzmanı Chat API çalışıyor.");
});

app.post("/finans-uzmani", (req, res) => {
  try {
    if (!req.body || !req.body.message) {
      return res.json({ reply: "Mesaj boş görünüyor." });
    }
    return res.json({ reply: buildReply(req.body) });
  } catch (e) {
    return res.status(500).json({ reply: "Geçici bir hata oluştu." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
