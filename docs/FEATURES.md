# 功能清單與完成狀態

## 功能總覽

| 功能區塊 | 狀態 | 說明 |
|----------|------|------|
| 使用者認證 | ✅ 完成 | 註冊、登入、個人資料 |
| 商品瀏覽 | ✅ 完成 | 公開商品列表與詳情 |
| 購物車管理 | ✅ 完成 | 雙模式認證（JWT / Session ID） |
| 訂單管理 | ✅ 完成 | 建立、查詢、模擬付款 |
| 配送運費計算 | ✅ 完成 | 宅配／超商取貨、滿額免運、偏遠地區與當日急件附加費（`src/utils/shipping.js`） |
| 綠界金流串接 | ✅ 完成 | ECPay AIO 付款、QueryTradeInfo 查詢驗證 |
| 後台商品管理 | ✅ 完成 | 商品 CRUD |
| 後台訂單管理 | ✅ 完成 | 訂單查詢與狀態篩選 |
| 前台頁面 | ✅ 完成 | EJS + Tailwind CSS |
| 後台頁面 | ✅ 完成 | EJS + Tailwind CSS |
| 測試 | ✅ 完成 | Vitest + supertest，8 個測試檔案（含 Shipping 模組單元測試） |
| API 文件 | ✅ 完成 | Swagger/OpenAPI 生成 |

---

## 使用者認證

### POST /api/auth/register — 註冊新帳號

**行為描述**：建立新使用者帳號並回傳 JWT token，讓使用者註冊後立即處於登入狀態。

**Request Body**：

