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
// ENSTRÜMAN TESPİTİ (ÜRÜNE ÖZEL)
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
// CEVAP ÜRETİMİ — TAM
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

  const rawSignal = body.signal || "HOLD";
  const signal = translateSignal(rawSignal);

  const finalScore =
    typeof body.finalScore === "number" ? body.finalScore : 0;

  const technical = body.technicalScore || 0;
  const newsScore = body.newsScore || 0;

  const weekly = body.weeklyPct;
  const monthly = body.monthlyPct;

  const newsTitles = Array.isArray(body.newsTitles)
    ? body.newsTitles.slice(0, 3)
    : [];

  const confidence = clamp(
    Math.round(50 + Math.abs(finalScore) * 10),
    50,
    85
  );

  let reply = "";

  // =============================
  // ÜRÜNE ÖZEL GİRİŞ
  // =============================
  if (instrument === "USDTRY") {
    reply +=
      "Dolar/TL için değerlendirme; yurt içi enflasyon, TCMB politikaları ve küresel dolar endeksi dikkate alınarak yapılmıştır.\n\n";
  }

  if (instrument === "EURTRY") {
    reply +=
      "Euro/TL değerlendirmesi; Euro Bölgesi verileri ve parite hareketleri dikkate alınarak yapılmıştır.\n\n";
  }

  if (instrument === "GRAM") {
    reply +=
      "Gram altın değerlendirmesi; ons altın ve dolar/TL birlikte ele alınarak yapılmıştır.\n\n";
  }

  if (
    instrument === "ATA" ||
    instrument === "CEYREK" ||
    instrument === "YARIM" ||
    instrument === "TAM"
  ) {
    reply +=
      "Bu ürün için değerlendirme; gram altın fiyatı, piyasa primi ve kuyumcu makası dikkate alınarak yapılmıştır.\n\n";
  }

  if (instrument === "BILEZIK_22") {
    reply +=
      "22 ayar bilezik değerlendirmesi; gram altın fiyatı ve işçilik maliyetleri dikkate alınarak yapılmıştır.\n\n";
  }

  if (instrument === "ONS") {
    reply +=
      "Ons altın değerlendirmesi; ABD faiz beklentileri, küresel risk algısı ve dolar endeksi temel alınarak yapılmıştır.\n\n";
  }

  if (instrument === "GUMUS") {
    reply +=
      "Gümüş için değerlendirme; sanayi talebi ve değerli metaller piyasası dikkate alınarak yapılmıştır.\n\n";
  }

  // =============================
  // KISA VADE — 3 MADDE
  // =============================
  if (mem.horizon === "SHORT") {
    reply += "🔎 **Kısa vadeli (1 haftalık) değerlendirme:**\n";

    let reasons = [];

    if (weekly !== undefined) {
      reasons.push(
        `Son 7 günlük fiyat değişimi %${weekly.toFixed(
          1
        )} seviyesinde`
      );
    }

    if (newsScore > technical) {
      reasons.push(
        "Haber akışı kısa vadede fiyat hareketlerinde daha baskın"
      );
    } else {
      reasons.push(
        "Teknik göstergeler kısa vadede fiyat yönünde daha etkili"
      );
    }

    reasons.push(
      "Kısa vadede ani yön değişimleri görülebileceği için risk seviyesi yüksek"
    );

    reasons.slice(0, 3).forEach((r, i) => {
      reply += `${i + 1}. ${r}\n`;
    });

    if (newsTitles.length > 0) {
      reply += "\n📰 **Öne çıkan haber başlıkları:**\n";
      newsTitles.forEach((t) => {
        reply += `• ${t}\n`;
      });
    }

    reply += "\n";
  }

  // =============================
  // UZUN VADE — MAKRO + TEKNİK
  // =============================
  if (mem.horizon === "LONG") {
    reply += "📈 **Uzun vadeli değerlendirme:**\n\n";

    reply += "🌍 **Makro görünüm:**\n";
    reply +=
      "Enflasyon beklentileri, küresel risk algısı ve merkez bankalarının para politikaları belirleyici konumda.\n\n";

    reply += "📊 **Teknik görünüm:**\n";
    if (monthly !== undefined) {
      reply += `Son 1 ayda yaklaşık %${monthly.toFixed(
        1
      )}’lik fiyat hareketi görülüyor. `;
    }
    reply +=
      "Bu yapı uzun vadeli yönün daha sağlıklı değerlendirilmesine imkan tanıyor.\n\n";
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
