const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const readline = require('readline');
const FILTERS_FILE = path.join(__dirname, 'filters.json');


// ==== ФИЛЬТРЫ ====
let filters = {
  blacklist: [],
  minPrice: 80,
  amount: 30000,
  keywords: ['одним'],
  bannedWords: ['беру %', 'беру процент'],
};

// Загрузка сохранённых фильтров, если есть
if (fs.existsSync(FILTERS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
    filters = { ...filters, ...saved };
    console.log('✅ Загружены сохранённые фильтры.');
  } catch (err) {
    console.warn('⚠️ Ошибка чтения filters.json. Используются стандартные фильтры.');
  }
}


// ==== Telegram ====
const TELEGRAM_BOT_TOKEN = '';
const TELEGRAM_CHAT_ID = ''; // например, @your_channel или id


(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  await page.setRequestInterception(true);

  // Флаг управления перехватом
  let interceptEnabled = false;

  page.on('request', (request) => {
    request.continue();
  });

  page.on('response', async (response) => {
    if (!interceptEnabled) return;

    const url = response.url();
    if (url.includes('https://www.bybit.com/x-api/fiat/otc/item/online')) {
      try {
        const json = await response.json();

        if (json.ret_code === 0 && Array.isArray(json.result.items)) {
          console.log('\n📋 Пользователи из ответа:\n');
            json.result.items.forEach(async (user, index) => {
              const {
                nickName,
                price,
                lastQuantity,
                minAmount,
                maxAmount,
                remark
              } = user;

              console.log(`👤 Пользователь #${index + 1}`);
              console.log(`   🆔 Ник: ${nickName}`);
              console.log(`   💰 Цена: ${price}`);
              console.log(`   📦 Остаток: ${lastQuantity}`);
              console.log(`   🔽 Мин. сумма: ${minAmount}`);
              console.log(`   🔼 Макс. сумма: ${maxAmount}`);
              console.log(`   📝 Комментарий: ${remark || '—'}`);
              console.log('-------------------------');

              // ==== ФИЛЬТРАЦИЯ ====
              const remarkText = (remark || '').toLowerCase();
              const hasKeyword = filters.keywords.length === 0 || filters.keywords.some(word => remarkText.includes(word));
              const hasBannedWord = filters.bannedWords.some(word => remarkText.includes(word));

              const inBlacklist = filters.blacklist.length > 0 && filters.blacklist.includes(nickName);
              const priceTooLow = filters.minPrice && Number(price) < filters.minPrice;
              const amountOutOfRange = filters.amount && (filters.amount < Number(minAmount) || filters.amount > Number(maxAmount));


              if (inBlacklist || priceTooLow || amountOutOfRange || !hasKeyword || hasBannedWord) {
                console.log('⛔ Пользователь не прошёл фильтрацию.\n');
                return;
              }


              console.log('✅ Пользователь прошёл фильтрацию! Отправляем уведомление в Telegram.\n');

              // ==== УВЕДОМЛЕНИЕ В TELEGRAM ====
              const message = `
            🔔 Найден подходящий продавец:

            👤 Ник: ${nickName}
            💰 Цена: ${price}
            📦 Остаток: ${lastQuantity}
            🔽 Мин. сумма: ${minAmount}
            🔼 Макс. сумма: ${maxAmount}
            📝 Комментарий: ${remark || '—'}
            `;

              try {
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'Markdown'
                  })
                });
                console.log('📨 Уведомление отправлено в Telegram.');
              } catch (err) {
                console.error('❌ Ошибка отправки в Telegram:', err);
              }
            });


          // После успешной загрузки данных — двигаемся дальше
          nextStep();
        } else {
          console.log('⚠️ Ответ не содержит пользователей или ret_code != 0');
        }
      } catch (err) {
        console.log('❌ Ошибка парсинга JSON:', err);
      }
    }
  });

  let currentPageIndex = 0;
  const paginationSelectors = [
    'li.pagination-item.pagination-item-1',
    'li.pagination-item.pagination-item-2',
    'li.pagination-item.pagination-item-3',
  ];

  async function goToPage(index) {
    const selector = `#root > div.trade-list > div.trade-list__main > div.trade-list__wrapper > div.trade-list__content > div > div > div.trade-table__pagination > ul > ${paginationSelectors[index]}`;
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      console.log(`➡️ Перешли на страницу ${index + 1}`);
    } catch {
      console.log(`⚠️ Не удалось перейти на страницу ${index + 1}`);
    }
  }

  async function nextStep() {
    interceptEnabled = false;

    // Ждём 30 секунд
    console.log('⏳ Ждём 30 секунд перед переходом...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Следующая страница
    currentPageIndex = (currentPageIndex + 1) % paginationSelectors.length;
    await goToPage(currentPageIndex);

    // Включаем перехват заново
    interceptEnabled = true;
  }

  try {
    await page.goto('https://www.bybit.com/ru-RU/p2p/sell/USDT/RUB', {
      waitUntil: 'domcontentloaded',
      timeout: 0,
    });

    console.log('✅ Страница загружена.');

    // Закрываем модалку, если появится
    const modalButtonSelector =
      '#modal-root > div > div > div.by-dialog__foot.flex > button';

    try {
      const modalButton = await page.waitForSelector(modalButtonSelector, { timeout: 5000 });
      await modalButton.click();
      console.log('✅ Всплывающее окно закрыто.');
    } catch {
      console.log('ℹ️ Всплывающее окно не найдено или не появилось.');
    }

    console.log('\n🚨 Пожалуйста, авторизуйтесь на сайте вручную.');
    console.log('После авторизации вернитесь сюда и нажмите Enter, чтобы продолжить...');

    await new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
    function saveFilters() {
      fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2), 'utf-8');
      console.log('💾 Фильтры сохранены.');
    }

    function listenForCommands() {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.on('line', (input) => {
        const [cmd, ...args] = input.trim().split(' ');
        const argStr = args.join(' ');

        switch (cmd) {
          case '/setmin':
            filters.minPrice = parseFloat(argStr);
            console.log(`✅ Новый minPrice: ${filters.minPrice}`);
            saveFilters();
            break;

          case '/setamount':
            filters.amount = parseFloat(argStr);
            console.log(`✅ Новая сумма: ${filters.amount}`);
            saveFilters();
            break;

          case '/addkw':
            filters.keywords.push(argStr.toLowerCase());
            console.log(`✅ Добавлено ключевое слово: ${argStr}`);
            saveFilters();
            break;

          case '/rmkw':
            filters.keywords = filters.keywords.filter(w => w !== argStr.toLowerCase());
            console.log(`✅ Удалено ключевое слово: ${argStr}`);
            saveFilters();
            break;

          case '/addban':
            filters.bannedWords.push(argStr.toLowerCase());
            console.log(`✅ Добавлено запретное слово: ${argStr}`);
            saveFilters();
            break;

          case '/rmban':
            filters.bannedWords = filters.bannedWords.filter(w => w !== argStr.toLowerCase());
            console.log(`✅ Удалено запретное слово: ${argStr}`);
            saveFilters();
            break;

          case '/addblack':
            filters.blacklist.push(argStr);
            console.log(`✅ Добавлен в чёрный список: ${argStr}`);
            saveFilters();
            break;

          case '/rmblack':
            filters.blacklist = filters.blacklist.filter(nick => nick !== argStr);
            console.log(`✅ Удалён из чёрного списка: ${argStr}`);
            saveFilters();
            break;

          case '/show':
            console.log('🔎 Текущие фильтры:', JSON.stringify(filters, null, 2));
            saveFilters();
            break;

          default:
            console.log('❓ Неизвестная команда');
        }
      });
}


    console.log('✅ Продолжаем работу после авторизации.');
    listenForCommands();
    // Ввод суммы
    const sumInputSelector = '#guide-step-two > div.moly-space.flex.items-center > div.moly-space-item.moly-space-item-first > div input';
    await page.waitForSelector(sumInputSelector);

    await page.focus(sumInputSelector);
    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) el.value = '';
    }, sumInputSelector);
    await page.type(sumInputSelector, '30000', { delay: 100 });
    console.log('✅ Введена сумма 30000.');

    // Кликаем якорь меню
    await page.click('#paywayAnchorList');
    console.log('✅ Открыто якорное меню.');

    // Выбираем второй пункт
    await page.waitForSelector('#lists > li:nth-child(2)');
    await page.click('#lists > li:nth-child(2)');
    console.log('✅ Выбран второй пункт.');

    // Подтверждаем выбор
    const confirmBtnSelector = '#paywayList > div > section > button.moly-btn.inline-flex.items-center.justify-center.rounded-lg.select-none.text-base.transition-all.leading-6.font-IBM.font-semibold.enabled\\:active\\:border-base-bds-gray-t4-dis.enabled\\:active\\:text-base-bds-gray-t1-title.enabled\\:hover\\:border-base-bds-gray-t4-dis.enabled\\:hover\\:text-base-bds-gray-t2.px-\\[24px\\].py-\\[11px\\].btn-confirm';
    await page.waitForSelector(confirmBtnSelector);
    await page.click(confirmBtnSelector);
    console.log('✅ Подтверждён выбор.');

    // Включаем перехват запросов
    interceptEnabled = true;
    console.log('🚀 Перехват запросов включён. Ждём первый ответ...');

    // Бесконечный процесс
    setInterval(() => {}, 1000);

  } catch (err) {
    console.error('❌ Ошибка:', err);
  }
})();
