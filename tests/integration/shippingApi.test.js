// 運費 API 整合測試：試算端點、建立訂單時的運費／總額、綠界付款金額
const { app, request, getAdminToken, registerUser } = require('./setup');

const PRODUCT_PRICE = 500;
const RECIPIENT = {
  recipientName: '運費測試收件人',
  recipientEmail: 'shipping@example.com',
  recipientAddress: '台北市大安區忠孝東路四段 1 號',
};
const REMOTE_ADDRESS = '澎湖縣馬公市中正路 1 號';

describe('Shipping API', () => {
  let adminToken;
  let userToken;
  let productId;
  const createdOrderIds = [];

  const auth = () => ({ Authorization: `Bearer ${userToken}` });

  // 清空購物車後放入指定數量的測試商品，讓每筆訂單的小計可預期
  async function setCart(quantity) {
    const cart = await request(app).get('/api/cart').set(auth());
    for (const item of cart.body.data.items) {
      await request(app).delete(`/api/cart/${item.id}`).set(auth());
    }
    await request(app).post('/api/cart').set(auth()).send({ productId, quantity });
  }

  async function createOrder(body) {
    const res = await request(app).post('/api/orders').set(auth()).send(body);
    if (res.status === 201) createdOrderIds.push(res.body.data.id);
    return res;
  }

  beforeAll(async () => {
    adminToken = await getAdminToken();
    ({ token: userToken } = await registerUser());

    // 專用測試商品：價格固定、庫存充足，避免受種子商品庫存變動影響
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '運費測試花束', price: PRODUCT_PRICE, stock: 999 });
    productId = res.body.data.id;
  });

  afterAll(async () => {
    // 將測試訂單標為 failed 後刪除測試商品，避免殘留在前台商品列表
    for (const id of createdOrderIds) {
      await request(app).patch(`/api/orders/${id}/pay`).set(auth()).send({ action: 'fail' });
    }
    const cart = await request(app).get('/api/cart').set(auth());
    for (const item of cart.body.data.items) {
      await request(app).delete(`/api/cart/${item.id}`).set(auth());
    }
    await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  describe('POST /api/shipping/quote', () => {
    it('回傳完整運費明細（滿額免運 + 偏遠地區 + 當日急件）', async () => {
      const res = await request(app)
        .post('/api/shipping/quote')
        .send({
          subtotal: 1500,
          shippingMethod: 'home_delivery',
          isUrgent: true,
          recipientAddress: REMOTE_ADDRESS,
        });

      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data).toEqual({
        shipping_method: 'home_delivery',
        subtotal: 1500,
        delivery_fee: 0,
        remote_area_fee: 200,
        urgent_fee: 250,
        shipping_fee: 450,
        is_free_shipping: true,
        is_remote_area: true,
        is_urgent: true,
        total_amount: 1950,
        free_shipping_threshold: 1500,
      });
    });

    it('只帶 subtotal 時以宅配、非急件、非偏遠地區試算', async () => {
      const res = await request(app).post('/api/shipping/quote').send({ subtotal: 1499 });

      expect(res.status).toBe(200);
      expect(res.body.data.shipping_method).toBe('home_delivery');
      expect(res.body.data.shipping_fee).toBe(120);
      expect(res.body.data.total_amount).toBe(1619);
    });

    it.each([
      ['缺少 subtotal', {}],
      ['subtotal 為負數', { subtotal: -1 }],
      ['subtotal 為字串', { subtotal: '1500' }],
      ['shippingMethod 不合法', { subtotal: 1000, shippingMethod: 'drone' }],
      ['isUrgent 不是布林值', { subtotal: 1000, isUrgent: 'true' }],
    ])('%s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await request(app).post('/api/shipping/quote').send(body);

      expect(res.status).toBe(400);
      expect(res.body.data).toBeNull();
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/orders 運費整合', () => {
    it('shippingMethod 不合法 → 400，且不建立訂單、不清空購物車', async () => {
      await setCart(1);
      const res = await createOrder({ ...RECIPIENT, shippingMethod: 'drone' });

      expect(res.status).toBe(400);
      expect(res.body.data).toBeNull();
      expect(res.body.error).toBe('VALIDATION_ERROR');

      const cart = await request(app).get('/api/cart').set(auth());
      expect(cart.body.data.items).toHaveLength(1);
    });

    it('isUrgent 不是布林值 → 400', async () => {
      await setCart(1);
      const res = await createOrder({ ...RECIPIENT, isUrgent: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('未指定配送方式時預設宅配：小計 500 + 運費 120 = 1,120', async () => {
      await setCart(2);
      const res = await createOrder(RECIPIENT);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        subtotal_amount: 1000,
        shipping_method: 'home_delivery',
        shipping_fee: 120,
        is_remote_area: 0,
        is_urgent: 0,
        total_amount: 1120,
      });
    });

    it('超商取貨 + 當日急件：小計 1,500 仍收超商 60 + 急件 250 = 1,810', async () => {
      await setCart(3);
      const res = await createOrder({ ...RECIPIENT, shippingMethod: 'cvs_pickup', isUrgent: true });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        subtotal_amount: 1500,
        shipping_method: 'cvs_pickup',
        shipping_fee: 310,
        is_remote_area: 0,
        is_urgent: 1,
        total_amount: 1810,
      });
    });

    describe('宅配滿額 + 離島地址 + 當日急件', () => {
      let order;

      beforeAll(async () => {
        await setCart(3);
        // isRemoteArea 由伺服器依地址判定，前端傳入的值應被忽略
        const res = await createOrder({
          ...RECIPIENT,
          recipientAddress: REMOTE_ADDRESS,
          shippingMethod: 'home_delivery',
          isUrgent: true,
          isRemoteArea: false,
        });
        expect(res.status).toBe(201);
        order = res.body.data;
      });

      it('免基本運費，偏遠 200 + 急件 250 照收，總額 1,950', () => {
        expect(order).toMatchObject({
          subtotal_amount: 1500,
          shipping_method: 'home_delivery',
          shipping_fee: 450,
          is_remote_area: 1,
          is_urgent: 1,
          total_amount: 1950,
        });
      });

      it('GET /api/orders/:id 回傳相同的運費與總額', async () => {
        const res = await request(app).get(`/api/orders/${order.id}`).set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
          subtotal_amount: 1500,
          shipping_method: 'home_delivery',
          shipping_fee: 450,
          is_remote_area: 1,
          is_urgent: 1,
          total_amount: 1950,
        });
      });

      it('綠界付款表單的 TotalAmount 含運費，ItemName 列出運費', async () => {
        const res = await request(app).get(`/ecpay/payment/${order.id}`);

        expect(res.status).toBe(200);
        expect(res.text).toContain('name="TotalAmount" value="1950"');
        expect(res.text).toContain('name="ItemName" value="運費測試花束 x3#運費 x1"');
      });
    });
  });
});
