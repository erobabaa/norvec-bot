const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

const app = express();

const TOKEN = process.env.TOKEN;       // Railway: TOKEN
const CHAT_ID = process.env.CHAT_ID;   // Railway: CHAT_ID

if (!TOKEN) console.log("HATA: TOKEN env yok");
if (!CHAT_ID) console.log("HATA: CHAT_ID env yok");

const bot = TOKEN ? new TelegramBot(TOKEN, { polling: true }) : null;

const SEARCH_URL = "https://arbeidsplassen.nav.no/stillinger?q=kokk";
const MAX_PAGES = Number(process.env.MAX_PAGES || 5);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "*/30 * * * *"; // 30 dk

const seen = new Set();

app.get("/", (req, res) => res.send("Norveç Bot Çalışıyor"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

function normalizeText(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function includesAny(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

function analyzeJobText(rawText) {
  const t = normalizeText(rawText);

  const englishHints = [
    "english",
    "engelsk",
    "english speaking",
    "fluent in english",
    "work language english",
    "arbeidsspråk engelsk",
    "kommunikasjon på engelsk",
  ];

  const norwegianRequiredHints = [
    "må snakke norsk",
    "maa snakke norsk",
    "flytende norsk",
    "norsk språk",
    "norsk muntlig og skriftlig",
    "gode norskkunnskaper",
    "norwegian required",
  ];

  const accommodationYes = [
    "accommodation",
    "housing provided",
    "staff housing",
    "room included",
    "bolig tilbys",
    "vi tilbyr bolig",
    "bolig inkludert",
    "personalbolig",
    "hybel",
    "hybel tilbys",
    "overnatting",
  ];

  const accommodationNo = [
    "no accommodation",
    "accommodation not included",
    "ingen bolig",
    "bolig ikke inkludert",
    "må ordne bolig selv",
    "maa ordne bolig selv",
    "ordne bolig selv",
  ];

  const hasEnglish = includesAny(t, englishHints);
  const needsNorwegian = includesAny(t, norwegianRequiredHints);

  let dil = "Belirsiz";
  if (needsNorwegian && hasEnglish) dil = "Norveççe + İngilizce";
  else if (needsNorwegian) dil = "Norveççe Zorunlu";
  else if (hasEnglish) dil = "İngilizce Uygun";

  let konaklama = "Belirsiz";
  if (includesAny(t, accommodationNo)) konaklama = "Yok";
  else if (includesAny(t, accommodationYes)) konaklama = "Var";

  return { dil, konaklama };
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    timeout: 20000,
  });
  return data;
}

function extractJobLinksFromListPage(html) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href*='/stillinger/stilling/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const full = href.startsWith("http")
      ? href
      : "https://arbeidsplassen.nav.no" + href;
    links.add(full);
  });

  return Array.from(links);
}

function extractNextPageUrl(html) {
  const $ = cheerio.load(html);
  const relNext = $("a[rel='next']").attr("href");
  if (relNext) {
    return relNext.startsWith("http")
      ? relNext
      : "https://arbeidsplassen.nav.no" + relNext;
  }
  return null;
}

async function analyzeJobDetail(jobUrl) {
  const html = await fetchHtml(jobUrl);
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "Başlık Yok";

  const bodyText = $("body").text();
  const { dil, konaklama } = analyzeJobText(bodyText);

  return { title, dil, konaklama, link: jobUrl };
}

async function sendMsg(text) {
  if (!bot) return;
  if (!CHAT_ID) return;
  await bot.sendMessage(CHAT_ID, text);
}

async function crawlAndNotify({ onlyNew = true } = {}) {
  let pageUrl = SEARCH_URL;
  let pages = 0;

  const discovered = new Set();

  while (pageUrl && pages < MAX_PAGES) {
    pages += 1;
    const html = await fetchHtml(pageUrl);
    const links = extractJobLinksFromListPage(html);
    links.forEach((l) => discovered.add(l));
    pageUrl = extractNextPageUrl(html);
    if (!pageUrl) break;
  }

  const allLinks = Array.from(discovered);

  for (const link of allLinks) {
    if (onlyNew && seen.has(link)) continue;

    try {
      const info = await analyzeJobDetail(link);
      const msg =
        `🍳 ${info.title}\n` +
        `Dil: ${info.dil}\n` +
        `Konaklama: ${info.konaklama}\n` +
        `${info.link}`;

      await sendMsg(msg);
      seen.add(link);
    } catch {}
  }
}

if (bot) {
  bot.onText(/\/start/, async (msg) => {
    if (String(msg.chat.id) !== String(CHAT_ID)) return;
    bot.sendMessage(CHAT_ID, "Bot aktif ✅\n/tara\n/durum");
  });

  bot.onText(/\/tara/, async (msg) => {
    if (String(msg.chat.id) !== String(CHAT_ID)) return;
    bot.sendMessage(CHAT_ID, "Tarama başladı…");
    await crawlAndNotify({ onlyNew: true });
    bot.sendMessage(CHAT_ID, "Bitti ✅");
  });

  bot.onText(/\/durum/, async (msg) => {
    if (String(msg.chat.id) !== String(CHAT_ID)) return;
    bot.sendMessage(CHAT_ID, `Cache: ${seen.size}`);
  });
}

/* Otomatik tarama */
cron.schedule(CRON_SCHEDULE, async () => {
  try {
    await crawlAndNotify({ onlyNew: true });
  } catch {}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Bot çalışıyor " + PORT));