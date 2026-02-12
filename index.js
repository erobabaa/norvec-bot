const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

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
      "https://arbeidsplassen.nav.no/stillinger?q=kokk";

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const ilanlar = [];

    $("a[href*='/stillinger/stilling/']").each((i, el) => {
      const baslik = $(el).text().trim();
      const link =
        "https://arbeidsplassen.nav.no" + $(el).attr("href");

      if (baslik && baslik.length > 5) {
        ilanlar.push({ baslik, link });
      }
    });

    res.json(ilanlar.slice(0, 10));
  } catch (err) {
    console.log("SCRAPE HATA:", err.message);
    res.json([]);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Bot çalışıyor " + PORT);
});