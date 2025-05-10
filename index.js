require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cron = require('node-cron');

// ====================
// Инициализация Express-сервера для вебхука Ozon
// ====================
const app = express();
app.use(express.json());

// Endpoint для приёма уведомлений о заказах от Ozon
app.post('/webhook/ozon', (req, res) => {
  // Здесь ожидается, что Ozon отправляет JSON с данными заказа
  const orderData = req.body;
  console.log('Получено уведомление от Ozon:', orderData);

  // Пример: извлекаем некоторые данные из заказа.
  // (В реальном случае структура orderData определяется документацией Ozon)
  const orderId = orderData.order_id || 'Не указан';
  const buyerName = orderData?.buyer?.name || 'Не указан';
  const itemsCount = orderData?.items ? orderData.items.length : 0;

  // Формируем сообщение для администратора Telegram
  const message =
    `Новый заказ с Ozon:\n` +
    `Order_ID: ${orderId}\n` +
    `Покупатель: ${buyerName}\n` +
    `Количество товаров: ${itemsCount}`;

  // Сохраняем заказ в базу (если требуется) или обрабатываем его другим способом...
  // Пример сохранения в SQLite (если структура заказа подходит под таблицу orders)
  // Здесь можно адаптировать поля под полученные данные.
  db.run(
    `INSERT INTO orders (user_id, side_one, side_two, status) VALUES (?, ?, ?, 'ozon')`,
    [0, `OZON Order: ${orderId}`, `Buyer: ${buyerName}\nItems: ${itemsCount}`],
    function (err) {
      if (err) {
        console.error('❌ Ошибка сохранения заказа из Ozon:', err.message);
      }
    }
  );

  // Отправляем уведомление в Telegram админу
  bot.telegram
    .sendMessage(process.env.ADMIN_CHAT_ID, message)
    .catch((error) => console.error('❌ Ошибка отправки уведомления администратору:', error.message));

  // Отправляем ответ Ozon, чтобы подтвердить получение
  res.status(200).send('OK');
});

// Запуск HTTP-сервера для вебхука
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HTTP-сервер запущен и слушает порт ${PORT}`);
});

// ====================
// Инициализация Telegram-бота и БД
// ====================

// Инициализация телеграм-бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к базе SQLite (файл создаётся, если отсутствует)
const db = new sqlite3.Database('./bot_orders.db', (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к базе SQLite:', err.message);
  } else {
    console.log('✅ База данных SQLite подключена!');
  }
});

// Создание таблицы orders (с доп. полем, например, status = 'ozon' для заказов с Ozon)
db.run(
  `
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    side_one TEXT,
    side_two TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`,
  (err) => {
    if (err) {
      console.error('❌ Ошибка создания таблицы orders:', err.message);
    }
  }
);

// Временное состояние для оформления заказа через Telegram
const orderState = {};

// Команда /start
bot.start((ctx) => {
  ctx.reply(
    `Привет, ${ctx.from.first_name}! Я бот для приёма заказов и интеграции с Ozon API.
    
Команды:
• /order – оформить заказ через Telegram.
• /faq – часто задаваемые вопросы.
• /history – последние заказы.
• /ozonorders – ручной запрос к Ozon (админ).
    `
  );
});

// Команда /order для оформления заказа через Telegram
bot.command('order', (ctx) => {
  const userId = ctx.message.from.id;
  orderState[userId] = { stage: 'side_one' };
  ctx.reply('Введите, пожалуйста, что вы хотите видеть на ЛИЦЕ (первая сторона):');
});

// Универсальный обработчик текстовых сообщений для оформления заказа
bot.on('text', (ctx, next) => {
  // Если сообщение начинается с "/" – пропускаем, чтобы команды работали корректно
  if (ctx.message.text.startsWith('/')) {
    return next();
  }
  const userId = ctx.message.from.id;
  if (!orderState[userId]) return next();

  if (orderState[userId].stage === 'side_one') {
    orderState[userId].side_one = ctx.message.text;
    orderState[userId].stage = 'side_two';
    ctx.reply('Введите, пожалуйста, что вы хотите видеть на ОБОРОТЕ (вторая сторона):');
  } else if (orderState[userId].stage === 'side_two') {
    orderState[userId].side_two = ctx.message.text;
    const firstSide = orderState[userId].side_one;
    const secondSide = orderState[userId].side_two;
    const sql = `INSERT INTO orders (user_id, side_one, side_two, status) VALUES (?, ?, ?, 'pending')`;
    db.run(sql, [userId, firstSide, secondSide], function (err) {
      if (err) {
        console.error('❌ Ошибка при сохранении заказа:', err.message);
        ctx.reply('❌ Произошла ошибка при оформлении заказа. Попробуйте повторить позже.');
      } else {
        ctx.reply('✅ Ваш заказ принят!');
        const orderInfo =
          `Новый заказ от ${ctx.from.username || ctx.from.first_name} (ID: ${userId}):\n` +
          `Лице: ${firstSide}\n` +
          `Оборот: ${secondSide}`;
        if (process.env.ADMIN_CHAT_ID) {
          bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, orderInfo)
            .catch((error) => console.error('❌ Ошибка отправки уведомления администратору:', error.message));
        }
      }
      delete orderState[userId];
    });
  }
});

// Другие команды, например, /faq, /history, /ozonorders и пр.
bot.command('faq', (ctx) => {
  ctx.reply(
    `📌 FAQ:
1. Как сделать заказ? – Используйте /order.
2. Как проверить статус заказа? – Функция в разработке.
3. По вопросам – пишите в поддержку.`
  );
});

bot.command('history', (ctx) => {
  const senderId = ctx.from.id.toString();
  if (
    senderId !== process.env.ADMIN_CHAT_ID &&
    String(ctx.chat.id) !== process.env.ADMIN_CHAT_ID
  ) {
    return ctx.reply('Эта команда доступна только администратору.');
  }
  const sql = `SELECT * FROM orders ORDER BY created_at DESC LIMIT 10`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('❌ Ошибка при получении истории заказов:', err.message);
      return ctx.reply('Не удалось получить историю заказов.');
    }
    if (rows.length === 0) {
      return ctx.reply('Заказов пока нет.');
    }
    let historyMsg = '🗂 Последние 10 заказов:\n';
    rows.forEach((order) => {
      historyMsg += `ID: ${order.id}, Пользователь: ${order.user_id}, Лице: ${order.side_one}, Оборот: ${order.side_two}, Статус: ${order.status}, ${order.created_at}\n\n`;
    });
    ctx.reply(historyMsg);
  });
});

// Пример периодического опроса Ozon API (polling) – если вебхук не используется
cron.schedule('*/5 * * * *', async () => {
  console.log('Периодическая проверка заказов с Ozon...');
  try {
    // Здесь вы можете реализовать логику опроса заказов с Ozon,
    // например, с помощью метода получения заказов.
    // Если обнаружены новые заказы – обрабатывайте их так же, как вебхук.
    // Пример:
    // const ozonOrders = await fetchOzonOrders();
    // if (ozonOrders && ozonOrders.new_orders && ozonOrders.new_orders.length > 0) { ... }
    console.log('Проверка завершена.');
  } catch (err) {
    console.error('Ошибка в периодической проверке:', err.message);
  }
});

// Запуск Telegram-бота
bot.launch()
  .then(() => {
    console.log('✅ Telegram-бот успешно запущен!');
  })
  .catch((err) => {
    console.error('❌ Ошибка запуска Telegram-бота:', err);
  });

// Корректное завершение работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
