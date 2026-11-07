# 測試規範與指南

## 測試分層與指令

> Unit 與 Integration 會在 push / Pull Request 時由 GitHub Actions 自動執行，見 [CI（GitHub Actions）](#cigithub-actions)。


| 指令 | 層級 | 工具 | 範圍 | 資料庫 |
|------|------|------|------|--------|
| `npm run test:unit` | 單元 | Vitest | `tests/unit/`：純函式（Shipping 模組、Postman 轉換器） | 不使用 |
| `npm run test:integration` | 整合 | Vitest + Supertest | `tests/integration/`：API → 資料庫 | 記憶體 SQLite（每個測試檔一份） |
| `npm run test:e2e` | 端對端 | Playwright | `tests/e2e/`：瀏覽器 → 已啟動的伺服器 → 綠界 Staging | 伺服器自己的 `database.sqlite`（會寫入） |
| `npm test` | 單元 + 整合 | Vitest | `tests/unit/` + `tests/integration/` | 同上 |
| `npm run postman` | — | 自製轉換器 | 產生 `openapi.json` → `postman/flower-shop.postman_collection.json` | 不使用 |

| 工具 | 用途 |
|------|------|
| [Vitest](https://vitest.dev/) | 單元與整合測試執行器（相容 Jest API） |
| [supertest](https://github.com/ladjs/supertest) | 直接對 Express app 發 HTTP 請求，不啟動伺服器 |
| [Playwright](https://playwright.dev/) | E2E 瀏覽器自動化（`@playwright/test`） |

## 目錄結構

```
tests/
├── unit/                         # 純函式，不載入 app、不碰資料庫
│   ├── shipping.test.js          # Shipping 模組
│   └── postmanCollection.test.js # OpenAPI → Postman 轉換器
├── integration/                  # Vitest + Supertest，記憶體 SQLite
│   ├── setup.js                  # 檢查 DB_PATH、匯出 app / request / getAdminToken / registerUser
│   ├── testData.js               # 建立測試會員、直接查詢資料庫、清除測試資料、庫存快照與還原
│   ├── checkoutFlow.test.js      # 結帳流程：登入 → 商品 → 購物車 → 下單 → 驗證資料庫、庫存、購物車、失敗回滾
│   ├── auth.test.js              # 註冊、登入、重複 email、個人資料
│   ├── products.test.js          # 商品列表、分頁、詳情、404
│   ├── cart.test.js              # 購物車 CRUD、訪客 vs 登入
│   ├── orders.test.js            # 訂單建立、列表、詳情
│   ├── adminProducts.test.js     # 後台商品 CRUD、權限
│   ├── adminOrders.test.js       # 後台訂單列表、詳情、狀態篩選
│   └── shippingApi.test.js       # 運費試算 API、建單運費、綠界 TotalAmount
└── e2e/                          # Playwright（不被 Vitest 收錄）
    ├── ecpay-webatm.spec.js      # 綠界網路 ATM（台灣土地銀行）付款完整流程
    └── screenshots/              # 每次執行覆寫的成功截圖
playwright.config.js              # Playwright 設定（不設 webServer）
vitest.config.js                  # Vitest 設定（include、test.env）
scripts/generate-postman.js       # OpenAPI → Postman Collection
```

## 整合測試的資料庫隔離

整合測試**不會讀寫專案的 `database.sqlite`**：

1. `src/database.js` 讀取 `DB_PATH` 環境變數，未設定時才使用專案根目錄的 `database.sqlite`。
2. `vitest.config.js` 以 `test.env` 設定 `DB_PATH: ':memory:'`（並設定測試用 `JWT_SECRET`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`，不依賴本機 `.env`）。
3. Vitest 預設每個測試檔在獨立的 worker 中載入模組，因此**每個測試檔各自擁有一份全新的記憶體資料庫**（含 admin 與 8 筆種子商品），檔案之間沒有資料依賴，結束即消失。
4. `tests/integration/setup.js` 在載入 app 之前檢查 `DB_PATH === ':memory:'`，不符合就拋錯，避免有人繞過設定直接執行而寫到 `database.sqlite`。
5. `checkoutFlow.test.js` 的第一個測試斷言 `db.memory === true`；最後一個測試斷言所有情境結束後，會員、訂單、品項、購物車皆已刪除且庫存還原。

```javascript
// vitest.config.js（節錄）
test: {
  include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
  env: {
    DB_PATH: ':memory:',
    NODE_ENV: 'test',
    JWT_SECRET: 'vitest-only-jwt-secret',
    ADMIN_EMAIL: 'admin@hexschool.com',
    ADMIN_PASSWORD: '12345678',
  },
  fileParallelism: false,
  hookTimeout: 10000,
}
```

## 單元測試（`tests/unit/`）

### Shipping 模組（`shipping.test.js`）

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

另涵蓋：預設配送方式、參數驗證（拋出 `TypeError`）、`isRemoteAddress()` 的離島與誤判案例（如「台北市金門街」）、`parseShippingOptions()`。

### Postman 轉換器（`postmanCollection.test.js`）

以 `swagger-jsdoc` 即時產生 OpenAPI 後呼叫 `buildCollection()`，驗證：有效 JSON 與 v2.1 schema、`baseUrl`／`token`／`sessionId` 變數、每個 OpenAPI 操作都有對應請求且網址以 `{{baseUrl}}` 開頭、集合層級 Bearer 與公開 API 的 `noauth`、登入／註冊自動存 token、購物車帶 `X-Session-Id`、路徑參數轉換、建立訂單 body 含配送欄位。

## 整合測試（`tests/integration/`）

### 結帳流程（`checkoutFlow.test.js`）

每個成功情境依序執行：**建立並登入測試會員 → 取得商品資料 → 加入購物車 → 建立含配送方式與配送資訊的訂單**，再逐項驗證：

| 驗證項目 | 方式 |
|----------|------|
| HTTP 狀態碼與回應格式 | 201、`content-type: application/json`、頂層只有 `data` / `error` / `message`、`order_no` 格式 |
| 訂單正確寫入 | 直接查 `orders`：會員、收件資訊、配送方式、小計、運費、偏遠／急件旗標、總額、`merchant_trade_no` |
| 訂單品項正確寫入 | 直接查 `order_items`：商品 ID、名稱與價格快照、數量 |
| 配送費用正確 | 與手算寫死的預期值比對（不呼叫 Shipping 模組，避免同源驗證） |
| 訂單總額正確 | `total_amount = subtotal_amount + shipping_fee`，且等於預期值 |
| 庫存正確扣除 | 資料庫與 `GET /api/products/:id` 皆為「下單前庫存 − 數量」 |
| 購物車已清空 | 資料庫 `cart_items` 無資料，`GET /api/cart` 回 `{ items: [], total: 0 }` |

| 成功情境 | 購物車 | 配送 | 運費 | 總額 |
|----------|--------|------|------|------|
| 宅配・未達免運門檻 | 迷你多肉 580 + 紫色鬱金香 750 | 宅配、台北 | 120 | 1,450 |
| 宅配・滿額免運＋偏遠＋急件 | 粉色玫瑰 1,680 | 宅配、澎湖、急件 | 450 | 2,130 |
| 超商取貨＋急件 | 繽紛向日葵 980 × 2 | 超商、急件 | 310 | 2,270 |

失敗情境皆驗證：回應格式、該會員**沒有任何訂單**、`orders` / `order_items` 筆數不變、**所有商品庫存不變**、購物車維持原狀。

| 失敗情境 | 製造方式 | 預期 |
|----------|----------|------|
| 庫存不足 | 加入購物車後直接把其中一項庫存改小（模擬被他人買走） | 400 `STOCK_INSUFFICIENT`，庫存充足的另一項也不能被扣 |
| 配送方式不合法 | `shippingMethod: 'drone'` | 400 `VALIDATION_ERROR` |
| 購物車為空 | 不加入商品直接下單 | 400 `CART_EMPTY` |
| 交易進行到一半失敗 | `vi.spyOn(db, 'prepare')` 讓交易內第 2 次扣庫存拋錯（此時訂單、第 1 筆品項與第 1 筆扣庫存都已執行） | 500 `INTERNAL_ERROR`，整筆交易回滾 |

> 「交易中途失敗」案例可驗證 `db.transaction()` 確實存在：若把建單改成非交易執行，此測試會失敗。

### 測試資料工具（`testData.js`）

| 函式 | 說明 |
|------|------|
| `createTestMember()` | 透過 API 註冊並登入，回傳 `{ userId, email, token, auth }`（`auth` 可直接 `.set()`） |
| `fetchProductsByName()` | `GET /api/products?limit=100`，回傳 `{ [商品名稱]: product }` |
| `query.*` | 直接查詢 `orders`、`order_items`、`cart_items`、庫存與筆數 |
| `snapshotStock()` / `restoreStock(snapshot)` | 庫存快照與還原 |
| `deleteMemberData(userId)` | 刪除會員及其訂單、品項、購物車 |

### `setup.js`

| 匯出 | 說明 |
|------|------|
| `app` / `request` | Express app 與 supertest |
| `getAdminToken()` | 以種子管理員（`admin@hexschool.com` / `12345678`）登入並回傳 JWT |
| `registerUser(overrides?)` | 註冊唯一 email 的測試使用者，回傳 `{ token, user }` |

## E2E 測試（`tests/e2e/`）

### 執行前準備

1. 安裝瀏覽器（首次）：`npx playwright install chromium`
2. **先啟動專案**：`npm run start`（E2E 直接使用已啟動的 `http://localhost:3001`，`playwright.config.js` 刻意不設 `webServer`）
3. 伺服器的 `.env` 必須是綠界 **Staging**（`ECPAY_ENV=staging`）。測試另以 `page.route` 封鎖正式站 `payment.ecpay.com.tw`
4. `.env` 的 `BASE_URL` 需為 `http://localhost:3001`，綠界「返回商店」才會導回本機

> E2E 會在伺服器的 `database.sqlite` 建立一筆真實訂單、扣 1 件庫存，並清空測試帳號的購物車。

可用環境變數覆寫：`E2E_BASE_URL`（預設 `http://localhost:3001`）、`E2E_EMAIL` / `E2E_PASSWORD`（預設 `admin@hexschool.com` / `12345678`）。

### 流程（`ecpay-webatm.spec.js`）

| 步驟 | 操作 | 驗證 |
|------|------|------|
| 前置 | API 登入、清空測試帳號購物車 | 伺服器可連線 |
| 1 | `/login` 輸入帳密登入 | 導回首頁、出現「登出」 |
| 2 | 點首頁第一個可購買商品 → 商品頁「加入購物車」 | 出現「已加入購物車」 |
| 3 | 導覽列「購物車」→「前往結帳」 | 購物車列出該商品、進入 `/checkout` |
| 4 | 填收件資訊，選「宅配到府」＋「當日急件」 | 摘要出現「當日急件加收」，總計等於 Shipping 規則計算值 |
| 5 | 「送出訂單」 | `POST /api/orders` 回 201 |
| 6 | 自動導向綠界 | 網址為 `payment-stage.ecpay.com.tw`，金額等於總計 |
| 7 | 選「網路ATM」（`listitem` 名稱 `WebATM`） | — |
| 8 | 銀行下拉 `#selWebATMBank` 選「台灣土地銀行」 | — |
| 9 | 「前往付款」`#WebATMPaySubmit` | — |
| 10 | 關閉「將跳轉至銀行頁面」提示窗 | 提示窗可見 |
| 11 | 土地銀行模擬頁 `MockMPPost/LandWebAtm` 按 `Save` | `#CurAmt` 等於總計 |
| 12 | 等待付款結果頁 | 標題「付款成功」，金額正確；截圖 `02-ecpay-payment-success.png` |
| 13 | 「返回商店」 | 回到 `/orders/:id?payment=pending` |
| 14 | 頁面自動查詢付款狀態（必要時再按「查詢付款狀態」，最多 60 秒） | 顯示「已付款」與「付款成功！感謝您的購買。」；截圖 `03-order-paid.png` |
| 15 | `GET /api/orders/:id` | `status: 'paid'`、運費與總額正確、品項正確、庫存少 1 |

### 產出

| 路徑 | 內容 |
|------|------|
| `tests/e2e/screenshots/01-checkout.png` | 結帳頁運費明細（`tests/e2e/screenshots/` 已 gitignore，每次執行覆寫） |
| `tests/e2e/screenshots/02-ecpay-payment-success.png` | 綠界付款成功頁 |
| `tests/e2e/screenshots/03-order-paid.png` | 返回本站後訂單顯示「已付款」 |
| `playwright-report/` | HTML 報告（`npx playwright show-report`，已 gitignore） |
| `test-results/` | 失敗時的 trace、影片、截圖（已 gitignore） |

### 撰寫要點

- **等 Vue 掛載後再輸入**：伺服器輸出的原始模板在 Vue 掛載前就可見，太早 `fill()` 的值會在掛載重繪時被清掉。登入頁等 `form` 只剩一個、結帳頁等摘要出現商品名稱後才填。
- 綠界收銀台的「關閉」按鈕在各付款方式各有一個（共用 `id="btnClose"`），要以 `getByRole('button', { name: '關閉' })` 限定在可見的提示窗內。
- 綠界付款結果入帳可能有延遲，訂單狀態以 `expect(...).toPass()` 重試「查詢付款狀態」。

## Postman Collection

```bash
npm run postman   # = npm run openapi && node scripts/generate-postman.js
```

產出 `postman/flower-shop.postman_collection.json`（Collection v2.1，已 gitignore，需要時執行指令重新產生），可直接匯入 Postman 或以 `newman run` 執行：

| 項目 | 內容 |
|------|------|
| 網址 | 一律 `{{baseUrl}}/api/...`，`baseUrl` 預設 `http://localhost:3001`（產生時可用 `POSTMAN_BASE_URL` 覆寫） |
| 變數 | `baseUrl`、`token`、`sessionId`，以及 `productId`、`cartItemId`、`orderId` |
| 認證 | 集合層級 Bearer `{{token}}`；OpenAPI 標示 `bearerAuth` 的 API 繼承之，公開 API 設 `noauth` |
| 自動存值 | 登入／註冊成功 → `token`；商品列表 → `productId`；加入購物車 → `cartItemId`；建立訂單 → `orderId` |
| 購物車 | 附 `X-Session-Id: {{sessionId}}`，`sessionId` 未設定時由集合 pre-request script 自動產生 |
| 共用測試 | 每個回應驗證 `{ data, error, message }` 格式 |
| 範例 body | 取自 OpenAPI 的 `example` / `default` / `enum`（JSDoc 中維護） |

使用順序：Auth › 使用者登入（範例為種子 admin 帳號）→ 其餘 API 即自動帶 Token。修改路由 JSDoc 後重新執行 `npm run postman`，勿手動編輯產出檔。

## CI（GitHub Actions）

**檔案**：`.github/workflows/test.yml`

| 項目 | 設定 |
|------|------|
| 觸發 | push 到任何分支、對 `main` 開 Pull Request、手動執行（`workflow_dispatch`） |
| 環境 | `ubuntu-latest`、Node.js 22（`actions/setup-node` 快取 npm） |
| 步驟 | Checkout → Set up Node.js → `npm ci` → **Unit tests**（`npm run test:unit`）→ **Integration tests**（`npm run test:integration`） |
| 不執行 | Playwright E2E（需已啟動的伺服器與綠界 Staging）；也不啟動任何前端或後端服務 |
| 其他 | `permissions: contents: read`；同一分支有新 push 時取消舊的執行；逾時 15 分鐘 |

CI 不需要任何 Secrets 或 `.env`：整合測試所需的 `DB_PATH=':memory:'`、`JWT_SECRET`、`ADMIN_*` 皆由 `vitest.config.js` 的 `test.env` 提供，supertest 直接呼叫 Express app，不開埠號。

執行結果可在 GitHub repo 的 **Actions** 分頁查看。

## 撰寫新測試的步驟

- **純函式**：放 `tests/unit/`，直接 `require` 模組，不要載入 `app`。
- **API**：放 `tests/integration/`，`require('./setup')` 取得 `app` / `request`；需要驗證資料庫時用 `testData.js` 的 `query`。每個測試檔都有自己的記憶體資料庫，**不需要也不應該**依賴其他測試檔的資料。
- **瀏覽器流程**：放 `tests/e2e/*.spec.js`，使用 `@playwright/test`。

```javascript
const { app, request, registerUser } = require('./setup');
const { query } = require('./testData');

describe('Your Feature', () => {
  let token;

  beforeAll(async () => {
    ({ token } = await registerUser());
  });

  it('should return data successfully', async () => {
    const res = await request(app)
      .get('/api/your-endpoint')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/your-endpoint');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});
```

## 常見陷阱

1. **直接 `npx vitest` 指定檔案也會套用 `vitest.config.js`**，所以仍是記憶體資料庫；若改用其他方式載入 `tests/integration/setup.js` 而沒有 `DB_PATH=':memory:'`，會直接拋錯，這是刻意的保護。
2. **`register` 端點固定使用 bcrypt 10 rounds**（`authRoutes.js` 寫死），每次註冊約數十毫秒；種子 admin 則因 `NODE_ENV=test` 只用 1 round。
3. **`hookTimeout: 10000`**：`beforeAll` 內有多次註冊／下單時注意總時間。
4. **E2E 需要伺服器與網路**：伺服器未啟動時前置步驟會直接失敗並提示 `npm run start`；綠界 Staging 為外部服務，偶有延遲。
5. **E2E 使用的是伺服器載入時的程式碼**：修改後端後須重啟 `npm run start`，E2E 才會測到新版本。
