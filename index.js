const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------
// Deterministic seçim (aynı mesaj -> aynı cevap)
// -----------------------------
function hash32(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick(arr, seed) {
  if (!arr || arr.length === 0) return "";
  return arr[seed % arr.length];
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// -----------------------------
// Ürün/Konu tespiti (ister message ister code gelsin)
// -----------------------------
function detectTopic(message = "", code = "") {
  const t = (message || "").toUpperCase();
  const c = (code || "").toUpperCase();

  // code öncelikli
  if (c.includes("USD") || t.includes("DOLAR") || t.includes("USD")) return "USD";
  if (c.includes("EUR") || t.includes("EURO") || t.includes("EUR")) return "EUR";
  if (c.includes("ONS") || t.includes("ONS")) return "ONS";
  if (c.includes("GUMUS") || t.includes("GÜMÜŞ") || t.includes("GUMUS")) return "SILVER";
  if (t.includes("ALTIN") || t.includes("GRAM") || t.includes("ÇEYREK") || t.includes("CEYREK") || t.includes("YARIM") || t.includes("TAM") || t.includes("ATA") || t.includes("22")) return "GOLD";

  // genel
  return "GENERIC";
}

function detectIntent(message = "") {
  const t = (message || "").toLowerCase();

  // yön soruları
  if (t.includes("alınır mı") || t.includes("alinir mi") || t.includes("almalı") || t.includes("alalım") || t.includes("alım") || t.includes("buy")) {
    return "BUY_QUESTION";
  }
  if (t.includes("satılır mı") || t.includes("satilir mi") || t.includes("satmalı") || t.includes("satalım") || t.includes("satış") || t.includes("sell")) {
    return "SELL_QUESTION";
  }
  if (t.includes("bekle") || t.includes("tut") || t.includes("hold") || t.includes("ne yapayım") || t.includes("ne yapmalı")) {
    return "WHAT_TO_DO";
  }
  if (t.includes("neden") || t.includes("niye") || t.includes("sebep")) {
    return "WHY";
  }
  if (t.includes("kısa vade") || t.includes("kisa vade")) return "SHORT_TERM";
  if (t.includes("uzun vade")) return "LONG_TERM";

  return "GENERAL";
}

// -----------------------------
// Basit “piyasa sinyali” (tamamen rule-based)
// Not: Fiyat verisi gelmezse "bekle" ağırlıklı
// İstersen Android'ten changePct, trend, spread gibi alanlar yollayabilirsin.
// body örnek:
// { message:"gram alinir mi", code:"HASTRY", changePct:0.6, trend:"UP" }
// -----------------------------
function decideSignal(body, topic) {
  const msg = (body.message || "").toLowerCase();
  const changePct = typeof body.changePct === "number" ? body.changePct : null; // -100..+100
  const trend = (body.trend || "").toUpperCase(); // UP / DOWN / FLAT
  const volatility = typeof body.volatility === "number" ? body.volatility : null; // 0..?
  const risk = (body.risk || "").toUpperCase(); // LOW/MED/HIGH

  // Varsayılan: veri yoksa temkin
  let signal = "BEKLE";
  let confidence = 56;

  // Mesajdaki ifadeler etkisi
  if (msg.includes("acil") || msg.includes("hemen") || msg.includes("şimdi") || msg.includes("simdi")) {
    confidence -= 4;
  }
  if (msg.includes("kısa vade") || msg.includes("kisa vade")) {
    confidence -= 2;
  }
  if (msg.includes("uzun vade")) {
    confidence += 2;
  }

  // Fiyat/Trend gelirse karar keskinleşir
  if (changePct !== null) {
    if (changePct > 0.4) {
      signal = "AL";
      confidence += 8;
    } else if (changePct < -0.4) {
      signal = "SAT";
      confidence += 8;
    } else {
      signal = "BEKLE";
      confidence += 2;
    }
  }

  if (trend === "UP") {
    if (signal === "BEKLE") signal = "AL";
    confidence += 3;
  } else if (trend === "DOWN") {
    if (signal === "BEKLE") signal = "SAT";
    confidence += 3;
  }

  if (volatility !== null) {
    if (volatility > 2.0) confidence -= 4;
    if (volatility < 1.0) confidence += 2;
  }

  if (risk === "HIGH") confidence -= 6;
  if (risk === "LOW") confidence += 3;

  // Konuya göre ufak ayar
  if (topic === "GOLD" || topic === "ONS") confidence += 1;
  if (topic === "USD" || topic === "EUR") confidence += 0;

  confidence = clamp(confidence, 48, 78);
  return { signal, confidence };
}

// -----------------------------
// Cevap üretimi (insan gibi, ama kural tabanlı)
// -----------------------------
function buildReply(body) {
  const message = (body.message || "").trim();
  const code = (body.code || "").trim();

  const seed = hash32((message + "|" + code).toLowerCase());
  const topic = detectTopic(message, code);
  const intent = detectIntent(message);
  const { signal, confidence } = decideSignal(body, topic);

  const topicOpeners = {
    GOLD: [
      "Altın tarafında şu an en kritik nokta panik yerine planla ilerlemek.",
      "Altında hareket var ama karar için acele etmek doğru olmaz.",
      "Altın cephesinde kısa vadede dalgalanma normal; önemli olan seviyeyi yönetmek."
    ],
    ONS: [
      "Ons altın global tarafta veri akışına çok hassas.",
      "Ons tarafında hareketi belirleyen ana unsur dolar ve faiz beklentileri.",
      "Ons altın kararında haber akışı kadar yön teyidi de önemli."
    ],
    USD: [
      "Dolar/TL tarafında hareketler çoğu zaman hızlı olur; risk yönetimi şart.",
      "Kur tarafında tek hamle yerine parçalı plan daha sağlıklı.",
      "USD/TRY için en önemli konu, dalgalanmaya karşı disiplinli kalmak."
    ],
    EUR: [
      "Euro/TL tarafında hem EURUSD hem TL bacağı etkili; çift yönlü düşünmek gerekir.",
      "Euro kararında yön kadar zamanlama da önemlidir.",
      "EUR/TRY’de volatilite dönemlerinde temkinli olmak avantaj sağlar."
    ],
    SILVER: [
      "Gümüşte hareketler altına göre daha sert olabilir; marjı iyi hesapla.",
      "Gümüş tarafı fırsat da verir risk de; planlı gitmek şart.",
      "Gümüşte küçük dalga büyük etki yapabilir; acele karar istemez."
    ],
    GENERIC: [
      "Bu tip sorularda tek cümlelik cevap yerine kısa bir plan kurmak daha doğru.",
      "Net karar için birkaç kriteri birlikte değerlendirmek gerekir.",
      "Hızlı karar yerine kontrollü adım daha sağlıklı."
    ]
  };

  const decisionLines = {
    AL: [
      "Benim yaklaşımım: **AL yönü** daha mantıklı görünüyor.",
      "Şu an için **AL tarafı** daha avantajlı duruyor.",
      "Mevcut koşulda **AL** tarafı önde."
    ],
    SAT: [
      "Benim yaklaşımım: **SAT yönü** daha güvenli duruyor.",
      "Şu an için **SAT** tarafı daha mantıklı.",
      "Mevcut koşulda **SAT** tarafı önde."
    ],
    BEKLE: [
      "Benim yaklaşımım: **BEKLE** daha doğru.",
      "Şu an için **BEKLE** daha sağlıklı görünüyor.",
      "Mevcut koşulda **BEKLE-GÖR** daha mantıklı."
    ]
  };

  const whyBullets = {
    AL: [
      "Yukarı yönlü hareket ihtimali, aşağı riskten bir tık daha ağır basıyor.",
      "Trend/ivme desteği varsa alım tarafı güçlenir.",
      "Planlı alım (parçalı giriş) riski azaltır."
    ],
    SAT: [
      "Aşağı yönlü baskı sinyali varsa korunma önceliklidir.",
      "Hızlı geri çekilmelerde zarar büyümeden kontrol etmek gerekir.",
      "Parçalı çıkış, tek seferlik satıştan daha sağlıklıdır."
    ],
    BEKLE: [
      "Net yön teyidi zayıfsa işlem sayısı değil, kalite önemlidir.",
      "Kararsız bölgede al-sat yapmak gereksiz risk üretir.",
      "Bir onay daha gelmeden harekete geçmemek daha güvenli."
    ]
  };

  const nextQuestions = [
    "Kısa vade mi düşünüyorsun (1-7 gün) yoksa uzun vade mi?",
    "Elinde var mı yoksa yeni mi gireceksin?",
    "Kaç gün/hafta taşıma niyetin var?"
  ];

  const disclaimer = [
    "Not: Bu yorum yatırım tavsiyesi değildir, genel değerlendirmedir.",
    "Not: Bu değerlendirme yatırım tavsiyesi değildir; risk yönetimi sana aittir.",
    "Not: Yatırım tavsiyesi değildir; karar verirken kendi planını baz al."
  ];

  const opener = pick(topicOpeners[topic] || topicOpeners.GENERIC, seed);
  const decision = pick(decisionLines[signal], seed >>> 1);

  // “Kesine yakın” hissi için: güven yüzdesi + kısa plan
  const planLines = {
    AL: [
      "Ben olsam tek sefer yerine **2-3 parça** alım planlarım; geri çekilmede ortalama düşürmek kolaylaşır.",
      "Ben olsam **parçalı alım** yaparım; fiyat hızlanırsa son parçayı bırakırım.",
      "Ben olsam **kademeli giriş** yaparım; beklenmedik dalgada panik olmaz."
    ],
    SAT: [
      "Ben olsam **kademeli satış** yaparım; bir kısmını korumaya alıp kalanını izlerim.",
      "Ben olsam önce **riskli kısmı azaltırım**, sonra piyasa teyidine göre devam ederim.",
      "Ben olsam **zararı büyütmeden** pozisyonu hafifletirim; sonra tekrar değerlendirim."
    ],
    BEKLE: [
      "Ben olsam **yön teyidi** gelene kadar izlerim; acele işlem genelde pahalıya patlar.",
      "Ben olsam bir süre **beklerim**; netleşme gelince daha rahat karar verilir.",
      "Ben olsam **bekle-gör** yaparım; net sinyal gelmeden işlem açmam."
    ]
  };
  const plan = pick(planLines[signal], seed >>> 2);

  // Neden sorusu geldiyse daha gerekçeli cevap ver
  const bulletList = whyBullets[signal] || whyBullets.BEKLE;
  const b1 = pick(bulletList, seed >>> 3);
  const b2 = pick(bulletList, seed >>> 4);
  const b3 = pick(bulletList, seed >>> 5);

  // Ek soru (kullanıcıyı konuşturur)
  const q = pick(nextQuestions, seed >>> 6);

  const disc = pick(disclaimer, seed >>> 7);

  // Yanıt metni
  let reply = "";
  reply += `${opener}\n\n`;
  reply += `Kararım: **${signal}** (Güven: %${confidence})\n`;
  reply += `${decision}\n\n`;

  // Kullanıcının niyeti/sorusu
  if (intent === "WHY") {
    reply += `Bunu böyle düşünmemin 3 nedeni:\n`;
    reply += `• ${b1}\n`;
    reply += `• ${b2}\n`;
    reply += `• ${b3}\n\n`;
  } else {
    reply += `${plan}\n\n`;
  }

  reply += `${q}\n\n`;
  reply += `${disc}`;

  // İstersen Android tarafında karar yakalamak için (şimdilik sadece bilgi)
  // reply += `\n\nKARAR: ${signal}`;

  return reply;
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (req, res) => {
  res.send("Finans Uzmanı Chat API çalışıyor. POST /finans-uzmani kullan.");
});

// Tarayıcıdan girince "Cannot GET" görme diye ekledim
app.get("/finans-uzmani", (req, res) => {
  res.status(200).send("Bu endpoint POST ister. JSON body: {\"message\":\"...\"}");
});

app.post("/finans-uzmani", (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || String(message).trim().length === 0) {
      return res.status(400).json({ error: "Mesaj boş", reply: "Mesaj boş görünüyor. Ne için soruyorsun?" });
    }

    const reply = buildReply(req.body);

    // Android senin kodun bunu bekliyor: { reply: "..." }
    return res.json({ reply });
  } catch (e) {
    return res.status(500).json({
      error: "Sunucu hatası",
      reply: "Şu an kısa bir yoğunluk var. 10 saniye sonra tekrar dener misin?"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
