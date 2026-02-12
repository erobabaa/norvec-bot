const TelegramBot = require('node-telegram-bot-api');

// Railway Variables kısmına TOKEN ekleyeceğiz
const token = process.env.TOKEN;

const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
    bot.sendMessage(chatId, 'Bot aktif 🚀');
  }

  if (text === '/durum') {
    bot.sendMessage(chatId, 'Sistem çalışıyor ✅');
  }

  if (text === '/tara') {
    bot.sendMessage(chatId, 'İlanlar taranıyor...');
    // burada ilan fonksiyonunu çağırabilirsin
  }
});

console.log("Bot başlatıldı...");