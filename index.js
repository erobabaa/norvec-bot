const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();

app.get("/", (req, res) => {
  res.send("Norveç Bot Çalışıyor");
});

app.get("/is-ilanlari", async (req, res) => {
  try {
    const url = "https://arbeidsplassen.nav.no/stillinger?q=kokk&v=5";

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const $ = cheerio.load(data);
    const ilanlar = [];

    $(".ads__unit").each((i, el) => {
      const baslik = $(el).find("h2").text().trim();
      const firma = $(el).find(".ads__unit__employer").text().trim();
      const link = "https://arbeidsplassen.nav.no" + $(el).find("a").attr("href");

      if (baslik) {
        ilanlar.push({
          baslik,
          firma,
          link
        });
      }
    });

    res.json(ilanlar.slice(0, 10));
  } catch (err) {
    console.log(err);
    res.send("Hata Oluştu");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot çalışıyor " + PORT);
});