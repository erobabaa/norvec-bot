const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

const app = express();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;       // Railway Variables'a ekle
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;   // Railway Variables'a ekle
const SEARCH_URL = "https://arbeidsplassen.nav.no/stillinger?q=kokk";
const MAX_PAGES = Number(process.env.MAX_PAGES || 5);    // tüm sayfalar çok olursa artır: 10, 20 vs.
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */1 * * *"; // 1 saatte bir (cron)

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN, { polling: true }) : null;

// Runtime cache (Railway restart olursa sıfırlanır)
const seenJobLinks = new Set();
let lastRunSummary = { checked: 0, newSent: 0, pages: 0, lastRunAt: null };

app.get("/", (req, res) => res.send("Norveç Bot Çalışıyor"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

function normalizeText(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

// Dil + Konaklama analizi (EN + NO)
function analyzeJobText(rawText) {
  const t = normalizeText(rawText);

  // İngilizce mümkün/var göstergeleri
  const englishHints = [
    "english",
    "engelsk",
    "english required",
    "engelsk språk",
    "arbeidsspråk engelsk",
    "work language english",
    "kommunikasjon på engelsk",
    "english speaking",
    "fluent in english",
    "international environment",
    "good english",
  ];

  // Norveççe zorunlu/isteniyor göstergeleri
  const norwegianRequiredHints = [
    "norsk",
    "må snakke norsk",
    "maa snakke norsk", // bazen özel karakter düşer
    "flytende norsk",
    "norsk språk",
    "norsk muntlig og skriftlig",
    "gode norskkunnskaper",
    "norsk er et krav",
    "krever norsk",
    "norwegian required",
  ];

  // Konaklama VAR
  const accommodationYes = [
    // EN
    "accommodation",
    "accommodation provided",
    "housing provided",
    "staff housing",
    "room included",
    "we offer accommodation",
    "lodging",
    // NO
    "bolig",
    "bolig tilbys",
    "vi tilbyr bolig",
    "bolig inkludert",
    "personalbolig",
    "hybel",
    "hybel tilbys",
    "overnatting",
    "bosted",
  ];

  // Konaklama YOK (negatif ifadeler daha güçlü)
  const accommodationNo = [
    // EN
    "no accommodation",
    "accommodation not included",
    "must arrange housing yourself",
    // NO
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

// Sayfadaki ilan linklerini topla (benzersiz)
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

// Bir sonraki sayfa linkini bul (varsa)
function extractNextPageUrl(html) {
  const $ = cheerio.load(html);

  // rel="next" varsa en iyisi
  const relNext = $("a[rel='next']").attr("href");
  if (relNext) {
    return relNext.startsWith("http")
      ? relNext
      : "https://arbeidsplassen.nav.no" + relNext;
  }

  // fallback: "Neste" gibi butonlar
  const nextByText = $("a")
    .filter((_, el) => normalizeText($(el).text()) === "neste")
    .first()
    .attr("href");
  if (nextByText) {
    return nextByText.startsWith("http")
      ? nextByText
      : "https://arbeidsplassen.nav.no" + nextByText;
  }

  return null;
}

async function analyzeJobDetail(jobUrl) {
  const html = await fetchHtml(jobUrl);
  const $ = cheerio.load(html);

  // Başlık
  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "Başlık Yok";

  // Tüm sayfa metni (analiz için)
  const bodyText = $("body").text();
  const { dil, konaklama } = analyzeJobText(bodyText);

  return { title, dil, konaklama, link: jobUrl };
}

async function sendTelegramMessage(text) {
  if (!bot) return;
  if (!TELEGRAM_CHAT_ID) return;
  await bot.sendMessage(TELEGRAM_CHAT_ID, text);
}

async function crawlAllKokkJobsAndNotify({ onlyNew = true } = {}) {
  let pageUrl = SEARCH_URL;
  let pages = 0;
  let checked = 0;
  let newSent = 0;

  const discovered = new Set();

  while (pageUrl && pages < MAX_PAGES) {
    pages += 1;
    const html = await fetchHtml(pageUrl);
    const links = extractJobLinksFromListPage(html);

    for (const link of links) discovered.add(link);

    // next
    pageUrl = extractNextPageUrl(html);

    // Eğer next yoksa çık
    if (!pageUrl) break;
  }

  const allLinks = Array.from(discovered);
  // Çok ilan varsa patlamasın diye güvenlik limiti (istersen yükselt)
  const HARD_LIMIT = Number(process.env.HARD_LIMIT || 120);
  const targetLinks = allLinks.slice(0, HARD_LIMIT);

  for (const link of targetLinks) {
    checked += 1;

    if (onlyNew && seenJobLinks.has(link)) continue;

    try {
      const info = await analyzeJobDetail(link);

      const msg =
        `🍳 ${info.title}\n` +
        `Dil: ${info.dil}\n` +
        `Konaklama: ${info.konaklama}\n` +
        `${info.link}`;

      await sendTelegramMessage(msg);

      seenJobLinks.add(link);
      newSent += 1;
    } catch (e) {
      // Detay sayfa hatası olursa geç
      // console.log("Detay hata:", link, e.message);
    }
  }

  lastRunSummary = {
    checked,
    newSent,
    pages,
    lastRunAt: new Date().toISOString(),
  };

  return lastRunSummary;
}

/* Telegram Komutları */
if (bot) {
  bot.on("message", async (msg) => {
    const chatId = String(msg.chat.id);
    const text = (msg.text || "").trim();

    // sadece belirlediğin chat’e izin ver (isteğe bağlı ama güvenlik için iyi)
    if (TELEGRAM_CHAT_ID && chatId !== String(TELEGRAM_CHAT_ID)) return;

    if (text === "/start") {
      bot.sendMessage(chatId, "Bot aktif ✅\n/tara ile taratabilirsin\n/durum ile kontrol edebilirsin");
    }

    if (text === "/durum") {
      const s = lastRunSummary;
      bot.sendMessage(
        chatId,
        `Durum ✅\nSon tarama: ${s.lastRunAt || "yok"}\nSayfa: ${s.pages}\nKontrol: ${s.checked}\nYeni gönderilen: ${s.newSent}\nCache: ${seenJobLinks.size}`
      );
    }

    if (text === "/tara") {
      bot.sendMessage(chatId, "Taramaya başlıyorum…");
      const s = await crawlAllKokkJobsAndNotify({ onlyNew: true });
      bot.sendMessage(chatId, `Bitti ✅\nSayfa: ${s.pages}\nKontrol: ${s.checked}\nYeni: ${s.newSent}`);
    }
  });
}

/* Otomatik Tarama (Railway’de sürekli çalışır) */
cron.schedule(CRON_SCHEDULE, async () => {
  try {
    await crawlAllKokkJobsAndNotify({ onlyNew: true });
  } catch (e) {
    // sessiz geç
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Bot çalışıyor " + PORT);
});