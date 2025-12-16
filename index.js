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

// =============================
// HAFIZA (ÇOKLU KULLANICI)
// =============================
const sessions = {};
function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      horizon: null,       // SHORT / LONG
      askedHorizon: false,
    };
  }
  return sessions[id];
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
  if (
    msg.includes("çeyrek") ||
    msg.includes("altın") ||
    msg.includes("gram")
  )
    return "GOLD";
  return "GENERIC";
}

// =============================
// CEVAP ÜRETİMİ — SEVİYE 7 (DÜZELTİLDİ)
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const sessionId = body.sessionId || "anon";
  const mem = getSession(sessionId);

  // ---- VADE YAKALA
  if (msg.includes("kısa") || msg.includes("1 hafta")) mem.horizon = "SHORT";
  if (msg.includes("uzun")) mem.horizon = "LONG";

  if (!mem.horizon && !mem.askedHorizon) {
    mem.askedHorizon = true;
    return "Buna kısa vadeli (1 hafta) mi yoksa uzun vadeli mi bakmamı istersin?";
  }

  const intent = detectIntent(msg);
  const topic = detectTopic(msg);

  const weekly = body.weeklyPct;
  const monthly = body.monthlyPct;

  let reply = "";

  // ---- KONU GİRİŞİ
  if (topic === "GOLD") {
    reply +=
      "Altın tarafında son dönemde fiyatlar dalgalı bir seyir izliyor. " +
      "Bu nedenle karar verirken tek bir veriye odaklanmak sağlıklı olmaz.\n\n";
  }

  // ---- KISA VADE BLOĞU (TAMAMEN AYRI)
  if (mem.horizon === "SHORT") {
    reply +=
      "🔎 **Kısa vadeli (1 haftalık) değerlendirme:**\n" +
      "Kısa vadede fiyat hareketleri genellikle haber akışı ve ani dalgalanmalarla şekillenir. ";

    if (weekly !== undefined) {
      reply +=
        `Son 7 günde yaklaşık %${weekly.toFixed(
          1
        )}’lik bir değişim görülmüş olması, hareketliliğin arttığını gösteriyor. `;
    }

    if (intent === "BUY") {
      reply +=
        "Bu ortamda alım tarafında acele edilmesi, kısa sürede ters hareket riskini artırabilir. ";
    } else if (intent === "SELL") {
      reply +=
        "Satış düşünülüyorsa, ani panik yerine fiyatın davranışı biraz daha izlenmeli. ";
    }

    reply +=
      "Kısa vadede temkinli ve hızlı karar gerektirmeyen bir yaklaşım daha dengeli olabilir.\n\n";
  }

  // ---- UZUN VADE BLOĞU (TAMAMEN AYRI)
  if (mem.horizon === "LONG") {
    reply +=
      "📈 **Uzun vadeli değerlendirme:**\n" +
      "Uzun vadede altın fiyatları genellikle makroekonomik gelişmeler, enflasyon beklentileri ve küresel risk algısıyla şekillenir. ";

    if (monthly !== undefined) {
      reply +=
        `Son 1 ayda yaklaşık %${monthly.toFixed(
          1
        )}’lik bir hareket görülmesi, genel trend hakkında fikir verebilir. `;
    }

    if (intent === "BUY") {
      reply +=
        "Uzun vadeli alımlar söz konusuysa, tek sefer yerine kademeli yaklaşım riski azaltabilir. ";
    } else if (intent === "SELL") {
      reply +=
        "Uzun vadede satış kararı alınacaksa, aceleci davranmak yerine hedef seviyeler göz önünde bulundurulmalı. ";
    }

    reply +=
      "Bu perspektifte sabırlı olmak ve geniş zaman dilimini dikkate almak daha sağlıklı olur.\n\n";
  }

  reply +=
    "Bu yorum, mevcut fiyat verilerinin genel değerlendirmesine dayanmaktadır.";

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
