// 整合測試的測試資料工具：建立測試會員、直接查詢資料庫、清除測試資料。
// 資料庫為 vitest.config.js 設定的記憶體 SQLite（setup.js 會檢查），不會碰到 database.sqlite。
const { app, request } = require('./setup');
const db = require('../../src/database');

let memberSeq = 0;

/**
 * 透過 API 註冊並登入一位測試會員。
 * @returns {Promise<{ userId: string, email: string, token: string, auth: object }>}
 */
async function createTestMember() {
  const email = `it-member-${Date.now()}-${++memberSeq}@example.com`;
  const password = 'password123';

  const register = await request(app)
    .post('/api/auth/register')
    .send({ email, password, name: '整合測試會員' });
  if (register.status !== 201) {
    throw new Error(`註冊測試會員失敗：${register.status} ${JSON.stringify(register.body)}`);
  }

  const login = await request(app).post('/api/auth/login').send({ email, password });
  if (login.status !== 200) {
    throw new Error(`測試會員登入失敗：${login.status} ${JSON.stringify(login.body)}`);
  }

  const { token, user } = login.body.data;
  return { userId: user.id, email, token, auth: { Authorization: `Bearer ${token}` } };
}

/**
 * 透過公開 API 取得商品，回傳 { [商品名稱]: product }。
 */
async function fetchProductsByName() {
  const res = await request(app).get('/api/products').query({ limit: 100 });
  if (res.status !== 200) throw new Error(`取得商品失敗：${res.status}`);
  return Object.fromEntries(res.body.data.products.map((p) => [p.name, p]));
}

/** 直接查詢資料庫，用來驗證 API 是否真的寫入／未寫入。 */
const query = {
  order: (orderId) => db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId),
  ordersOfUser: (userId) => db.prepare('SELECT * FROM orders WHERE user_id = ?').all(userId),
  orderItems: (orderId) =>
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY product_id').all(orderId),
  cartItemsOfUser: (userId) => db.prepare('SELECT * FROM cart_items WHERE user_id = ?').all(userId),
  stock: (productId) => db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock,
  count: (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
};

/** 記錄所有商品目前的庫存。 */
function snapshotStock() {
  return Object.fromEntries(
    db.prepare('SELECT id, stock FROM products ORDER BY id').all().map((r) => [r.id, r.stock])
  );
}

/** 將庫存還原為 snapshotStock() 的結果。 */
function restoreStock(snapshot) {
  const update = db.prepare('UPDATE products SET stock = ? WHERE id = ?');
  db.transaction(() => {
    for (const [id, stock] of Object.entries(snapshot)) update.run(stock, id);
  })();
}

/** 刪除測試會員及其建立的訂單、訂單品項、購物車資料。 */
function deleteMemberData(userId) {
  db.transaction(() => {
    db.prepare(
      'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)'
    ).run(userId);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();
}

module.exports = {
  db,
  query,
  createTestMember,
  fetchProductsByName,
  snapshotStock,
  restoreStock,
  deleteMemberData,
};
