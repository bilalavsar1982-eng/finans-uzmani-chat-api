const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Finans Uzmanı API Çalışıyor");
});

app.post("/finans-uzmani", (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Mesaj boş" });
  }

  res.json({
    reply:
      "Bu demo cevaptır. Finans Uzmanı aktif. Mesajınız: " + message
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server çalışıyor, port:", PORT);
});
