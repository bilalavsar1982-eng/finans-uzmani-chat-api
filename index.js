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
  (sessions[id] ||= { horizon: null, askedHorizon: false });

// =============================
// UTIL
// =============================
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pick = (arr, used) => {
  const pool = arr.filter((x) => !used.has(x));
  const sel =
    (pool.length ? pool : arr)[
      Math.floor(Math.random() * arr.length)
    ];
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
// ÜRÜN KELİMELERİ
// =============================
const WORDS = {
  USD: [
    "Dolar tarafı sakin ama tetikte.",
    "Kur cephesinde kontrollü bir gidiş var.",
    "Dolar yön arayışında.",
    "Kur tarafında baskı sınırlı.",
    "Dolar ani hareket için zemin kolluyor.",
    "Kurda panik yok ama rahat da değil.",
    "Dolar tarafı sabır isteyen bir yerde.",
  ],
  EUR: [
    "Euro tarafı dalgalı seyrediyor.",
    "Euro net bir yön ortaya koyamadı.",
    "Parite baskısı euroyu sınırlıyor.",
    "Euro cephesinde kararsızlık var.",
    "Euro ani kopuş için henüz zayıf.",
  ],
  ALTIN: [
    "Altın güvenli liman refleksi veriyor.",
    "Altın haber akışına oldukça duyarlı.",
    "Altın yatırımcısı aceleci olmamalı.",
    "Altın uzun soluklu düşüneni sever.",
  ],
  GRAM: [
    "Gram altın ons ve kur arasında sıkışmış durumda.",
    "Gram tarafı yön bulmakta zorlanıyor.",
    "Gramda geri çekilmeler normal.",
  ],
  ONS: [
    "Ons altın küresel haberlerle yön buluyor.",
    "Ons tarafı sürprize açık.",
  ],
  GUMUS: [
    "Gümüş sert hareket etmeyi sever.",
    "Gümüş altına göre daha oynak.",
    "Gümüş sabırsızı zorlar.",
  ],
  GENERIC: [
    "Piyasada net bir yön yok.",
    "Genel tablo kararsız.",
    "Yön için erken.",
  ],
};

// =============================
// VADE KELİMELERİ
// =============================
const SHORT_WORDS = [
  "Kısa vadede sert dalgalar mümkün.",
  "Günlük hareketler yanıltıcı olabilir.",
  "Kısa vadede stop önemli.",
];

const LONG_WORDS = [
  "Uzun vadede ana trend daha belirleyici.",
  "Uzun vadede sabır kazandırır.",
  "Büyük resim kısa dalgalardan önemli.",
];

// =============================
// SİNYAL + GÜVEN
// =============================
const SIGNAL_TONE = {
  STRONG: {
    AL: [
      "Bu seviyeler net şekilde alımı destekliyor.",
      "Risk iştahı olanlar için güçlü bir alım alanı.",
    ],
    SAT: [
      "Bu seviyeler net biçimde satış bölgesi.",
      "Buradan devam etmek riskli, satış öne çıkıyor.",
    ],
    BEKLE: [
      "Piyasa kararsız ama güçlü sinyal yok, beklemek en doğrusu.",
    ],
  },
  NORMAL: {
    AL: [
      "Alım tarafı şu an daha mantıklı.",
      "Kademeli alım düşünenler için uygun.",
    ],
    SAT: [
      "Satış tarafı biraz daha ağır basıyor.",
      "Yukarı hareketler satış fırsatı olabilir.",
    ],
    BEKLE: ["Biraz daha izlemek daha sağlıklı."],
  },
  SOFT: {
    AL: [
      "Alım düşünenler temkinli ilerlemeli.",
      "Acele etmeden alım planlanabilir.",
    ],
    SAT: [
      "Risk almamak adına satış düşünülebilir.",
      "Kârı korumak mantıklı olabilir.",
    ],
    BEKLE: ["Şartlar netleşmeden hamle yapmak erken."],
  },
};

// =============================
// CEVAP
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const mem = getSession(body.sessionId || "x");

  if (msg.includes("kısa")) mem.horizon = "SHORT";
  if (msg.includes("uzun")) mem.horizon = "LONG";

  if (!mem.horizon && !mem.askedHorizon) {
    mem.askedHorizon = true;
    return "Kısa vadeli mi bakalım, uzun vadeden mi konuşalım?";
  }

  const inst = detectInstrument(msg);
  const macro = macroScore(msg);
  const weekly = body.weeklyPct || 0;
  const monthly = body.monthlyPct || 0;

  const signal = decide(weekly, monthly, macro);
  const conf = clamp(55 + macro * 10, 55, 85);

  const tone =
    conf >= 75 ? "STRONG" : conf >= 60 ? "NORMAL" : "SOFT";

  const used = new Set();
  let r = "🧠 Genel tablo:\n";
  r += "• " + pick(WORDS[inst] || WORDS.GENERIC, used) + "\n";
  r += "• " + pick(WORDS[inst] || WORDS.GENERIC, used) + "\n";

  if (mem.horizon === "SHORT")
    r += "• " + pick(SHORT_WORDS, used) + "\n\n";

  if (mem.horizon === "LONG")
    r += "• " + pick(LONG_WORDS, used) + "\n\n";

  r += "📌 Değerlendirme:\n";
  r += "• " + pick(SIGNAL_TONE[tone][signal], used) + "\n\n";
  r += `Sonuç: ${signal} (Güven: %${conf})`;

  return r;
}

// =============================
app.post("/finans-uzmani", (req, res) => {
  res.json({ reply: buildReply(req.body) });
});

// =============================
// /translate — GOOGLE (KEYSİZ)
// =============================
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
  } catch {
    res.json({ translated: req.body.text });
  }
});

// =============================
// /haberler — RSS + TÜRKÇE
// =============================
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
        block.match(
          /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/
        )?.[1] || "";
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

      const tUrl =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx&sl=en&tl=tr&dt=t&q=" +
        encodeURIComponent(n.title);

      const tRes = await fetch(tUrl);
      const tJson = await tRes.json();
      const trTitle = tJson[0].map((x) => x[0]).join("");

      let trContent = n.content;
      if (n.content) {
        const cUrl =
          "https://translate.googleapis.com/translate_a/single" +
          "?client=gtx&sl=en&tl=tr&dt=t&q=" +
          encodeURIComponent(n.content);
        const cRes = await fetch(cUrl);
        const cJson = await cRes.json();
        trContent = cJson[0].map((x) => x[0]).join("");
      }

      out.push({ ...n, title: trTitle, content: trContent });
    }

    res.json(out);
  } catch (e) {
    console.error("HABERLER HATA:", e);
    res.json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Çalışıyor:", PORT));
