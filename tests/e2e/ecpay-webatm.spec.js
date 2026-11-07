// E2E：綠界網路 ATM（台灣土地銀行）付款完整流程
// 直接測試已啟動的專案（預設 http://localhost:3001，可用 E2E_BASE_URL 覆寫），不另外啟動伺服器。
// 注意：此測試會在該伺服器的資料庫建立一筆真實訂單並扣庫存。
const path = require('path');
const { test, expect } = require('@playwright/test');
const { calculateShipping } = require('../../src/utils/shipping');

const ACCOUNT = {
  email: process.env.E2E_EMAIL || 'admin@hexschool.com',
  password: process.env.E2E_PASSWORD || '12345678',
};
const RECIPIENT = {
  name: 'E2E 測試收件人',
  email: 'e2e-buyer@example.com',
  address: '台北市大安區忠孝東路四段 1 號',
};
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const ECPAY_STAGE = /^https:\/\/payment-stage\.ecpay\.com\.tw\//;
const ECPAY_PRODUCTION = /^https:\/\/payment\.ecpay\.com\.tw\//;

const money = (n) => n.toLocaleString('en-US');

async function saveScreenshot(page, testInfo, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

test('綠界網路 ATM（台灣土地銀行）付款：登入 → 加入購物車 → 結帳 → 付款 → 訂單已付款', async ({ page, request }, testInfo) => {
  // 安全網：只允許綠界 Staging，正式站請求一律中止
  await page.route(ECPAY_PRODUCTION, (route) => route.abort());

  let apiHeaders;
  let product;
  let expected;
  let orderId;

  await test.step('前置：確認伺服器已啟動，並清空測試帳號的購物車', async () => {
    const health = await request.get('/').catch(() => null);
    expect(health?.ok(), `無法連線到 ${testInfo.project.use.baseURL}，請先執行 npm run start`).toBeTruthy();

    const login = await request.post('/api/auth/login', { data: ACCOUNT });
    expect(login.status(), '測試帳號登入失敗').toBe(200);
    apiHeaders = { Authorization: `Bearer ${(await login.json()).data.token}` };

    const cart = await (await request.get('/api/cart', { headers: apiHeaders })).json();
    for (const item of cart.data.items) {
      await request.delete(`/api/cart/${item.id}`, { headers: apiHeaders });
    }
  });

  await test.step('1. 登入花卉電商', async () => {
    await page.goto('/login');
    // Vue 掛載前，伺服器輸出的原始模板同時含登入與註冊兩個表單；只剩一個代表已掛載，
    // 此時輸入才不會在掛載重繪時被清掉
    const form = page.locator('form');
    await expect(form).toHaveCount(1);
    await form.getByPlaceholder('請輸入 Email').fill(ACCOUNT.email);
    await form.getByPlaceholder('請輸入密碼').fill(ACCOUNT.password);
    await form.getByRole('button', { name: '登入' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  });

  await test.step('2. 選擇商品並加入購物車', async () => {
    // 首頁第一個可購買（未售完）的商品
    const card = page.locator('article').filter({ has: page.getByRole('button', { name: '加入購物車' }) }).first();
    await expect(card).toBeVisible();
    await card.locator('h3').click();

    await expect(page).toHaveURL(/\/products\/[\w-]+$/);
    const productId = new URL(page.url()).pathname.split('/').pop();
    product = (await (await request.get(`/api/products/${productId}`)).json()).data;
    expect(product.stock, '選到的商品沒有庫存').toBeGreaterThan(0);
    await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible();

    await page.locator('button.btn-primary', { hasText: '加入購物車' }).click();
    await expect(page.getByText('已加入購物車')).toBeVisible();
  });

  await test.step('3. 進入結帳頁面', async () => {
    await page.getByRole('link', { name: /^購物車/ }).first().click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: product.name })).toBeVisible();

    await page.getByRole('button', { name: '前往結帳' }).click();
    await expect(page).toHaveURL(/\/checkout$/);
  });

  await test.step('4. 填寫配送方式與結帳資料（宅配到府＋當日急件）', async () => {
    // 等 Vue 掛載並載入購物車（摘要出現商品名稱）後再填，否則輸入會在重繪時被清掉
    const summary = page.locator('aside');
    await expect(summary).toContainText(product.name);

    await page.getByPlaceholder('請輸入收件人姓名').fill(RECIPIENT.name);
    await page.getByPlaceholder('請輸入 Email').fill(RECIPIENT.email);
    await page.getByPlaceholder('請輸入收件地址').fill(RECIPIENT.address);
    await page.getByRole('radio', { name: /宅配到府/ }).check();
    await page.getByRole('checkbox', { name: /當日急件/ }).check();

    expected = calculateShipping({
      subtotal: product.price,
      shippingMethod: 'home_delivery',
      isRemoteArea: false,
      isUrgent: true,
    });

    await expect(summary).toContainText('當日急件加收');
    await expect(summary).toContainText(new RegExp(`總計\\s*NT\\$ ${money(expected.totalAmount)}`));
    await expect(page.getByRole('button', { name: '送出訂單' })).toBeEnabled();
    await saveScreenshot(page, testInfo, '01-checkout');
  });

  await test.step('5. 建立訂單', async () => {
    const orderResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/orders' && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '送出訂單' }).click();
    expect((await orderResponse).status()).toBe(201);
  });

  await test.step('6. 前往綠界測試環境', async () => {
    await page.waitForURL(ECPAY_STAGE);
    await expect(page.locator('body')).toContainText(new RegExp(`NT\\$\\s?${money(expected.totalAmount)}`));
  });

  await test.step('7. 選擇「網路 ATM」', async () => {
    const webAtmTab = page.getByRole('listitem', { name: 'WebATM' });
    await expect(webAtmTab).toContainText('網路ATM');
    await webAtmTab.click();
  });

  await test.step('8. 選擇「台灣土地銀行」', async () => {
    const bank = page.locator('#selWebATMBank');
    await expect(bank).toBeVisible();
    await bank.selectOption({ label: '台灣土地銀行' });
  });

  await test.step('9. 點擊「前往付款」', async () => {
    await page.locator('#WebATMPaySubmit').click();
  });

  await test.step('10. 關閉提示視窗', async () => {
    const notice = page.locator('.simplert').filter({ hasText: '將跳轉至銀行頁面' });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: '關閉' }).click();
  });

  await test.step('11. 在土地銀行測試頁面點擊 Save', async () => {
    await page.waitForURL(/\/MockMPPost\/LandWebAtm/);
    await expect(page.locator('#CurAmt')).toHaveValue(String(expected.totalAmount));
    await page.getByRole('button', { name: 'Save' }).click();
  });

  await test.step('12. 等待綠界顯示付款成功', async () => {
    await page.waitForURL(/\/webatm\/result/);
    await expect(page).toHaveTitle(/付款成功/);
    await expect(page.locator('body')).toContainText(new RegExp(`NT\\$\\s?${money(expected.totalAmount)}`));
    await saveScreenshot(page, testInfo, '02-ecpay-payment-success');
  });

  await test.step('13. 點擊「返回商店」', async () => {
    await page.getByRole('link', { name: '返回商店' }).click();
    await page.waitForURL(/\/orders\/[\w-]+\?payment=pending$/);
    orderId = new URL(page.url()).pathname.split('/').pop();
  });

  await test.step('14. 驗證訂單顯示「已付款」', async () => {
    // 頁面帶 payment=pending 會自動向綠界查詢一次；若綠界尚未入帳，再按「查詢付款狀態」重試
    const paidBadge = page.getByText('已付款', { exact: true });
    await expect(async () => {
      const recheck = page.getByRole('button', { name: '查詢付款狀態' });
      if (!(await paidBadge.isVisible()) && (await recheck.isEnabled().catch(() => false))) {
        await recheck.click();
      }
      await expect(paidBadge).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });

    await expect(page.getByText('付款成功！感謝您的購買。')).toBeVisible();
    await expect(page.getByRole('button', { name: '查詢付款狀態' })).toHaveCount(0);
    await saveScreenshot(page, testInfo, '03-order-paid');
  });

  await test.step('15. 驗證訂單狀態為 paid（API）', async () => {
    const res = await request.get(`/api/orders/${orderId}`, { headers: apiHeaders });
    expect(res.status()).toBe(200);
    const order = (await res.json()).data;

    expect(order).toMatchObject({
      status: 'paid',
      shipping_method: 'home_delivery',
      is_urgent: 1,
      subtotal_amount: product.price,
      shipping_fee: expected.shippingFee,
      total_amount: expected.totalAmount,
    });
    expect(order.items).toEqual([
      expect.objectContaining({ product_id: product.id, product_price: product.price, quantity: 1 }),
    ]);

    // 庫存已扣除 1 件
    const after = (await (await request.get(`/api/products/${product.id}`)).json()).data;
    expect(after.stock).toBe(product.stock - 1);
  });
});
