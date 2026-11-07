// 結帳流程整合測試：會員登入 → 取得商品 → 加入購物車 → 建立含配送資訊的訂單 → 驗證 API 與資料庫。
// 使用記憶體 SQLite（見 vitest.config.js），每個情境自建測試資料並於結束時清除。
const { app, request } = require('./setup');
const {
  db,
  query,
  createTestMember,
  fetchProductsByName,
  snapshotStock,
  restoreStock,
  deleteMemberData,
} = require('./testData');

const RECIPIENT = { recipientName: '整合測試收件人', recipientEmail: 'receiver@example.com' };
const TAIPEI_ADDRESS = '台北市大安區忠孝東路四段 1 號';

// 預期金額以規則手算寫死（不呼叫 Shipping 模組），作為獨立的對照答案
const SUCCESS_SCENARIOS = [
  {
    name: '宅配・未達免運門檻',
    cart: [
      { product: '迷你多肉組合盆', quantity: 1 }, // 580
      { product: '紫色鬱金香盆栽', quantity: 1 }, // 750
    ],
    order: { shippingMethod: 'home_delivery', isUrgent: false, recipientAddress: TAIPEI_ADDRESS },
    expected: { subtotal: 1330, shippingFee: 120, total: 1450, isRemoteArea: 0, isUrgent: 0 },
  },
  {
    name: '宅配・滿額免運＋偏遠地區＋當日急件',
    cart: [{ product: '粉色玫瑰花束', quantity: 1 }], // 1680
    order: { shippingMethod: 'home_delivery', isUrgent: true, recipientAddress: '澎湖縣馬公市中正路 1 號' },
    expected: { subtotal: 1680, shippingFee: 450, total: 2130, isRemoteArea: 1, isUrgent: 1 },
  },
  {
    name: '超商取貨＋當日急件（滿額仍收超商取貨費）',
    cart: [{ product: '繽紛向日葵花束', quantity: 2 }], // 980 × 2
    order: { shippingMethod: 'cvs_pickup', isUrgent: true, recipientAddress: '台北市中正區重慶南路一段 122 號（超商門市）' },
    expected: { subtotal: 1960, shippingFee: 310, total: 2270, isRemoteArea: 0, isUrgent: 1 },
  },
];

async function addToCart(member, productId, quantity) {
  const res = await request(app).post('/api/cart').set(member.auth).send({ productId, quantity });
  expect(res.status).toBe(200);
  return res;
}

function placeOrder(member, body) {
  return request(app).post('/api/orders').set(member.auth).send({ ...RECIPIENT, ...body });
}

