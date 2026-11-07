# 2026-11-07 配送費用計算（Shipping 模組）

## User Story

作為顧客，我希望結帳時能選擇配送方式與是否當日急件，並清楚看到運費明細，以便知道實際要付多少錢。
作為開發者，我希望運費邏輯集中於單一、可獨立測試的模組，以便規則調整時只需改一處。

## Spec

### 運費規則

| 項目 | 金額 | 說明 |
|------|------|------|
| 宅配基本運費 | 120 | `shippingMethod = home_delivery` |
| 超商取貨費 | 60 | `shippingMethod = cvs_pickup`；**不是基本運費**，滿額不免除 |
| 滿額免運 | 0 | 商品小計 ≥ 1,500 → 免除「宅配基本運費」 |
| 偏遠地區附加費 | +200 | 由伺服器依收件地址判定（離島），不接受前端自行宣告 |
| 當日急件附加費 | +250 | `isUrgent = true` |

- 附加費彼此獨立、可疊加，且與配送方式、是否滿額無關（滿額僅免基本運費，附加費照收）
- `運費 = 配送方式費用 + 偏遠地區附加費 + 當日急件附加費`
- `訂單總額 = 商品小計 + 運費`

### 偏遠地區判定

以收件地址（去除空白後）是否包含下列縣／鄉鎮名稱判定，清單集中於 `REMOTE_AREA_KEYWORDS`：

- 縣級：澎湖縣、金門縣、連江縣
- 澎湖：馬公市、湖西鄉、白沙鄉、西嶼鄉、望安鄉、七美鄉
- 金門：金城鎮、金湖鎮、金沙鎮、金寧鄉、烈嶼鄉、烏坵鄉
- 連江（馬祖）：南竿鄉、北竿鄉、莒光鄉、東引鄉
- 臺東：綠島鄉、蘭嶼鄉
- 屏東：琉球鄉

> 刻意不用「金門」「澎湖」等短詞，避免誤判「台北市金門街」這類以地名命名的街道。

### 模組：`src/utils/shipping.js`

| 匯出 | 說明 |
|------|------|
| `SHIPPING_METHODS` | `{ HOME_DELIVERY: 'home_delivery', CVS_PICKUP: 'cvs_pickup' }` |
| `SHIPPING_RATES` | 各項費用與免運門檻常數 |
| `REMOTE_AREA_KEYWORDS` | 偏遠地區判定清單 |
| `isValidShippingMethod(method)` | 驗證配送方式 |
| `isRemoteAddress(address)` | 依地址判定是否為偏遠地區 |
| `calculateShipping({ subtotal, shippingMethod, isRemoteArea, isUrgent })` | 回傳運費明細（純函式） |

### API 變更

- `POST /api/orders`：新增選填 `shippingMethod`（預設 `home_delivery`）、`isUrgent`（預設 `false`）；回應新增 `subtotal_amount`、`shipping_method`、`shipping_fee`、`is_remote_area`、`is_urgent`；`total_amount` 改為含運總額
- `POST /api/shipping/quote`（新增，公開）：結帳頁即時試算運費明細
- `GET /api/orders/:id`、`GET /api/admin/orders(/:id)`：因 `SELECT *` 自動帶出新欄位

### 資料庫變更（orders 表，ALTER TABLE migration）

| 欄位 | 型別 | 說明 |
|------|------|------|
| subtotal_amount | INTEGER | 商品小計（舊訂單回填為 total_amount） |
| shipping_method | TEXT | `home_delivery` / `cvs_pickup`（舊訂單為 NULL） |
| shipping_fee | INTEGER NOT NULL DEFAULT 0 | 運費合計 |
| is_remote_area | INTEGER NOT NULL DEFAULT 0 | 是否偏遠地區（0/1） |
| is_urgent | INTEGER NOT NULL DEFAULT 0 | 是否當日急件（0/1） |

### 錯誤處理

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | `shippingMethod` 不是 `home_delivery` / `cvs_pickup` |
| 400 | VALIDATION_ERROR | `isUrgent` 不是布林值 |
| 400 | VALIDATION_ERROR | （quote）`subtotal` 不是非負整數 |

## Tasks

- [x] 建立 `src/utils/shipping.js`
- [x] `src/database.js` 新增 orders 欄位 migration
- [x] `POST /api/orders` 整合 Shipping 模組
- [x] 新增 `POST /api/shipping/quote`
- [x] 綠界付款表單 ItemName 加入運費項目
- [x] 前台：結帳頁配送選項與運費明細、購物車／首頁／商品頁免運文案、訂單詳情運費顯示
- [x] 後台：訂單詳情顯示運費
- [x] 測試：`tests/shipping.test.js`（單元）、`tests/shippingApi.test.js`（API 整合）
- [x] 更新 docs 與 `openapi.json`
