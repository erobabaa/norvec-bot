const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", async (req, res) => {
  try {
    const response = await axios.get(
      "https://arbeidsplassen.nav.no/public-feed/api/v1/ads?search=kokk"
    );

    const jobs = response.data.content.slice(0, 10).map(job => ({
      title: job.title,
      company: job.employer.name,
      location: job.location,
      link: job.link
    }));

    res.json(jobs);
  } catch (err) {
    res.send("Hata oluştu");
  }
});

app.listen(PORT, () => {
  console.log("Bot çalışıyor");
});