describe('結帳流程整合測試', () => {
  const initialStock = snapshotStock();
  let products;

  beforeAll(async () => {
    products = await fetchProductsByName();
  });

  it('使用記憶體 SQLite，與專案的 database.sqlite 隔離', () => {
    expect(db.memory).toBe(true);
    expect(db.name).toBe(':memory:');
  });

  describe.each(SUCCESS_SCENARIOS)('建立訂單成功：$name', (scenario) => {
    const ctx = {};

    beforeAll(async () => {
      ctx.stockSnapshot = snapshotStock();

      // 1. 建立並登入測試會員
      ctx.member = await createTestMember();

      // 2. 取得商品資料（下單前的價格與庫存）
      ctx.lines = [];
      for (const { product: name, quantity } of scenario.cart) {
        const res = await request(app).get(`/api/products/${products[name].id}`);
        expect(res.status).toBe(200);
        ctx.lines.push({ product: res.body.data, quantity });
      }

      // 3. 將商品加入購物車
      for (const { product, quantity } of ctx.lines) {
        await addToCart(ctx.member, product.id, quantity);
      }

      // 4. 建立包含配送方式與配送資訊的訂單
      ctx.res = await placeOrder(ctx.member, scenario.order);
      ctx.order = ctx.res.body.data;
    });

    afterAll(() => {
      deleteMemberData(ctx.member.userId);
      restoreStock(ctx.stockSnapshot);
    });

    it('回應 201 與統一格式 { data, error, message }', () => {
      expect(ctx.res.status).toBe(201);
      expect(ctx.res.headers['content-type']).toMatch(/application\/json/);
      expect(Object.keys(ctx.res.body).sort()).toEqual(['data', 'error', 'message']);
      expect(ctx.res.body.error).toBeNull();
      expect(ctx.res.body.message).toBe('訂單建立成功');
      expect(ctx.order).toMatchObject({
        id: expect.any(String),
        order_no: expect.stringMatching(/^ORD-\d{8}-[0-9A-F]{5}$/),
        status: 'pending',
        shipping_method: scenario.order.shippingMethod,
        items: expect.any(Array),
      });
    });

    it('訂單正確寫入 orders 資料表', () => {
      const rows = query.ordersOfUser(ctx.member.userId);
      expect(rows).toHaveLength(1);

      expect(query.order(ctx.order.id)).toMatchObject({
        id: ctx.order.id,
        order_no: ctx.order.order_no,
        user_id: ctx.member.userId,
        recipient_name: RECIPIENT.recipientName,
        recipient_email: RECIPIENT.recipientEmail,
        recipient_address: scenario.order.recipientAddress,
        shipping_method: scenario.order.shippingMethod,
        subtotal_amount: scenario.expected.subtotal,
        shipping_fee: scenario.expected.shippingFee,
        is_remote_area: scenario.expected.isRemoteArea,
        is_urgent: scenario.expected.isUrgent,
        total_amount: scenario.expected.total,
        status: 'pending',
        merchant_trade_no: ctx.order.order_no.replace(/-/g, ''),
      });
    });

    it('訂單品項正確寫入 order_items（商品、價格快照與數量）', () => {
      const expectedItems = ctx.lines
        .map(({ product, quantity }) => ({
          order_id: ctx.order.id,
          product_id: product.id,
          product_name: product.name,
          product_price: product.price,
          quantity,
        }))
        .sort((a, b) => a.product_id.localeCompare(b.product_id));

      const rows = query.orderItems(ctx.order.id);
      expect(rows).toHaveLength(expectedItems.length);
      expect(rows).toEqual(expectedItems.map((item) => expect.objectContaining(item)));

      // API 回應的品項與資料庫一致
      expect(ctx.order.items).toHaveLength(expectedItems.length);
    });

    it('配送費用正確', () => {
      expect(ctx.order.shipping_fee).toBe(scenario.expected.shippingFee);
      expect(ctx.order.is_remote_area).toBe(scenario.expected.isRemoteArea);
      expect(ctx.order.is_urgent).toBe(scenario.expected.isUrgent);
    });

    it('訂單總額 = 商品小計 + 運費', () => {
      const subtotal = ctx.lines.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);
      expect(subtotal).toBe(scenario.expected.subtotal);
      expect(ctx.order.subtotal_amount).toBe(scenario.expected.subtotal);
      expect(ctx.order.total_amount).toBe(scenario.expected.total);
      expect(ctx.order.total_amount).toBe(ctx.order.subtotal_amount + ctx.order.shipping_fee);
    });

    it('商品庫存正確扣除', async () => {
      for (const { product, quantity } of ctx.lines) {
        expect(query.stock(product.id)).toBe(product.stock - quantity);

        const res = await request(app).get(`/api/products/${product.id}`);
        expect(res.body.data.stock).toBe(product.stock - quantity);
      }
    });

    it('建立訂單後購物車已清空', async () => {
      expect(query.cartItemsOfUser(ctx.member.userId)).toHaveLength(0);

      const res = await request(app).get('/api/cart').set(ctx.member.auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ items: [], total: 0 });
    });
  });

  describe('建立訂單失敗：不留下不完整訂單、不扣除庫存', () => {
    let member;
    let stockSnapshot;

    beforeEach(async () => {
      stockSnapshot = snapshotStock();
      member = await createTestMember();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      deleteMemberData(member.userId);
      restoreStock(stockSnapshot);
    });

    // 記錄下單前狀態，下單失敗後應完全相同
    function captureState() {
      return {
        stock: snapshotStock(),
        orders: query.count('orders'),
        orderItems: query.count('order_items'),
        cart: query.cartItemsOfUser(member.userId),
      };
    }

    function expectNothingChanged(before) {
      expect(query.ordersOfUser(member.userId)).toEqual([]);
      expect(query.count('orders')).toBe(before.orders);
      expect(query.count('order_items')).toBe(before.orderItems);
      expect(snapshotStock()).toEqual(before.stock);
      expect(query.cartItemsOfUser(member.userId)).toEqual(before.cart);
    }

    function expectErrorFormat(res, status, error) {
      expect(res.status).toBe(status);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'error', 'message']);
      expect(res.body.data).toBeNull();
      expect(res.body.error).toBe(error);
      expect(res.body.message).toEqual(expect.any(String));
    }

    it('下單前庫存被買走（庫存不足）→ 400 STOCK_INSUFFICIENT', async () => {
      const succulent = products['迷你多肉組合盆'];
      const tulip = products['紫色鬱金香盆栽'];
      await addToCart(member, succulent.id, 1);
      await addToCart(member, tulip.id, 3);

      // 模擬加入購物車後、下單前，鬱金香被其他顧客買到只剩 2 件
      db.prepare('UPDATE products SET stock = 2 WHERE id = ?').run(tulip.id);
      const before = captureState();

      const res = await placeOrder(member, { shippingMethod: 'home_delivery', recipientAddress: TAIPEI_ADDRESS });

      expectErrorFormat(res, 400, 'STOCK_INSUFFICIENT');
      expect(res.body.message).toContain('紫色鬱金香盆栽');
      expectNothingChanged(before); // 庫存充足的多肉也不能被扣
    });

    it('配送方式不合法 → 400 VALIDATION_ERROR', async () => {
      await addToCart(member, products['迷你多肉組合盆'].id, 1);
      const before = captureState();

      const res = await placeOrder(member, { shippingMethod: 'drone', recipientAddress: TAIPEI_ADDRESS });

      expectErrorFormat(res, 400, 'VALIDATION_ERROR');
      expectNothingChanged(before);
    });

    it('購物車為空 → 400 CART_EMPTY', async () => {
      const before = captureState();

      const res = await placeOrder(member, { shippingMethod: 'home_delivery', recipientAddress: TAIPEI_ADDRESS });

      expectErrorFormat(res, 400, 'CART_EMPTY');
      expectNothingChanged(before);
    });

    it('交易進行到一半失敗（扣第二項庫存時出錯）→ 500，整筆交易回滾', async () => {
      const succulent = products['迷你多肉組合盆'];
      const tulip = products['紫色鬱金香盆栽'];
      await addToCart(member, succulent.id, 1);
      await addToCart(member, tulip.id, 1);
      const before = captureState();

      // 讓交易內第 2 次「扣庫存」失敗：此時訂單、第 1 筆品項與第 1 筆扣庫存都已在交易中執行
      let stockUpdates = 0;
      const realPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql) => {
        const stmt = realPrepare(sql);
        if (!sql.startsWith('UPDATE products SET stock = stock -')) return stmt;
        return {
          run: (...args) => {
            stockUpdates += 1;
            if (stockUpdates === 2) throw new Error('模擬扣庫存時資料庫錯誤');
            return stmt.run(...args);
          },
        };
      });
      vi.spyOn(console, 'error').mockImplementation(() => {}); // errorHandler 會記錄錯誤

      const res = await placeOrder(member, { shippingMethod: 'home_delivery', recipientAddress: TAIPEI_ADDRESS });

      expect(stockUpdates).toBe(2); // 確認確實在交易中途才失敗
      expectErrorFormat(res, 500, 'INTERNAL_ERROR');
      expectNothingChanged(before);
    });
  });

  describe('測試資料清除', () => {
    it('各情境結束後已刪除自己建立的會員、訂單、購物車並還原庫存', () => {
      expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'admin'").get().n).toBe(0);
      expect(query.count('orders')).toBe(0);
      expect(query.count('order_items')).toBe(0);
      expect(query.count('cart_items')).toBe(0);
      expect(snapshotStock()).toEqual(initialStock);
    });
  });
});