| 欄位 | 型別 | 必填 | 驗證規則 |
|------|------|------|----------|
| email | string | 是 | 符合 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`，全域唯一 |
| password | string | 是 | 最少 6 字元 |
| name | string | 是 | 非空 |

**業務邏輯**：
- 密碼以 bcrypt 雜湊儲存（正式環境 salt rounds = 10，測試環境 = 1）
- 新使用者 role 固定為 `'user'`，無法透過 API 建立 admin
- Email 唯一性由資料庫 UNIQUE 約束保證

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | 缺少 email / password / name |
| 400 | VALIDATION_ERROR | Email 格式不正確 |
| 400 | VALIDATION_ERROR | 密碼少於 6 字元 |
| 409 | CONFLICT | Email 已被註冊 |

### POST /api/auth/login — 登入

**行為描述**：驗證帳密並回傳 JWT token。登入失敗時使用模糊訊息（「Email 或密碼錯誤」），防止使用者列舉攻擊。

**Request Body**：

| 欄位 | 型別 | 必填 |
|------|------|------|
| email | string | 是 |
| password | string | 是 |

**業務邏輯**：
- 使用 `bcrypt.compareSync()` 比對密碼
- 無論是 email 不存在或密碼錯誤，一律回 401 + 相同訊息
- Token 有效期 7 天，payload 包含 `{ userId, email, role }`

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | 缺少 email / password |
| 401 | UNAUTHORIZED | Email 不存在或密碼錯誤 |

### GET /api/auth/profile — 取得個人資料

**行為描述**：回傳當前登入使用者的基本資料。需要有效的 JWT token。

**認證**：JWT（authMiddleware）

**回應欄位**：id, email, name, role, created_at

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 401 | UNAUTHORIZED | 未提供 token / token 無效或過期 |
| 404 | NOT_FOUND | 使用者已被刪除（token 仍有效但 DB 中已不存在） |

---

## 商品瀏覽

### GET /api/products — 商品列表

**行為描述**：公開端點，回傳分頁商品列表，依建立時間降序排列。

**Query 參數**：

| 參數 | 型別 | 預設值 | 範圍 |
|------|------|--------|------|
| page | integer | 1 | ≥ 1 |
| limit | integer | 10 | 1 ~ 100 |

**業務邏輯**：
- 分頁計算：`offset = (page - 1) * limit`
- 無效 page/limit 值自動修正（`parseInt` 失敗則取預設值，再以 `Math.max`/`Math.min` 限制範圍）
- 回傳 pagination 物件：`{ total, page, limit, totalPages }`

### GET /api/products/:id — 商品詳情

**行為描述**：公開端點，回傳單一商品完整資訊。

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 404 | NOT_FOUND | 商品 ID 不存在 |

---

## 購物車管理

> **認證模式**：dualAuth — 優先 JWT，若無則使用 X-Session-Id header。兩者皆無則 401。

### GET /api/cart — 查看購物車

**行為描述**：回傳當前使用者/訪客的購物車品項列表與總金額。品項包含即時商品資訊（名稱、價格、庫存、圖片）。

**回應結構**：
```json
{
  "data": {
    "items": [
      {
        "id": "cart_item_id",
        "product_id": "product_id",
        "quantity": 2,
        "product": {
          "name": "粉色玫瑰花束",
          "price": 1680,
          "stock": 30,
          "image_url": "https://..."
        }
      }
    ],
    "total": 3360
  }
}
```

**業務邏輯**：
- total 為即時計算：`Σ(product.price × quantity)`
- 使用 `getOwnerCondition()` 判斷查詢條件：JWT 用 `user_id`，訪客用 `session_id`

### POST /api/cart — 加入商品到購物車

**行為描述**：將指定商品加入購物車。若商品已在購物車中，**累加數量**而非建立新項目。

**Request Body**：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| productId | string | 是 | 商品 ID |
| quantity | integer | 否 | 數量，預設 1，必須為正整數 |

**業務邏輯**：
1. 檢查 productId 是否存在 → 404
2. 檢查商品是否已在購物車中
   - **已存在**：計算 `newQty = existingQty + qty`，檢查 `newQty ≤ stock`，通過則 UPDATE
   - **不存在**：檢查 `qty ≤ stock`，通過則 INSERT
3. 庫存檢查在加入時執行（非下單時才檢查）

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | 缺少 productId |
| 400 | VALIDATION_ERROR | quantity 不是正整數 |
| 400 | STOCK_INSUFFICIENT | 數量超過庫存（含累加後） |
| 404 | NOT_FOUND | 商品不存在 |

### PATCH /api/cart/:itemId — 修改數量

**行為描述**：直接設定購物車品項的新數量（非累加）。

**Request Body**：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| quantity | integer | 是 | 新數量，必須為正整數 |

**業務邏輯**：
- 所有權檢查：品項必須屬於當前使用者/session
- 庫存檢查：新數量不得超過商品庫存
- 數量為絕對值設定（直接取代，非增減）

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | quantity 不是正整數 |
| 400 | STOCK_INSUFFICIENT | 數量超過庫存 |
| 404 | NOT_FOUND | 品項不存在或非本人所有 |

### DELETE /api/cart/:itemId — 移除品項

**行為描述**：從購物車移除指定品項。

**業務邏輯**：
- 所有權檢查：品項必須屬於當前使用者/session
- 無批次刪除（清空購物車需逐一刪除）

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 404 | NOT_FOUND | 品項不存在或非本人所有 |

---

## 訂單管理

> **認證模式**：全部需要 JWT（authMiddleware），不支援訪客下單。

### POST /api/orders — 建立訂單

**行為描述**：將購物車品項轉換為訂單，並依配送選項計算運費。使用資料庫 transaction 確保「建立訂單 + 品項快照 + 扣庫存 + 清空購物車」的原子性。

**Request Body**：

| 欄位 | 型別 | 必填 | 驗證規則 |
|------|------|------|----------|
| recipientName | string | 是 | 非空 |
| recipientEmail | string | 是 | 符合 email 正則 |
| recipientAddress | string | 是 | 非空；超商取貨時填取貨門市地址。伺服器依此判定是否為偏遠地區 |
| shippingMethod | string | 否 | `home_delivery`（預設）或 `cvs_pickup` |
| isUrgent | boolean | 否 | 是否當日急件，預設 `false`；必須為布林值 |

> 前端**無法**自行宣告偏遠地區（即使送出 `isRemoteArea` 也會被忽略），一律由伺服器依 `recipientAddress` 判定，避免顧客規避附加費。

**業務邏輯**：
1. 驗證收件人三個欄位皆存在
2. 驗證 recipientEmail 格式
3. 以 `parseShippingOptions()` 驗證 `shippingMethod` / `isUrgent` 並套用預設值
4. 從 `cart_items JOIN products` 取得購物車品項（僅查 `user_id`，不含 session）
5. 購物車為空 → 400 CART_EMPTY
6. 逐品項檢查庫存，不足者收集名稱 → 400「以下商品庫存不足：名稱1, 名稱2」
7. 計算商品小計 `subtotal = Σ(price × quantity)`
8. 呼叫 `calculateShipping({ subtotal, shippingMethod, isRemoteArea: isRemoteAddress(recipientAddress), isUrgent })` 取得運費與總額（規則見[配送運費](#配送運費)）
9. 生成 `orderNo = ORD-YYYYMMDD-{5碼UUID大寫}`
10. **Transaction**：INSERT order（含 `subtotal_amount`、`shipping_method`、`shipping_fee`、`is_remote_area`、`is_urgent`、`total_amount = 小計 + 運費`）→ INSERT order_items（快照名稱+價格） → UPDATE stock → DELETE cart_items
11. 回傳 201 + 訂單詳情

**回應範例**（宅配、小計 1,500、離島地址、當日急件）：

```json
{
  "data": {
    "id": "uuid",
    "order_no": "ORD-20261107-A1B2C",
    "subtotal_amount": 1500,
    "shipping_method": "home_delivery",
    "shipping_fee": 450,
    "is_remote_area": 1,
    "is_urgent": 1,
    "total_amount": 1950,
    "status": "pending",
    "items": [{ "product_name": "紫色鬱金香盆栽", "product_price": 750, "quantity": 2 }],
    "created_at": "2026-11-07 13:00:00"
  },
  "error": null,
  "message": "訂單建立成功"
}
```

> `is_remote_area` / `is_urgent` 直接映射 SQLite 欄位，故為整數 `0` / `1`。

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | 缺少收件人欄位 |
| 400 | VALIDATION_ERROR | Email 格式不正確 |
| 400 | VALIDATION_ERROR | `shippingMethod` 不是 `home_delivery` / `cvs_pickup` |
| 400 | VALIDATION_ERROR | `isUrgent` 不是布林值 |
| 400 | CART_EMPTY | 購物車為空 |
| 400 | STOCK_INSUFFICIENT | 庫存不足（訊息中列出所有不足商品名稱） |

### GET /api/orders — 訂單列表

**行為描述**：回傳當前使用者的所有訂單，依建立時間降序排列。無分頁。

**回應欄位**：id, order_no, total_amount, status, created_at

### GET /api/orders/:id — 訂單詳情

**行為描述**：回傳訂單完整資訊（含品項列表與運費欄位 `subtotal_amount`、`shipping_method`、`shipping_fee`、`is_remote_area`、`is_urgent`）。僅能查看自己的訂單。

**業務邏輯**：
- 查詢條件含 `user_id`，他人訂單視為 404
- order_items 中的 product_name / product_price 為下單時快照
- 運費相關欄位亦為下單時快照，日後調整費率不影響既有訂單
- 運費功能上線前的舊訂單：`shipping_method` 為 `null`、`shipping_fee` 為 `0`、`subtotal_amount` 已回填為 `total_amount`

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 404 | NOT_FOUND | 訂單不存在或非本人所有 |

### PATCH /api/orders/:id/pay — 模擬付款（開發除錯用）

**行為描述**：模擬付款結果，更新訂單狀態。不涉及真實金流，保留作為開發除錯工具。正式付款流程請使用綠界金流。

**Request Body**：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| action | string | 是 | `"success"` → 狀態改 paid；`"fail"` → 狀態改 failed |

**業務邏輯**：
- 訂單狀態機：`pending → paid` 或 `pending → failed`（不可逆）
- 僅能操作自己的訂單
- 非 pending 狀態的訂單無法付款

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | action 不是 success 或 fail |
| 400 | INVALID_STATUS | 訂單狀態不是 pending |
| 404 | NOT_FOUND | 訂單不存在或非本人所有 |

---

## 配送運費

> 運費邏輯集中於 `src/utils/shipping.js`（純函式、無外部依賴），建立訂單、運費試算 API 與前台頁面的費率文案皆以此為唯一來源。

### 運費規則

| 項目 | 金額 | 說明 |
|------|------|------|
| 宅配基本運費 | 120 | `shippingMethod = home_delivery` |
| 超商取貨 | 60 | `shippingMethod = cvs_pickup`；**不是基本運費**，滿額不免除 |
| 滿額免運 | -120 | 商品小計 **≥ 1,500** 免除「宅配基本運費」（1,499 仍收 120） |
| 偏遠地區 | +200 | 依收件地址判定為離島時加收 |
| 當日急件 | +250 | `isUrgent = true` 時加收 |

計算公式：

```
運費     = 配送方式費用（宅配 120 / 宅配滿額 0 / 超商 60）+ 偏遠地區附加費 + 當日急件附加費
訂單總額 = 商品小計 + 運費
```

- 附加費彼此獨立、可疊加，不受配送方式或滿額免運影響（滿額只免基本運費）

### 計算範例

| 情境 | 小計 | 配送 | 偏遠 | 急件 | 運費 | 總額 |
|------|------|------|------|------|------|------|
| 宅配基本運費 | 1,000 | 宅配 | | | 120 | 1,120 |
| 超商取貨 | 1,000 | 超商 | | | 60 | 1,060 |
| 未達免運門檻 | 1,499 | 宅配 | | | 120 | 1,619 |
| 剛好達免運門檻 | 1,500 | 宅配 | | | 0 | 1,500 |
| 超商滿額不免 | 1,500 | 超商 | | | 60 | 1,560 |
| 偏遠地區 | 1,000 | 宅配 | ✓ | | 320 | 1,320 |
| 當日急件 | 1,000 | 宅配 | | ✓ | 370 | 1,370 |
| 多項附加費 | 1,000 | 宅配 | ✓ | ✓ | 570 | 1,570 |
| 滿額免運 + 附加費 | 1,500 | 宅配 | ✓ | ✓ | 450 | 1,950 |

### 偏遠地區判定

收件地址（去除空白後）包含 `REMOTE_AREA_KEYWORDS` 任一名稱即視為偏遠地區：

| 地區 | 名稱 |
|------|------|
| 縣級 | 澎湖縣、金門縣、連江縣 |
| 澎湖 | 馬公市、湖西鄉、白沙鄉、西嶼鄉、望安鄉、七美鄉 |
| 金門 | 金城鎮、金湖鎮、金沙鎮、金寧鄉、烈嶼鄉、烏坵鄉 |
| 連江（馬祖） | 南竿鄉、北竿鄉、莒光鄉、東引鄉 |
| 臺東 | 綠島鄉、蘭嶼鄉 |
| 屏東 | 琉球鄉 |

- 刻意使用完整縣／鄉鎮名稱，不用「金門」「澎湖」等短詞，避免誤判「台北市金門街」「新北市土城區金城路」這類以地名命名的街道
- 判定由伺服器執行，前端無法覆寫
- 地址為自由文字，若僅填村里名（如「馬祖南竿介壽村」未寫「南竿鄉」）可能判定不到；如需更嚴謹，建議日後改為結構化的縣市／鄉鎮欄位

### Shipping 工具模組（src/utils/shipping.js）

| 匯出 | 說明 |
|------|------|
| `SHIPPING_METHODS` | `{ HOME_DELIVERY: 'home_delivery', CVS_PICKUP: 'cvs_pickup' }` |
| `SHIPPING_RATES` | `HOME_DELIVERY_FEE`、`CVS_PICKUP_FEE`、`FREE_SHIPPING_THRESHOLD`、`REMOTE_AREA_SURCHARGE`、`URGENT_SURCHARGE` |
| `REMOTE_AREA_KEYWORDS` | 偏遠地區判定清單 |
| `isValidShippingMethod(method)` | 是否為支援的配送方式 |
| `isRemoteAddress(address)` | 依地址判定是否為偏遠地區（非字串回傳 `false`） |
| `parseShippingOptions({ shippingMethod, isUrgent })` | 驗證 request body 並套用預設值，回傳 `{ value }` 或 `{ error }` |
| `calculateShipping({ subtotal, shippingMethod, isRemoteArea, isUrgent })` | 回傳 `{ shippingMethod, subtotal, deliveryFee, remoteAreaFee, urgentFee, shippingFee, isFreeShipping, isRemoteArea, isUrgent, totalAmount }`；參數不合法時拋出 `TypeError` |

### POST /api/shipping/quote — 運費試算

**行為描述**：公開端點，供購物車／結帳頁即時顯示運費明細。不建立任何資料；實際下單時 `POST /api/orders` 會以購物車內容在伺服器端重新計算。

**認證**：無

**Request Body**：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| subtotal | integer | 是 | 商品小計，非負整數 |
| shippingMethod | string | 否 | `home_delivery`（預設）/ `cvs_pickup` |
| isUrgent | boolean | 否 | 預設 `false` |
| recipientAddress | string | 否 | 用於判定偏遠地區；未提供視為非偏遠地區 |

**回應結構**：

```json
{
  "data": {
    "shipping_method": "home_delivery",
    "subtotal": 1500,
    "delivery_fee": 0,
    "remote_area_fee": 200,
    "urgent_fee": 250,
    "shipping_fee": 450,
    "is_free_shipping": true,
    "is_remote_area": true,
    "is_urgent": true,
    "total_amount": 1950,
    "free_shipping_threshold": 1500
  },
  "error": null,
  "message": "試算成功"
}
```

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | `subtotal` 缺少或不是非負整數 |
| 400 | VALIDATION_ERROR | `shippingMethod` 不合法 |
| 400 | VALIDATION_ERROR | `isUrgent` 不是布林值 |

### 前台頁面

| 頁面 | 行為 |
|------|------|
| 結帳頁 | 選擇「宅配到府／超商取貨」與「當日急件」；變更選項或地址（輸入停頓 400ms）時呼叫試算 API，摘要逐項列出配送費、偏遠地區加收、當日急件加收與總計；試算中停用「送出訂單」 |
| 購物車頁 | 以預設宅配呼叫試算 API，顯示「再買 NT$ X 即可享宅配免運」與預估總計 |
| 訂單詳情頁（前台／後台） | 顯示商品小計、運費（配送方式）、偏遠地區／當日急件標籤與總計；舊訂單僅顯示總計 |
| 首頁、商品詳情頁 | 免運門檻與急件費用文案由 `SHIPPING_RATES` 伺服器端渲染 |

---

## 綠界金流串接（ECPay AIO）

> **認證模式**：付款查詢需 JWT（authMiddleware）；付款頁面路由為公開（orderId 為 UUID 不可猜測）。

### 整體付款流程

```
結帳送出訂單 → POST /api/orders 建立訂單（含 merchant_trade_no）
  → 前端導向 GET /ecpay/payment/:orderId
  → Server 產生 ECPay 參數 + CheckMacValue → 回傳自動送出 HTML 表單
  → 瀏覽器 POST 至綠界付款頁 → 使用者完成付款
  → 綠界透過 ClientBackURL 導回 /orders/:orderId?payment=pending
  → 使用者點擊「查詢付款狀態」或頁面自動觸發查詢
  → POST /api/orders/:id/check-payment → Server 呼叫 QueryTradeInfo API
  → 驗證成功則更新訂單狀態為 paid
