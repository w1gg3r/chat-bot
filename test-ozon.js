// test-ozon.js
require('dotenv').config();
const axios = require('axios');

async function fetchOzonOrders() {
  try {
    const response = await axios.post(
      'https://api-seller.ozon.ru/v2/posting/fbs/list',
      {
        // Передаем параметры в теле запроса:
        dir: 'asc',
        limit: 10,
        offset: 0
      },
      {
        headers: {
          'Client-Id': process.env.OZON_CLIENT_ID,
          'Api-Key': process.env.OZON_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Ошибка получения заказов из Ozon:', error.message);
    return null;
  }
}

fetchOzonOrders().then(data => {
  console.log('Полученные данные с Ozon API:', data);
});
