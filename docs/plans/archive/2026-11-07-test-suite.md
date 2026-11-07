# 2026-11-07 完整測試流程（Unit / Integration / E2E / Postman）

## User Story

作為開發者，我希望以單一指令分別執行單元、整合、端對端測試並產出 Postman Collection，以便驗證前端操作、後端 API、資料庫寫入、庫存更新與綠界付款流程，且測試不會污染開發用資料庫。

## Spec

### 指令

| 指令 | 內容 |
|------|------|
| `npm run test:unit` | `tests/unit/`：純函式（Shipping 模組、Postman 轉換器） |
| `npm run test:integration` | `tests/integration/`：Vitest + Supertest，記憶體 SQLite |
| `npm run test:e2e` | `tests/e2e/`：Playwright，直接打已啟動的 `http://localhost:3001` |
| `npm run postman` | 產生 `openapi.json` → 轉為 `postman/flower-shop.postman_collection.json` |
| `npm test` | unit + integration |

### Integration 測試資料庫隔離

- `src/database.js` 讀取 `DB_PATH`（可為 `:memory:`），未設定時才用專案根目錄 `database.sqlite`
- `vitest.config.js` 以 `test.env` 設 `DB_PATH=':memory:'`；Vitest 每個測試檔在獨立 worker 載入 app，各自擁有全新的記憶體資料庫與種子資料
- `tests/integration/setup.js` 若發現 `DB_PATH` 不是 `:memory:` 即拋錯，杜絕誤寫 `database.sqlite`
- 結帳流程測試每個情境自建會員、結束時刪除會員／訂單／品項／購物車並還原庫存

### 結帳流程整合測試必驗項目

HTTP 狀態碼與回應格式、orders 寫入、order_items 寫入、運費、總額、庫存扣除、購物車清空；失敗時（庫存不足、參數錯誤、交易中途失敗）不留下不完整訂單、不扣庫存。

### E2E（綠界網路 ATM）

登入 admin → 首頁選商品加入購物車 → 結帳（宅配＋當日急件）→ 綠界 Staging → 網路ATM → 台灣土地銀行 → 前往付款 → 關閉提示窗 → 土地銀行模擬頁 Save → 付款成功 → 返回商店 → 訂單顯示「已付款」、API 狀態 `paid`。截圖存於 `tests/e2e/screenshots/`。不設定 `webServer`；封鎖綠界正式站網域。

### Postman Collection

`{{baseUrl}}`（預設 `http://localhost:3001`）、`token`、`sessionId` 變數；集合層級 Bearer `{{token}}`；登入／註冊成功自動存 token；公開 API 設 `noauth`；購物車 API 附 `X-Session-Id`。

## Tasks

- [x] `database.js` 支援 `DB_PATH`
- [x] 測試目錄改為 `tests/unit`、`tests/integration`、`tests/e2e`
- [x] 新增 `tests/integration/checkoutFlow.test.js`
- [x] Playwright 設定與 `tests/e2e/ecpay-webatm.spec.js`
- [x] `scripts/generate-postman.js` 與單元測試
- [x] `package.json` 指令
- [x] 更新 docs