```

### GET /ecpay/payment/:orderId — 綠界付款頁面

**行為描述**：產生包含所有 ECPay AIO 參數的 HTML 表單，瀏覽器載入後自動 POST 至綠界付款頁面，將使用者導向綠界完成付款。

**業務邏輯**：
- 從 DB 讀取訂單與品項資訊
- 訂單不存在 → 404
- 訂單狀態非 pending → 302 重導至訂單詳情頁
- 產生 ECPay 所需參數：MerchantID、MerchantTradeNo、MerchantTradeDate（台灣時區）、TotalAmount（= 訂單 `total_amount`，**已含運費**）、ItemName（商品名稱以 `#` 連接，上限 400 bytes；運費大於 0 時附加「運費 x1」）等
- 計算 CheckMacValue（SHA256，ECPay 專用 URL 編碼）
- 設定 ClientBackURL 為 `/orders/:orderId?payment=pending`（付款後瀏覽器導回）
- 設定 ReturnURL 為 `${BASE_URL}/ecpay/notify`（本地端不會被呼叫，但為必填欄位）
- 回傳 Content-Type: text/html，瀏覽器自動送出表單

**ECPay 參數**：

| 參數 | 值 | 說明 |
|------|------|------|
| MerchantID | 環境變數 `ECPAY_MERCHANT_ID` | 測試：3002607 |
| MerchantTradeNo | 訂單的 `merchant_trade_no` | 由 order_no 去除連字號產生，最多 20 字元 |
| PaymentType | `aio` | 固定值 |
| ChoosePayment | `ALL` | 顯示所有付款方式 |
| EncryptType | `1` | SHA256 |

