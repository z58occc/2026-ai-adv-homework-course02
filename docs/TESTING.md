# 測試規範與指南

## 測試框架

| 工具 | 用途 |
|------|------|
| [Vitest](https://vitest.dev/) | 測試執行器（相容 Jest API） |
| [supertest](https://github.com/ladjs/supertest) | HTTP 請求測試（直接對 Express app 發請求，不啟動伺服器） |

## 執行指令

```bash
# 執行全部測試
npm run test

# 等同於
npx vitest run
```

## 測試設定

**設定檔**：`vitest.config.js`

```javascript
export default defineConfig({
  test: {
    globals: true,          // describe/it/expect 為全域變數，無需 import
    fileParallelism: false, // 停用檔案平行執行（循序執行）
    sequence: {
      files: [              // 指定執行順序
        'tests/shipping.test.js',
        'tests/auth.test.js',
        'tests/products.test.js',
        'tests/cart.test.js',
        'tests/orders.test.js',
        'tests/adminProducts.test.js',
        'tests/adminOrders.test.js',
        'tests/shippingApi.test.js',
      ],
    },
    hookTimeout: 10000,     // beforeAll/afterAll 等 hook 的逾時時間（10 秒）
  },
});
```

## 測試檔案表

| 檔案 | 測試範圍 | 依賴 |
|------|----------|------|
| `tests/setup.js` | 輔助函式（非測試檔案） | — |
| `tests/shipping.test.js` | Shipping 模組單元測試：運費規則、免運門檻邊界、附加費疊加、偏遠地區判定、參數驗證 | 無（純函式，不啟動 app、不碰 DB） |
| `tests/auth.test.js` | 註冊、登入、重複 email、個人資料 | 無（首先執行，建立種子資料） |
| `tests/products.test.js` | 商品列表、分頁、詳情、404 | 依賴種子商品存在 |
| `tests/cart.test.js` | 加入購物車、查看、更新數量、刪除、訪客 vs 登入 | 依賴商品存在 + 使用者認證 |
| `tests/orders.test.js` | 建立訂單（含總額 = 小計 + 運費）、空購物車、認證要求、訂單列表、詳情 | 自行註冊使用者並加入購物車 |
| `tests/adminProducts.test.js` | 後台商品列表、新增、更新、刪除、權限檢查 | 依賴 admin 帳號 |
| `tests/adminOrders.test.js` | 後台訂單列表、詳情、狀態篩選 | 依賴訂單存在 + admin 帳號 |
| `tests/shippingApi.test.js` | 運費試算 API、建立訂單的運費／總額、偏遠地區由伺服器判定、綠界 TotalAmount 含運費 | admin 帳號（自建測試商品，afterAll 清除） |

## 執行順序與依賴關係

```
shipping.test.js      ← 第 1 順位：純函式單元測試，無任何依賴
    ↓
auth.test.js          ← 第 2 順位：建立使用者，驗證認證機制
    ↓
products.test.js      ← 第 3 順位：驗證種子商品（依賴 DB 初始化）
    ↓
cart.test.js          ← 第 4 順位：需要商品 + 認證 token
    ↓
orders.test.js        ← 第 5 順位：需要購物車有品項
    ↓
adminProducts.test.js ← 第 6 順位：需要 admin token
    ↓
adminOrders.test.js   ← 第 7 順位：需要訂單存在 + admin token
    ↓
shippingApi.test.js   ← 第 8 順位：自建測試商品與訂單，結束時清理
```

**為何要循序執行**：測試間存在資料依賴（例如 cart 測試新增的品項會在 orders 測試中用來建立訂單）。`fileParallelism: false` 確保測試檔案依序執行，避免競態條件。

## Shipping 模組測試

### 單元測試（`tests/shipping.test.js`）

直接 `require('../src/utils/shipping')` 測試純函式，不需要 supertest、不初始化資料庫，可單獨執行：

```bash
npx vitest run tests/shipping.test.js
```

| 情境 | 輸入 | 預期運費 / 總額 |
|------|------|----------------|
| 宅配基本運費 | 小計 1,000、宅配 | 120 / 1,120 |
| 超商取貨費用 | 小計 1,000、超商 | 60 / 1,060 |
| 商品小計 1,499 | 宅配 | 120 / 1,619（未達門檻） |
| 商品小計 1,500 | 宅配 | 0 / 1,500（免運） |
| 偏遠地區附加費 | 小計 1,000、宅配、偏遠 | 320 / 1,320 |
| 當日急件附加費 | 小計 1,000、宅配、急件 | 370 / 1,370 |
| 多項附加費同時成立 | 小計 1,000、宅配／超商、偏遠 + 急件 | 570 / 1,570；510 / 1,510 |
| 滿額免運與附加費同時成立 | 小計 1,500、宅配、偏遠 + 急件 | 450 / 1,950 |
| 超商滿額不免 | 小計 1,500、超商 | 60 / 1,560 |

另涵蓋：預設配送方式、`subtotal` / 配送方式 / 布林旗標的參數驗證（拋出 `TypeError`）、`isRemoteAddress()` 的離島與誤判案例（如「台北市金門街」不應判定為偏遠）、`parseShippingOptions()` 預設值與錯誤訊息。

### API 整合測試（`tests/shippingApi.test.js`）

- `beforeAll` 以 admin 建立價格固定（500）、庫存充足的專用測試商品，讓訂單小計可預期且不受種子商品庫存影響
- 每筆訂單前以 `setCart(quantity)` 清空並重設購物車
- 驗證 `POST /api/orders` 回應與 `GET /api/orders/:id` 的 `subtotal_amount`、`shipping_fee`、`total_amount` 正確，且前端傳入的 `isRemoteArea` 會被忽略
- 驗證 `GET /ecpay/payment/:orderId` 的 `TotalAmount` 為含運總額、`ItemName` 附加「運費 x1」
- `afterAll` 將測試訂單標為 failed 後刪除測試商品，避免殘留在前台商品列表

## 輔助函式說明

**檔案**：`tests/setup.js`

### `getAdminToken()`

```javascript
async function getAdminToken()
```

- **用途**：以種子管理員帳號（`admin@hexschool.com` / `12345678`）登入，回傳 JWT token
- **回傳**：`string`（JWT token）
- **使用場景**：所有需要 admin 權限的測試

### `registerUser(overrides?)`

```javascript
async function registerUser(overrides = {})
```

- **用途**：註冊新測試使用者並回傳認證資訊
- **參數**：
  - `overrides.email`：自訂 email（預設：`test-{timestamp}-{random}@example.com`）
  - `overrides.password`：自訂密碼（預設：`password123`）
  - `overrides.name`：自訂名稱（預設：`測試使用者`）
- **回傳**：`{ token: string, user: { id, email, name, role } }`
- **使用場景**：需要一般使用者 token 的測試

### 共用匯出

```javascript
module.exports = { app, request, getAdminToken, registerUser };
```

- `app`：Express 應用實例（從 `../app` 引入）
- `request`：supertest 函式（已綁定 app）

## 撰寫新測試的步驟

### 1. 建立測試檔案

在 `tests/` 下建立 `yourFeature.test.js`：

```javascript
const { app, request, getAdminToken, registerUser } = require('./setup');

describe('Your Feature', () => {
  let token;
  let adminToken;

  beforeAll(async () => {
    // 取得測試用 token
    const { token: userToken } = await registerUser();
    token = userToken;
    adminToken = await getAdminToken();
  });

  describe('GET /api/your-endpoint', () => {
    it('should return data successfully', async () => {
      const res = await request(app)
        .get('/api/your-endpoint')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.error).toBeNull();
    });

    it('should return 401 without token', async () => {
      const res = await request(app)
        .get('/api/your-endpoint');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });
});
```

### 2. 註冊測試執行順序

在 `vitest.config.js` 的 `sequence.files` 陣列中加入新檔案路徑，確保放在其依賴的測試之後：

```javascript
sequence: {
  files: [
    'tests/auth.test.js',
    'tests/products.test.js',
    'tests/cart.test.js',
    'tests/orders.test.js',
    'tests/adminProducts.test.js',
    'tests/adminOrders.test.js',
    'tests/yourFeature.test.js',  // ← 新增
  ],
},
```

### 3. 測試模式

```javascript
// 測試成功案例
it('should create resource', async () => {
  const res = await request(app)
    .post('/api/resource')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'test', value: 123 });

  expect(res.status).toBe(201);
  expect(res.body.data.name).toBe('test');
});

// 測試驗證錯誤
it('should return 400 for missing fields', async () => {
  const res = await request(app)
    .post('/api/resource')
    .set('Authorization', `Bearer ${token}`)
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('VALIDATION_ERROR');
});

// 測試權限
it('should return 403 for non-admin', async () => {
  const res = await request(app)
    .get('/api/admin/resource')
    .set('Authorization', `Bearer ${token}`);  // 一般使用者

  expect(res.status).toBe(403);
  expect(res.body.error).toBe('FORBIDDEN');
});

// 測試訪客模式（X-Session-Id）
it('should work with session ID', async () => {
  const sessionId = 'test-session-' + Date.now();
  const res = await request(app)
    .get('/api/cart')
    .set('X-Session-Id', sessionId);

  expect(res.status).toBe(200);
});
```

## 常見陷阱

### 1. 測試順序依賴

測試檔案之間有隱式資料依賴。若調整 `sequence.files` 順序，可能導致後續測試因缺少前置資料而失敗。例如 `orders.test.js` 預期購物車中已有品項（由 `cart.test.js` 新增）。

### 2. 共用資料庫狀態

所有測試共用同一個 SQLite 資料庫檔案。測試中建立的資料不會自動清除，且可能影響後續測試。設計測試時應考慮：
- 使用唯一的 email/名稱，避免衝突
- `registerUser()` 已自動生成唯一 email（含 timestamp + random）

### 3. bcrypt 速度

測試環境下 `NODE_ENV=test` 會將 bcrypt salt rounds 降至 1，加速密碼雜湊。若未設定 `NODE_ENV=test`，每次註冊/登入會使用 10 rounds，顯著拖慢測試速度。

> **注意**：seed admin 的 bcrypt rounds 取決於 `database.js` 首次執行時的 `NODE_ENV`。但 `authRoutes.js` 中的 `register` 端點固定使用 `bcrypt.hashSync(password, 10)`（寫死 10 rounds），不受 NODE_ENV 影響。

### 4. hookTimeout 設定

`hookTimeout: 10000`（10 秒）。若 `beforeAll` 中需要多次 HTTP 請求（如註冊 + 登入 + 加入購物車），應注意是否超時。

### 5. 無 afterAll 清理

目前測試未實作資料清理。每次完整測試運行會累積測試資料在 `database.sqlite` 中。這通常不影響測試結果（因為使用唯一識別碼），但長期可能使測試資料庫膨脹。

### 6. supertest 直接使用 app

測試透過 `request(app)` 直接對 Express 實例發送請求，不會啟動實際 HTTP 伺服器。這意味著：
- 不需要管理埠號衝突
- 不會觸發 `server.js` 中的 `app.listen()`
- `database.js` 在 `require('../app')` 時即初始化（建表 + 種子資料）
