# 更新日誌

所有重大變更皆記錄於此文件。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

### Added
- 配送運費計算：新增 `src/utils/shipping.js` Shipping 模組（純函式），集中處理宅配基本運費 120、超商取貨 60（非基本運費，滿額不免）、商品小計滿 1,500 免宅配基本運費、偏遠地區（離島）加收 200、當日急件加收 250
- 新增 `POST /api/shipping/quote` 公開 API：結帳／購物車頁即時試算運費明細
- `POST /api/orders` 新增選填參數 `shippingMethod`（`home_delivery` / `cvs_pickup`，預設宅配）與 `isUrgent`（預設 `false`）；偏遠地區由伺服器依收件地址判定
- 訂單新增 `subtotal_amount`、`shipping_method`、`shipping_fee`、`is_remote_area`、`is_urgent` 欄位（migration 會將舊訂單的 `subtotal_amount` 回填為 `total_amount`）
- 新增測試：`tests/shipping.test.js`（Shipping 模組單元測試）、`tests/shippingApi.test.js`（運費 API 與訂單整合測試）
- 綠界 ECPay AIO 金流串接：結帳後導向綠界付款頁面完成真實付款流程
- 新增 `src/utils/ecpay.js` 工具模組：CheckMacValue 簽章產生/驗證、ECPay 專用 URL 編碼、QueryTradeInfo API 查詢
- 新增 `GET /ecpay/payment/:orderId` 頁面路由：產生自動送出的 ECPay 付款表單
- 新增 `POST /api/orders/:id/check-payment` API：透過 QueryTradeInfo API 主動查詢付款狀態（取代本地端無法接收的 Server Notify）
- 訂單新增 `merchant_trade_no` 欄位：對應綠界 MerchantTradeNo，由 order_no 去除連字號產生

### Changed
- 訂單 `total_amount` 改為「商品小計 + 運費」，綠界 `TotalAmount` 隨之含運費，`ItemName` 附加「運費 x1」
- 結帳頁面：新增配送方式（宅配到府／超商取貨）與當日急件選項，訂單摘要逐項顯示配送費與附加費（由試算 API 計算）
- 購物車頁面：免運門檻由 NT$ 500 改為宅配滿 NT$ 1,500，運費改由試算 API 提供，總計改標「預估總計」
- 訂單詳情頁（前台／後台）：顯示商品小計、運費、配送方式與偏遠地區／當日急件標籤
- 首頁、商品詳情頁：免運與急件文案改由 `SHIPPING_RATES` 伺服器端渲染
- `database.js`：orders 後加欄位改用 `addColumnIfNotExists()`（`PRAGMA table_info` 檢查），不再以 try/catch 吞掉 ALTER TABLE 錯誤
- 結帳頁面（checkout.js）：送出訂單後導向綠界付款頁面，不再直接跳轉訂單詳情
- 訂單詳情頁面（order-detail.ejs / order-detail.js）：原「付款成功/失敗」模擬按鈕改為「查詢付款狀態」與「前往付款」按鈕；從綠界導回時自動觸發付款狀態查詢

### Fixed
- 購物車與結帳頁原本寫死「滿 NT$ 500 免運、否則 NT$ 150」，但後端建立訂單時並未收取運費，導致頁面顯示金額與實際付款金額不一致

## [1.0.0] - 2026-04-12

### 新增
- 使用者註冊、登入、個人資料 API
- 商品列表與詳情 API（公開）
- 購物車 CRUD API（雙模式認證：JWT / X-Session-Id）
- 訂單建立、查詢、模擬付款 API
- 後台商品管理 API（CRUD）
- 後台訂單查詢 API（含狀態篩選）
- EJS 前台頁面（首頁、商品詳情、購物車、結帳、訂單）
- EJS 後台頁面（商品管理、訂單管理）
- SQLite 資料庫自動初始化與種子資料
- Vitest 測試套件（6 個測試檔案，循序執行）
- Swagger/OpenAPI 文件生成
- Tailwind CSS 樣式系統
- 專案文件結構建立