### POST /api/orders/:id/check-payment — 查詢綠界付款狀態

**行為描述**：透過綠界 QueryTradeInfo API 主動查詢付款結果。因本專案運行於本地端，無法接收綠界 Server Notify，故以此端點替代。

**認證**：JWT（authMiddleware）

**業務邏輯**：
1. 查詢訂單（驗證 user_id 與訂單存在）
2. 訂單已非 pending → 直接回傳現有狀態
3. 訂單無 `merchant_trade_no` → 400
4. 呼叫綠界 `POST /Cashier/QueryTradeInfo/V5`（TimeStamp 每次重新產生，有效期 3 分鐘）
5. 驗證回應中的 CheckMacValue
6. `TradeStatus === '1'` → 更新訂單狀態為 `paid`，回傳成功
7. 其他 TradeStatus → 回傳「尚未完成付款」

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | NO_TRADE_NO | 訂單無綠界交易編號 |
| 404 | NOT_FOUND | 訂單不存在或非本人所有 |
| 500 | ECPAY_QUERY_ERROR | 呼叫綠界 API 失敗 |

### ECPay 工具模組（src/utils/ecpay.js）

提供以下核心函式：

| 函式 | 說明 |
|------|------|
| `ecpayUrlEncode(str)` | ECPay 專用 URL 編碼（.NET 相容規則） |
| `generateCheckMacValue(params, hashKey, hashIV)` | 產生 SHA256 簽章 |
| `verifyCheckMacValue(params, hashKey, hashIV)` | 時序安全驗證簽章（crypto.timingSafeEqual） |
| `getMerchantTradeDate()` | 產生台灣時區日期字串（yyyy/MM/dd HH:mm:ss） |
| `buildAioFormHtml(order, items, config)` | 產生自動送出的 ECPay 付款表單 HTML |
| `queryTradeInfo(merchantTradeNo, config)` | 呼叫 QueryTradeInfo API 查詢交易狀態 |

