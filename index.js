const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Finans Uzmanı API aktif");
});

// 🔹 SAHTE AMA GERÇEKÇİ TREND VERİSİ
function getMarketState(code) {
  const mock = {
    HASTRY: { trend: "up", risk: "orta" },     // Gram
    USDTRY: { trend: "up", risk: "yüksek" },   // Dolar
    EURTRY: { trend: "flat", risk: "orta" },
    ONS: { trend: "down", risk: "orta" }
  };
  return mock[code] || { trend: "flat", risk: "orta" };
}

// 🔹 KARAR MOTORU
function buildExpertAnswer(message, code) {
  const market = getMarketState(code);

  let karar = "BEKLE";
  let yorum = "";

  if (market.trend === "up" && market.risk !== "yüksek") {
    karar = "AL";
    yorum = "Yukarı yönlü eğilim korunuyor.";
  }

  if (market.trend === "down") {
    karar = "SAT";
    yorum = "Aşağı yönlü baskı devam ediyor.";
  }

  if (market.risk === "yüksek") {
    karar = "BEKLE";
    yorum = "Volatilite yüksek, temkinli olunmalı.";
  }

  return `
${yorum}

Kısa vadeli görünüm: ${market.trend.toUpperCase()}
Risk seviyesi: ${market.risk}

KARAR: ${karar}

Not: Bu değerlendirme yatırım tavsiyesi değildir.
  `.trim();
}

// 🔹 CHAT ENDPOINT
app.post("/finans-uzmani", (req, res) => {
  const { mesaj, code } = req.body;

  if (!mesaj) {
    return res.status(400).json({ error: "Mesaj boş" });
  }

  const reply = buildExpertAnswer(mesaj, code);
  res.json({ reply });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
