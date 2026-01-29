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
  (sessions[id] ||= {
    horizon: null,
    askedHorizon: false,
    proNotified: false
  });

// =============================
// UTIL
// =============================
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pick = (arr, used) => {
  const pool = arr.filter((x) => !used.has(x));
  const sel = (pool.length ? pool : arr)[
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
    "Dolar cephesinde temkinli hava sürüyor.",
    "Kurda yukarı aşağı küçük yoklamalar var.",
    "Dolar tarafı habere duyarlı ilerliyor.",
    "Kurda ani kopuş için güçlü sinyal yok.",
    "Dolar yatırımcısı frene basmış durumda.",
    "Kurda acele eden genelde üzülür.",
    "Dolar tarafında sabırlı olmak gerekiyor."
  ],
  EUR: [
    "Euro tarafı dalgalı seyrediyor.",
    "Euro net bir yön ortaya koyamadı.",
    "Parite baskısı euroyu sınırlıyor.",
    "Euro cephesinde kararsızlık var.",
    "Euro ani kopuş için henüz zayıf.",
    "Euro tarafı dolar karşısında zorlanıyor.",
    "Euro yatırımcısı için ortam net değil.",
    "Euro tarafında iniş çıkışlar normal.",
    "Euro şu ara güven vermekte zorlanıyor."
  ],
  ALTIN: [
    "Altın güvenli liman refleksi veriyor.",
    "Altın haber akışına oldukça duyarlı.",
    "Altın yatırımcısı aceleci olmamalı.",
    "Altın uzun soluklu düşüneni sever.",
    "Altında geri çekilmeler moral bozmamalı.",
    "Altın tarafında panik yapan kaybeder.",
    "Altın uzun vadede kendini toplar.",
    "Altın her zaman sabrı ödüllendirmez ama çoğu zaman eder."
  ],
  GRAM: [
    "Gram altın ons ve kur arasında sıkışmış durumda.",
    "Gram tarafı yön bulmakta zorlanıyor.",
    "Gramda geri çekilmeler normal.",
    "Gram altın biraz nazlı ilerliyor.",
    "Gram tarafı sabır testi yapıyor.",
    "Gramda kısa vadeli heyecan riskli.",
    "Gram uzun vadede yüz güldürür."
  ],
  ONS: [
    "Ons altın küresel haberlerle yön buluyor.",
    "Ons tarafı sürprize açık.",
    "Ons altında yön bir günde değişebilir.",
    "Ons tarafında teknik seviyeler önemli.",
    "Ons yatırımcısı haberi iyi okumalı."
  ],
  GUMUS: [
    "Gümüş sert hareket etmeyi sever.",
    "Gümüş altına göre daha oynak.",
    "Gümüş sabırsızı zorlar.",
    "Gümüşte ani sıçramalar şaşırtmaz.",
    "Gümüşte risk yüksek ama getiri de öyle.",
    "Gümüş yatırımcısı midesine güvenmeli."
  ],
  GENERIC: [
    "Piyasada net bir yön yok.",
    "Genel tablo kararsız.",
    "Yön için erken.",
    "Piyasa biraz kafa karışık.",
    "Bekle-gör havası hakim.",
    "Herkes temkinli ilerliyor."
  ]
};

// =============================
// VADE
// =============================
const SHORT_WORDS = [
  "Kısa vadede sert dalgalar mümkün.",
  "Günlük hareketler yanıltıcı olabilir.",
  "Kısa vadede stop önemli.",
  "Kısa vadede panik zarar yazar.",
  "Günlük işlemler dikkat ister.",
  "Kısa vade hata affetmez.",
  "Bugün alınan karar yarın pişman edebilir."
];

const LONG_WORDS = [
  "Uzun vadede ana trend daha belirleyici.",
  "Uzun vadede sabır kazandırır.",
  "Büyük resim kısa dalgalardan önemli.",
  "Uzun vadede gürültüye kulak asmamak lazım.",
  "Zaman genelde sabırlının lehine işler.",
  "Uzun vadede stres daha azdır.",
  "Uzun soluklu bakan genelde kazanır."
];

// =============================
// SİNYAL
// =============================
const SIGNAL_TONE = {
  STRONG: {
    AL: [
      "Bu seviyeler net şekilde alımı destekliyor.",
      "Risk iştahı olanlar için güçlü bir alım alanı.",
      "Buradan alım tarafı daha baskın duruyor.",
      "Bu bölgeler uzun süre görülmeyebilir."
    ],
    SAT: [
      "Bu seviyeler net biçimde satış bölgesi.",
      "Buradan devam etmek riskli, satış öne çıkıyor.",
      "Kârı cebe koymak akıllıca olabilir.",
      "Daha yukarı için şartlar zayıf."
    ],
    BEKLE: [
      "Piyasa kararsız ama güçlü sinyal yok, beklemek en doğrusu.",
      "Aceleden uzak durmak en sağlıklısı."
    ]
  },
  NORMAL: {
    AL: [
      "Alım tarafı şu an daha mantıklı.",
      "Kademeli alım düşünenler için uygun.",
      "Alım tarafı biraz daha ağır basıyor."
    ],
    SAT: [
      "Satış tarafı biraz daha ağır basıyor.",
      "Yukarı hareketler satış fırsatı olabilir.",
      "Risk azaltmak isteyenler için satış mantıklı."
    ],
    BEKLE: [
      "Biraz daha izlemek daha sağlıklı.",
      "Netleşme için zaman lazım."
    ]
  },
  SOFT: {
    AL: [
      "Alım düşünenler temkinli ilerlemeli.",
      "Acele etmeden alım planlanabilir.",
      "Ufak ufak alım denenebilir."
    ],
    SAT: [
      "Risk almamak adına satış düşünülebilir.",
      "Kârı korumak mantıklı olabilir.",
      "Bir miktar azaltmak huzur verebilir."
    ],
    BEKLE: [
      "Şartlar netleşmeden hamle yapmak erken.",
      "Bir süre kenarda durmak zarar vermez."
    ]
  }
};

// =============================
// CEVAP  🔴 SADECE BURASI DÜZELTİLDİ
// =============================
function buildReply(body) {
  const msg = (body.message || "").toLowerCase();
  const professionalMode = body.professionalMode === true;
  const mem = getSession(body.sessionId || "x");

  // 🔥 PROFESYONEL MOD
  if (professionalMode) {
    // 1️⃣ İlk açılış bildirimi (SADECE 1 KERE)
    if (!mem.proNotified) {
      mem.proNotified = true;
      return "⚠️ Profesyonel mod aktif.\nSorularınız uzman düzeyinde yanıtlanacaktır. Günde 1 defa soru sorma hakkınız bulunmaktadır.";
}.";
    }

    // 2️⃣ Sonraki tüm sorular = ChatGPT cevabı
    return body.manualReply || body.reply || "Cevap alınamadı.";
  }

  // =============================
  // NORMAL MOD (HİÇ DOKUNULMADI)
  // =============================
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
  const tone = conf >= 75 ? "STRONG" : conf >= 60 ? "NORMAL" : "SOFT";

  const used = new Set();
  let r = "🧠 Genel tablo:\n";
  r += "• " + pick(WORDS[inst] || WORDS.GENERIC, used) + "\n";
  r += "• " + pick(WORDS[inst] || WORDS.GENERIC, used) + "\n";

  if (mem.horizon === "SHORT") r += "• " + pick(SHORT_WORDS, used) + "\n\n";
  if (mem.horizon === "LONG") r += "• " + pick(LONG_WORDS, used) + "\n\n";

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Çalışıyor:", PORT));