### 測試資訊

| 項目 | 值 |
|------|------|
| 測試 MerchantID | 3002607 |
| 測試信用卡 | 4311-9522-2222-2222 |
| CVV | 任意三碼 |
| 到期日 | 任意未來日期 |
| 3D 驗證碼 | 1234 |

---

## 後台商品管理

> **認證模式**：全部需要 JWT + admin 角色（authMiddleware + adminMiddleware）。

### GET /api/admin/products — 商品列表

**行為描述**：與公開商品列表相同邏輯，但需管理員權限。分頁參數同上。

### POST /api/admin/products — 新增商品

**Request Body**：

| 欄位 | 型別 | 必填 | 驗證規則 |
|------|------|------|----------|
| name | string | 是 | 非空 |
| price | integer | 是 | 正整數（> 0） |
| stock | integer | 是 | 非負整數（≥ 0） |
| description | string | 否 | 未提供則為 null |
| image_url | string | 否 | 未提供則為 null |

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | name 為空 |
| 400 | VALIDATION_ERROR | price 不是正整數 |
| 400 | VALIDATION_ERROR | stock 不是非負整數 |

### PUT /api/admin/products/:id — 編輯商品

**行為描述**：部分更新商品。僅提供的欄位會被更新，未提供的保留原值。更新時自動設定 `updated_at = datetime('now')`。

