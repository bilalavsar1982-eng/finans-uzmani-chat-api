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
// CEVAP ÜRETİMİ — KONUŞAN BACKEND
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
    return "Buna kısa vadeli (1 hafta) mi yoksa uzun vadeli mi bakmamı istersin?";
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
    reply +=
      "Dolar/TL değerlendirmesi; TCMB politikaları ve küresel dolar endeksi dikkate alınarak yapılmıştır.\n\n";

  if (instrument === "GRAM")
    reply +=
      "Gram altın değerlendirmesi; ons altın ve dolar/TL birlikte ele alınarak yapılmıştır.\n\n";

  if (mem.horizon === "SHORT") {
    reply += "🔎 Kısa vadeli değerlendirme:\n";
    if (weekly !== undefined)
      reply += `• Son 7 günlük değişim %${weekly.toFixed(1)} seviyesinde\n`;
    reply += "• Kısa vadede dalgalanma riski yüksektir\n\n";
  }

  if (mem.horizon === "LONG") {
    reply += "📈 Uzun vadeli değerlendirme:\n";
    if (monthly !== undefined)
      reply += `• Son 1 ayda yaklaşık %${monthly.toFixed(1)}’lik hareket gözleniyor\n`;
    reply += "• Makro veriler daha belirleyici konumda\n\n";
  }

  reply += `Kararım: ${signal} (Güven: %${confidence})`;
  return reply;
}

// =============================
// ROUTE — MEVCUT
// =============================
app.post("/finans-uzmani", (req, res) => {
  try {
    return res.json({ reply: buildReply(req.body) });
  } catch (e) {
    return res.status(500).json({
      reply: "Geçici bir hata oluştu.",
    });
  }
});

// =======================================================
// 🔴 /translate — GOOGLE TRANSLATE (KEYSİZ)
// =======================================================
app.post("/translate", async (req, res) => {
  try {
    const text = req.body.text || "";
    if (!text) return res.json({ translated: "" });

    const url =
      "https://translate.googleapis.com/translate_a/single" +
      "?client=gtx&sl=auto&tl=tr&dt=t&q=" +
      encodeURIComponent(text);

    const r = await fetch(url);
    const j = await r.json();

    const translated = j[0].map((x) => x[0]).join("");
    res.json({ translated });
  } catch (e) {
    res.json({ translated: req.body.text });
  }
});

// =======================================================
// 🔴 /haberler — mining.com/rss (TÜRKÇE)
// =======================================================
app.get("/haberler", async (req, res) => {
  try {
    const rssUrl = "https://www.mining.com/rss";
    const rssRes = await fetch(rssUrl);
    const xml = await rssRes.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;

    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];

      const title =
        block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || "";
      const desc =
        block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)
          ?.[1]?.trim() || "";
      const link =
        block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || "";

      if (!title) continue;

      items.push({
        title,
        content: desc,
        link,
        date: new Date().toISOString(),
        isTurkey: false,
        importance: "LOW",
      });
    }

    const out = [];

    for (const n of items.slice(0, 15)) {
      if (/[ğüşöçıİĞÜŞÖÇ]/i.test(n.title)) {
        out.push(n);
        continue;
      }

      const url =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx&sl=en&tl=tr&dt=t&q=" +
        encodeURIComponent(n.title);

      const r = await fetch(url);
      const j = await r.json();
      const trTitle = j[0].map((x) => x[0]).join("");

      out.push({
        ...n,
        title: trTitle,
      });
    }

    res.json(out);
  } catch (e) {
    console.error("HABERLER HATA:", e);
    res.json([]);
  }
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
