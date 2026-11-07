const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/authMiddleware');
const { queryTradeInfo, verifyCheckMacValue, ECPAY_CONFIG } = require('../utils/ecpay');
const { parseShippingOptions, isRemoteAddress, calculateShipping } = require('../utils/shipping');

const router = express.Router();

router.use(authMiddleware);

function generateOrderNo() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = uuidv4().slice(0, 5).toUpperCase();
  return `ORD-${dateStr}-${random}`;
}

/**
 * @openapi
 * /api/orders:
 *   post:
 *     summary: 從購物車建立訂單
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientName, recipientEmail, recipientAddress]
 *             properties:
 *               recipientName:
 *                 type: string
 *                 example: 王小明
 *               recipientEmail:
 *                 type: string
 *                 format: email
 *                 example: buyer@example.com
 *               recipientAddress:
 *                 type: string
 *                 description: 收件地址（超商取貨時為取貨門市地址）；伺服器依此判定是否為偏遠地區（離島）
 *                 example: 台北市大安區忠孝東路四段 1 號
 *               shippingMethod:
 *                 type: string
 *                 enum: [home_delivery, cvs_pickup]
 *                 default: home_delivery
 *                 description: 配送方式。home_delivery 宅配（基本運費 120，商品小計滿 1500 免基本運費）；cvs_pickup 超商取貨（60，滿額不免）
 *               isUrgent:
 *                 type: boolean
 *                 default: false
 *                 description: 是否當日急件（加收 250）
 *     responses:
 *       201:
 *         description: 訂單建立成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     subtotal_amount:
 *                       type: integer
 *                       description: 商品小計
 *                     shipping_method:
 *                       type: string
 *                       enum: [home_delivery, cvs_pickup]
 *                     shipping_fee:
 *                       type: integer
 *                       description: 運費合計（配送方式費用 + 偏遠地區附加費 + 當日急件附加費）
 *                     is_remote_area:
 *                       type: integer
 *                       enum: [0, 1]
 *                       description: 是否偏遠地區（由收件地址判定）
 *                     is_urgent:
 *                       type: integer
 *                       enum: [0, 1]
 *                       description: 是否當日急件
 *                     total_amount:
 *                       type: integer
 *                       description: 訂單總額（商品小計 + 運費）
 *                     status:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                     created_at:
 *                       type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 購物車為空、庫存不足、收件資訊缺失，或 shippingMethod / isUrgent 不合法
 */
router.post('/', (req, res) => {
  const { recipientName, recipientEmail, recipientAddress } = req.body;
  const userId = req.user.userId;

  if (!recipientName || !recipientEmail || !recipientAddress) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '收件人姓名、Email 和地址為必填欄位'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'Email 格式不正確'
    });
  }

  const shippingOptions = parseShippingOptions(req.body);
  if (shippingOptions.error) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: shippingOptions.error
    });
  }
  const { shippingMethod, isUrgent } = shippingOptions.value;

  // Get cart items with product info
  const cartItems = db.prepare(
    `SELECT ci.id, ci.product_id, ci.quantity,
            p.name as product_name, p.price as product_price, p.stock as product_stock
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = ?`
  ).all(userId);

  if (cartItems.length === 0) {
    return res.status(400).json({
      data: null,
      error: 'CART_EMPTY',
      message: '購物車為空'
    });
  }

  // Check stock
  const insufficientItems = cartItems.filter(item => item.quantity > item.product_stock);
  if (insufficientItems.length > 0) {
    const names = insufficientItems.map(i => i.product_name).join(', ');
    return res.status(400).json({
      data: null,
      error: 'STOCK_INSUFFICIENT',
      message: `以下商品庫存不足：${names}`
    });
  }

  // Calculate subtotal, then shipping fee and total via the Shipping module.
  // Remote area is derived from the address server-side, never trusted from the client.
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.product_price * item.quantity, 0
  );
  const shipping = calculateShipping({
    subtotal,
    shippingMethod,
    isRemoteArea: isRemoteAddress(recipientAddress),
    isUrgent
  });

  const orderId = uuidv4();
  const orderNo = generateOrderNo();
  const merchantTradeNo = orderNo.replace(/-/g, '');

  // Transaction: create order, order items, deduct stock, clear cart
  const createOrder = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, order_no, user_id, recipient_name, recipient_email, recipient_address,
                           subtotal_amount, shipping_method, shipping_fee, is_remote_area, is_urgent,
                           total_amount, merchant_trade_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId, orderNo, userId, recipientName, recipientEmail, recipientAddress,
      shipping.subtotal, shipping.shippingMethod, shipping.shippingFee,
      shipping.isRemoteArea ? 1 : 0, shipping.isUrgent ? 1 : 0,
      shipping.totalAmount, merchantTradeNo
    );

    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

    for (const item of cartItems) {
      insertItem.run(uuidv4(), orderId, item.product_id, item.product_name, item.product_price, item.quantity);
      updateStock.run(item.quantity, item.product_id);
    }

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
  });

  createOrder();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare(
    'SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?'
  ).all(orderId);

  res.status(201).json({
    data: {
      id: order.id,
      order_no: order.order_no,
      subtotal_amount: order.subtotal_amount,
      shipping_method: order.shipping_method,
      shipping_fee: order.shipping_fee,
      is_remote_area: order.is_remote_area,
      is_urgent: order.is_urgent,
      total_amount: order.total_amount,
      status: order.status,
      items: orderItems,
      created_at: order.created_at
    },
    error: null,
    message: '訂單建立成功'
  });
});

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: 自己的訂單列表
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           order_no:
 *                             type: string
 *                           total_amount:
 *                             type: integer
 *                           status:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 */