**Request Body**：所有欄位皆為選填，驗證規則同新增。

**額外驗證**：
- name 若提供但為空字串 → 400「商品名稱不能為空」

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 404 | NOT_FOUND | 商品不存在 |
| 400 | VALIDATION_ERROR | 欄位驗證失敗 |

### DELETE /api/admin/products/:id — 刪除商品

**行為描述**：刪除商品。若商品存在於 pending 狀態的訂單中，則拒絕刪除。

**業務邏輯**：
- 查詢 `order_items JOIN orders` 計算 pending 訂單中包含此商品的數量
- `count > 0` → 409 CONFLICT
- paid / failed 訂單不會阻擋刪除（因品項已快照）

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 404 | NOT_FOUND | 商品不存在 |
| 409 | CONFLICT | 商品存在未完成訂單，無法刪除 |

---

## 後台訂單管理

### GET /api/admin/orders — 訂單列表

**行為描述**：回傳所有使用者的訂單，支援分頁與狀態篩選。

**Query 參數**：

| 參數 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| page | integer | 1 | 頁碼 |
| limit | integer | 10 | 每頁筆數（1~100） |
| status | string | 無 | 篩選：`pending` / `paid` / `failed`，其他值忽略 |

**業務邏輯**：
- status 參數使用白名單驗證：只接受 `['pending', 'paid', 'failed']`，其他值視為未提供
- 回傳所有訂單欄位（含 user_id, recipient_name, recipient_email）

### GET /api/admin/orders/:id — 訂單詳情

**行為描述**：回傳訂單完整資訊，額外包含下單使用者的 name 和 email。無所有權限制。

**回應額外欄位**（另含運費欄位 `subtotal_amount`、`shipping_method`、`shipping_fee`、`is_remote_area`、`is_urgent`）：
```json
{
  "user": {
    "name": "使用者名稱",
    "email": "user@example.com"
  }
}
```

**錯誤情境**：

| 狀態碼 | 錯誤碼 | 情境 |
|--------|--------|------|
| 404 | NOT_FOUND | 訂單不存在 |
