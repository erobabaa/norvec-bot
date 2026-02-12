const express = require("express");
const axios = require("axios");

const app = express();

app.get("/", (req, res) => {
  res.send("Norveç Bot Çalışıyor");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/is-ilanlari", async (req, res) => {
  try {
    const url =
      "https://arbeidsplassen.nav.no/public-feed/api/v1/ads?size=10&q=kokk";

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      timeout: 15000,
    });

    const data = response.data || {};
    const list = data.content || [];

    const ilanlar = list.map((ad) => ({
      baslik: ad.heading || "Başlık Yok",
      firma: ad.employer?.name || "Bilinmiyor",
      sehir: ad.locationList?.[0]?.city || "Belirtilmemiş",
      link:
        "https://arbeidsplassen.nav.no/stillinger/stilling/" +
        (ad.uuid || ""),
    }));

    res.json(ilanlar);
  } catch (err) {
    console.log("API HATA:", err.message);
    res.json([]); // HATA YAZMAZ ARTIK
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Bot çalışıyor " + PORT);
});