router.get('/', (req, res) => {
  const orders = db.prepare(
    'SELECT id, order_no, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.userId);

  res.json({
    data: { orders },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     summary: 訂單詳情
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     recipient_name:
 *                       type: string
 *                     recipient_email:
 *                       type: string
 *                     recipient_address:
 *                       type: string
 *                     subtotal_amount:
 *                       type: integer
 *                       nullable: true
 *                       description: 商品小計
 *                     shipping_method:
 *                       type: string
 *                       nullable: true
 *                       enum: [home_delivery, cvs_pickup]
 *                       description: 配送方式（運費功能上線前的舊訂單為 null）
 *                     shipping_fee:
 *                       type: integer
 *                       description: 運費合計
 *                     is_remote_area:
 *                       type: integer
 *                       enum: [0, 1]
 *                     is_urgent:
 *                       type: integer
 *                       enum: [0, 1]
 *                     total_amount:
 *                       type: integer
 *                       description: 訂單總額（商品小計 + 運費）
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           product_id:
 *                             type: string
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       404:
 *         description: 訂單不存在
 */
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);

  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  res.json({
    data: { ...order, items },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}/pay:
 *   patch:
 *     summary: 模擬付款（更新訂單付款狀態）
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [success, fail]
 *     responses:
 *       200:
 *         description: 付款狀態更新成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: action 無效或訂單狀態不是 pending
 *       404:
 *         description: 訂單不存在
 */
router.patch('/:id/pay', (req, res) => {
  const { action } = req.body;
  const userId = req.user.userId;

  const actionMap = { success: 'paid', fail: 'failed' };
  if (!action || !actionMap[action]) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'action 必須為 success 或 fail'
    });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  if (order.status !== 'pending') {
    return res.status(400).json({
      data: null,
      error: 'INVALID_STATUS',
      message: '訂單狀態不是 pending，無法付款'
    });
  }

  const newStatus = actionMap[action];
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(newStatus, order.id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  res.json({
    data: { ...updated, items },
    error: null,
    message: action === 'success' ? '付款成功' : '付款失敗'
  });
});

/**
 * @openapi
 * /api/orders/{id}/check-payment:
 *   post:
 *     summary: 透過綠界 QueryTradeInfo API 查詢付款狀態
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 查詢成功
 *       400:
 *         description: 訂單狀態不是 pending
 *       404:
 *         description: 訂單不存在
 */
router.post('/:id/check-payment', async (req, res) => {
  const userId = req.user.userId;

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  if (order.status !== 'pending') {
    const items = db.prepare('SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?').all(order.id);
    return res.json({
      data: { ...order, items },
      error: null,
      message: order.status === 'paid' ? '此訂單已付款' : '此訂單付款失敗'
    });
  }

  if (!order.merchant_trade_no) {
    return res.status(400).json({ data: null, error: 'NO_TRADE_NO', message: '此訂單無綠界交易編號' });
  }

  try {
    const result = await queryTradeInfo(order.merchant_trade_no);

    if (result.TradeStatus === '1') {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', order.id);
      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      const items = db.prepare('SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?').all(order.id);
      return res.json({
        data: { ...updated, items },
        error: null,
        message: '付款成功'
      });
    }

    const items = db.prepare('SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?').all(order.id);
    return res.json({
      data: { ...order, items, ecpay_trade_status: result.TradeStatus },
      error: null,
      message: '尚未完成付款，請稍後再查詢'
    });
  } catch (err) {
    console.error('[ECPay] QueryTradeInfo error:', err.message);
    return res.status(500).json({
      data: null,
      error: 'ECPAY_QUERY_ERROR',
      message: '查詢綠界付款狀態失敗：' + err.message
    });
  }
});

module.exports = router;
