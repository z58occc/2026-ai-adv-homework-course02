---
name: e2e-payment-test
description: 以瀏覽器自動化（Playwright MCP）對花卉電商執行綠界（ECPay）金流的端對端測試：從商品頁、購物車、註冊登入、結帳、前往綠界付款到訂單狀態確認，並涵蓋付款失敗、未完成付款、欄位驗證錯誤等異常情境。當使用者要求「跑 E2E」「測試金流」「測試結帳流程」「驗證綠界付款」時使用。
---

# 綠界金流 E2E 測試

## 測試目標

驗證本專案「選商品 → 加入購物車 → 登入 → 結帳 → 綠界付款 → 訂單狀態更新」整條流程可正常運作，並驗證異常情境的畫面與狀態是否符合預期。

涵蓋範圍：前台頁面（`/`、`/products/:id`、`/cart`、`/login`、`/checkout`、`/orders`、`/orders/:id`）、`/ecpay/payment/:orderId`、綠界 Staging 收銀台。不涵蓋後台管理頁。

## 開跑前必須知道的事

1. **只能打綠界 Staging**。開跑前以下列指令確認，只會印出布林值，不會洩漏任何金鑰：
   ```bash
   node -e "require('dotenv').config();console.log('isStaging =', require('./src/utils/ecpay').ECPAY_CONFIG.isStaging)"
   ```
   結果不是 `isStaging = true` 就**立即停止**，不得繼續，並回報使用者。
2. **不要讀取或輸出 `.env`**。需要的設定由伺服器自行載入；測試中不得把任何金鑰、Token 貼進回報。
3. **`/ecpay/notify`（綠界背景通知）在本專案沒有處理程式，且 localhost 本來就收不到綠界通知**。訂單變成 `paid` 的唯一途徑是訂單詳情頁的「查詢付款狀態」（`POST /api/orders/:id/check-payment`，會主動向綠界 QueryTradeInfo 查詢）。因此付款後必須走這條路徑驗證，不要等自動變更。
4. **登入時不會合併訪客購物車**（`cartRoutes.js` 以 JWT 優先、否則 `X-Session-Id`）。若先以訪客加入購物車再登入，登入後購物車是空的。**測試必須先登入，再加入購物車**。這是現況行為，見 TC-12。
5. **會寫入真實開發資料庫**（專案根目錄 `database.sqlite`）：新增使用者、訂單、並扣庫存，且沒有刪除 API。開跑前先備份，結束後詢問使用者是否還原。
   **不可直接 `cp database.sqlite`**：資料庫是 WAL 模式，資料多半在 `-wal` 檔，單拷主檔只有數 KB 且不完整。改用 SQLite 官方備份（伺服器執行中也可安全備份）：
   ```bash
   node -e "
   const D=require('better-sqlite3');const db=new D('database.sqlite',{readonly:true});
   db.backup(process.argv[1]).then(()=>{const c=t=>db.prepare('select count(*) n from '+t).get().n;
   console.log('backup ok; users',c('users'),'orders',c('orders'));}).catch(e=>{console.error(e.message);process.exit(1)});
   " "$SCRATCH/database.sqlite.bak"   # SCRATCH 為本次工作階段的暫存目錄；須印出 backup ok 才算成功
   ```
6. 測試帳號一律用 `e2e+<時間戳>@example.com`，密碼 `Test1234`，姓名 `E2E 測試`，避免與既有資料衝突。

## 使用的工具與對應指令

使用 Playwright MCP（`.mcp.json` 已註冊 `playwright`）。這些工具為延遲載入，第一次使用前先用 ToolSearch 載入：`select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_type,mcp__playwright__browser_fill_form,mcp__playwright__browser_wait_for,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_evaluate,mcp__playwright__browser_console_messages,mcp__playwright__browser_network_requests,mcp__playwright__browser_resize,mcp__playwright__browser_close`

| 動作 | 工具 |
|---|---|
| 開頁面 | `browser_navigate` |
| 取得可操作元素（ref） | `browser_snapshot`（**每次操作前先取，ref 會變**） |
| 點擊 | `browser_click`（帶 snapshot 的 ref） |
| 輸入文字 / 填表單 | `browser_type` / `browser_fill_form` |
| 等待文字出現或消失 | `browser_wait_for` |
| 讀 localStorage、網址、DOM 值 | `browser_evaluate` |
| 看有無前端錯誤 | `browser_console_messages`（level: error） |
| 驗證 API 呼叫與狀態碼 | `browser_network_requests` |
| 留存證據 | `browser_take_screenshot` |
| 呼叫 API 製造狀態（見 TC-08） | `browser_evaluate` 內用 `apiFetch(...)`（頁面已載入 `api.js`，自動帶 JWT） |
| 切換視窗尺寸 | `browser_resize` |
| 一次執行多步驟（較快） | `browser_run_code_unsafe`（傳入 `page`，可用 `page.getByRole` / `getByPlaceholder` 等） |

綠界收銀台是第三方頁面，欄位名稱與版面可能改版，**一律先 `browser_snapshot` 看實際欄位再操作**，不要硬寫選擇器。

### 操作注意事項（實跑踩過的坑）

- **snapshot 的 ref 每次都會變**（如 `f1e25` → `f6e25`），不可沿用舊 ref，否則出現 `Ref … not found`。用 `browser_run_code_unsafe` 搭配 `getByRole`/`getByPlaceholder` 可避開此問題。
- **`browser_run_code_unsafe` 之間不共用變數**（`globalThis` 不保留）。需要跨呼叫沿用的東西（訂單 ID、帳號）要寫在回傳值裡自己帶著，或用 `page.context().browser().contexts()` 找回先前開的環境。
- **會觸發整頁導向的操作，先取回應本文再導走**：`response.json()` 在頁面已離開後會失敗（`Response body is not available`）。若來不及，改以唯讀資料庫查詢確認結果。
- **不要在「預期回 401」的頁面使用 `waitForResponse`**：`api.js` 遇 401 會整頁重新載入，腳本可能卡住超過 2 分鐘。改用 `browser_network_requests` 事後檢查。
- **`browser_take_screenshot` 的 `filename` 只能在專案目錄內**（寫到暫存目錄會被拒絕；給相對檔名會落在專案根目錄）。截圖僅作為除錯用，**結束時必須刪除**，且不得提交。
- **新增「訪客」環境**：用 `page.context().browser().newContext()` 開全新環境（不帶 localStorage），測完要 `close()`。
- 讀 `browser_snapshot` 時，綠界頁面有數百個國家選項，輸出很長；只需要欄位時優先用 `browser_evaluate` 取值。

## 環境準備

1. 確認 `.env` 已存在（只檢查檔案是否存在，不讀內容）：`test -f .env && echo ok`。
2. **先檢查 3001 埠是否已有伺服器**：`lsof -nP -iTCP:3001 -sTCP:LISTEN`。
   - 已有（常是使用者自己開的開發伺服器）：**直接使用，不要結束它**，也不要再啟動第二個（會因 `EADDRINUSE` 退出）。
   - 沒有：編譯 CSS 並啟動（背景執行）：`npm run start`，等到輸出 `Server running on port 3001`；此時這是你啟動的程序，結束時才可關閉。
3. `curl -s -o /dev/null -w "%{http_code}" localhost:3001/` 應為 `200`。
4. `browser_resize` 設為 1440×900。

## 測試步驟與預期結果

### A. 正常流程

**TC-01 註冊並登入**
1. 開 `/login`，切到「註冊」，填姓名、Email、密碼（`Test1234`），按「註冊」。
2. 預期：出現「註冊成功」提示；導向 `/`；導覽列右側顯示使用者姓名與「登出」；「我的訂單」連結出現。
3. `browser_evaluate`：`localStorage.getItem('flower_token')` 非空。

**TC-02 商品頁與加入購物車**
1. 在 `/` 點任一商品卡進入 `/products/:id`。記下商品名、單價、庫存。
2. 預期：麵包屑顯示「商品列表 > 商品名」；價格吊牌、「尚有 N 件現貨」、數量選擇器、「加入購物車」皆在。
3. 按數量「+」一次（數量變 2），按「加入購物車」。
4. 預期：提示「已加入購物車」；導覽列購物車徽章數字 +1；`browser_network_requests` 中 `POST /api/cart` 為 200 或 201。

**TC-03 購物車**
1. 開 `/cart`。
2. 預期：列出該商品、單價、數量 2、小計＝單價×2；摘要「商品小計」「運費」「總計」正確。
3. 運費規則：小計 ≥ 500 顯示「免運」且頂部為綠色「已達免運門檻」；< 500 顯示 `NT$ 150`，頂部提示還差多少免運。

**TC-04 建立訂單**
1. 按「前往結帳」，到 `/checkout`。
2. 預期：右側摘要與購物車一致。
3. 填收件人姓名 `林小花`、Email `flower@example.com`、地址 `台北市大安區花園路 88 號 3 樓`，按「送出訂單」。
4. 預期：提示「訂單已建立，正在前往付款...」；`POST /api/orders` 回 201；隨後導向 `/ecpay/payment/:orderId`。
5. 因為頁面立即導走，通常讀不到回應本文。以唯讀資料庫確認訂單已建立，並記下訂單 ID 與 `merchant_trade_no`：
   ```bash
   node -e "const D=require('better-sqlite3');const db=new D('database.sqlite',{readonly:true});
   console.log(db.prepare(\"select o.id,o.order_no,o.total_amount,o.status,o.merchant_trade_no from orders o join users u on u.id=o.user_id where u.email like 'e2e+%' order by o.created_at desc limit 1\").get())"
   ```
   預期 `status = pending`、`total_amount` 等於購物車總計、庫存已扣除。

**TC-05 導向綠界並完成付款**（以下流程已實測可通）
1. `/ecpay/payment/:orderId` 自動送出表單，網址應切到 `payment-stage.ecpay.com.tw`。若不在 stage 網域，**立即停止**。收銀台上的「訂單編號」應等於 `merchant_trade_no`，品項與金額應與訂單一致。
2. 付款方式預設為「信用卡」「一次付清」。欄位為 `#CCpart1`～`#CCpart4`（卡號四段）、`MM`、`YY`、`CVV`、持卡人姓名、手機號碼、電子信箱。
3. **「您目前正在使用的是綠界科技的付款測試環境…」提示框不是載入時出現，而是在第一次按「立即付款」時才跳出**，且會吃掉那次點擊（沒有報錯，也不會進到下一步）。因此：
   - 不要在填欄位前找它；填完欄位、按下「立即付款」後，若看到該提示框，按「關閉」，**再按一次「立即付款」**。
   - 程式寫法：按「立即付款」後等 1.5 秒；若 `getByText('關閉', { exact: true })` 可見就點掉並重按；之後才會出現步驟 5 的確認對話框。
   - 若不處理，後續等「確定」會逾時（預設 30 秒）。
4. **必須逐鍵輸入**（`locator.click()` 後 `fill('')` 再 `pressSequentially(值, { delay: 40～60 })`）。直接 `fill` 不會觸發綠界的驗證，畫面雖有值卻顯示「請輸入信用卡卡號」且送不出。
   - 卡號 `4311-9522-2222-2222`、有效期限 `12` / `30`、安全碼 `222`、持卡人姓名 `WANG XIAO MING`、手機 `0987654321`、信箱 `ecpay@ecpay.com.tw`（綠界公開測試值；以綠界官方測試文件為準）。
5. 按「立即付款」→ 出現確認對話框「您確定使用信用卡，支付此筆訂單金額(新台幣)…」，金額必須等於訂單總額，再按「確定」。
6. 進入模擬 3D 驗證頁（`cc-stage.ecpay.com.tw`）：**必須先按「取得 OTP 服務密碼」`#GetOTPPwd`**，OTP 輸入框 `#OTP` 才會顯示（未按時 `#OTP` 存在於 DOM 但不可見，點擊會逾時 30 秒）。接著逐鍵輸入 `1234`，按送出 `#OTPSend`。
   ```js
   await page.locator('#GetOTPPwd').click();
   await page.locator('#OTP').waitFor({ state: 'visible' });
   await page.locator('#OTP').pressSequentially('1234', { delay: 60 });
   await page.locator('#OTPSend').click();
   ```
7. 出現「付款成功」頁（訂單編號、金額應與訂單相符），按「返回商店」。
8. 預期：回到 `/orders/:id?payment=pending`；頁面因 `payment=pending` 且狀態仍為待付款而**自動執行一次**「查詢付款狀態」。
9. 主控台出現 `Framing 'https://www.facebook.com/' violates … Content Security Policy` 為綠界頁面自身的第三方嵌入錯誤，**與本專案無關，忽略**。

**TC-06 訂單狀態確認**
1. 若頁面仍顯示「待付款」，手動按「查詢付款狀態」。
2. 預期：`POST /api/orders/:id/check-payment` 回 200，訊息「付款成功」；狀態標籤變為綠色「已付款」；頂部出現「付款成功！感謝您的購買。」；「前往付款」「查詢付款狀態」按鈕消失。
3. 開 `/orders`：該筆訂單狀態為「已付款」，金額與訂單詳情一致。
4. `browser_console_messages` 無前端錯誤（`favicon.ico` 404 為既有現象，可忽略）。

### B. 異常情境

**TC-07 付款未完成**
1. 重新建立一筆訂單（重做 TC-02～04），進入綠界後**不付款**，直接 `browser_navigate` 回 `/orders/:id?payment=pending`。
2. 預期：自動查詢後仍為「待付款」；提示「尚未完成付款，請稍後再查詢」；頂部為黃色「付款處理中，請點擊「查詢付款狀態」確認結果。」；「前往付款」按鈕仍在，可重新付款。

**TC-08 付款失敗**
本專案無法在綠界 Staging 穩定製造「付款失敗」，改以後端模擬 API 設定狀態：
1. 重新建立一筆待付款訂單，到 `/orders/:id`。
2. `browser_evaluate`：`apiFetch('/api/orders/' + location.pathname.split('/').pop() + '/pay', { method: 'PATCH', body: JSON.stringify({ action: 'fail' }) })`，成功後重新載入頁面。
3. 預期：狀態標籤為紅色「付款失敗」；「前往付款」「查詢付款狀態」按鈕不顯示；`/orders` 列表該筆為「付款失敗」。
4. 開 `/ecpay/payment/:orderId`，預期被導回 `/orders/:id`（非待付款不可再付款）。
5. 對同一筆再呼叫 `PATCH .../pay`（任一 action），預期 400，訊息「訂單狀態不是 pending，無法付款」。
6. 此為模擬，驗證的是本站失敗畫面，不是綠界真實失敗回應。另外順手記錄庫存：付款失敗的訂單**目前不會回補庫存**（見「已知問題」O-4）。

**TC-09 付款結果提示橫幅**
對任一訂單開 `/orders/:id?payment=<值>`，預期提示：
- `success` →「付款成功！感謝您的購買。」（綠）
- `failed` →「付款失敗，請重試。」（紅）
- `cancel` →「付款已取消。」（黃）
- `pending` →「付款處理中…」（黃）
- 其他值不顯示橫幅。
- 橫幅**只依網址參數**決定，與訂單實際狀態無關（已付款訂單加 `?payment=failed` 仍會顯示失敗），這是現況，見 O-3。

**TC-10 結帳欄位驗證（前端）**
在 `/checkout`（購物車需有商品）：
1. 三欄全空，按「送出訂單」。預期：三個欄位底線變紅，分別顯示「請輸入收件人姓名」「請輸入 Email」「請輸入收件地址」；**不發出** `POST /api/orders`。
2. Email 填 `abc`，其餘填好。預期：顯示「Email 格式不正確」，不發出請求。
3. 僅姓名空白（填空白字元）。預期：仍顯示「請輸入收件人姓名」（程式有 `trim`）。

**TC-11 登入／註冊驗證**
1. 登入頁兩欄全空按「登入」：預期顯示「請輸入 Email」「請輸入密碼」，不發請求。
2. 註冊密碼填 `12345`：預期顯示「密碼至少 6 個字元」。
3. 以不存在的帳號登入：API 應回 401「Email 或密碼錯誤」，仍停留在 `/login`。**UI 現況**：`api.js` 遇 401 會整頁重新載入，錯誤提示來不及顯示（已知問題 F-1）。驗證方式改為：`browser_network_requests` 確認 `POST /api/auth/login` 回 401，且網址仍為 `/login`；**不要**用 `waitForResponse` 或等提示出現（會卡住或逾時）。若日後修好，應改為預期看到提示。
4. 以已註冊的 Email 再註冊：API 回 409，提示「Email 已被註冊」，仍停留在 `/login`（此情況不經 401，提示可正常顯示）。

**TC-12 購物車與權限邊界**
1. **未登入進結帳**：清除 localStorage 後開 `/checkout`，預期導向 `/login?redirect=%2Fcheckout`。
2. **未登入按「前往結帳」**：訪客在 `/cart` 按「前往結帳」，預期導向 `/login?redirect=/checkout`。
3. **訪客購物車不合併（記錄現況，不判定對錯）**：用 `newContext()` 開訪客環境，加入商品後按「前往結帳」→ 在 `/login?redirect=/checkout` 註冊。目前預期：註冊後被導到 `/cart`，且購物車為空（因為 `/checkout` 發現購物車空而導回）。若實際已合併，代表行為已改，需回報並更新本 Skill。見 F-2。
4. **購物車為空進結帳**：登入後購物車為空時開 `/checkout`，預期被導回 `/cart`；`POST /api/orders` 直接呼叫應回 400，`error: CART_EMPTY`，訊息「購物車為空」。
5. **庫存不足**：加入購物車時就會被擋（`POST /api/cart` 數量超過庫存回 400「庫存不足」，購物車維持空），所以**無法**用 UI 或一般 API 讓購物車超量，進而測不到訂單層的 `STOCK_INSUFFICIENT`。此項記為「略過（購物車層已擋）」；若要測訂單層，需直接改資料庫，**未經使用者同意不得進行**。
6. **他人訂單**：用另一個帳號（可沿用 12.3 註冊的第二帳號）開本帳號訂單的 `/orders/:id`。預期：API 回 404「訂單不存在」，畫面不含收件人、Email、地址。**現況**：頁面主體是空白，只有 3 秒的「載入訂單失敗」提示（見 O-5）。

**TC-13 響應式快速檢查（選做）**
`browser_resize` 為 390×844，重跑 TC-03、TC-04、TC-06 的頁面，預期 `document.documentElement.scrollWidth === clientWidth`（無橫向捲動），按鈕與表單可操作。

## 結果判定與回報

每個 TC 回報 `通過` / `失敗` / `略過（附原因）`，失敗者附：實際畫面截圖、出錯的網路請求（狀態碼與回應訊息）、主控台錯誤。最後給一張總表：

| TC | 結果 | 備註 |
|---|---|---|

另外必須回報：
- 本次建立了哪些測試資料（帳號 Email、訂單編號），以及是否已還原資料庫備份。
- 與 Skill 寫法不一致之處（例如以 `apiFetch` 取代 UI 操作、重用使用者既有伺服器）。
- 「已知問題」各項是否仍成立；以及任何新的「現況與預期不一致」。

## 已知問題（截至首次實跑，修復後請更新本節與對應 TC）

| 編號 | 問題 | 影響的 TC |
|---|---|---|
| F-1 | `public/js/api.js` 遇任何 401（含登入密碼錯誤）會清除 Token 並整頁導回 `/login`，錯誤提示來不及顯示；導回時**也會丟掉網址的 `?redirect=`**，之後註冊／登入會落在 `/` 而非原本要去的頁面 | 11.3、12.3 |
| F-2 | 登入／註冊不會合併訪客購物車，訪客結帳途中註冊後購物車為空 | 12.3 |
| O-3 | 付款結果橫幅只依網址 `?payment=` 決定，與訂單實際狀態無關 | 09 |
| O-4 | 訂單改為付款失敗時不回補庫存（建單時已扣） | 08 |
| O-5 | 開啟他人／不存在的訂單時頁面主體空白，僅短暫提示「載入訂單失敗」 | 12.6 |
| O-6 | `ReturnURL`（`/ecpay/notify`）無處理程式；訂單轉 `paid` 只靠 `check-payment` | 05、06 |

## 結束清理

1. `browser_close` 關閉瀏覽器；用 `newContext()` 開的環境也要 `close()`。
2. 只結束**自己啟動**的伺服器程序。使用者原本就在跑的伺服器（見「環境準備」）**不得結束**。
3. 刪除專案內殘留的截圖與 `.playwright-mcp/`：`rm -rf .playwright-mcp *.png`（先 `git status --short` 確認只刪到本次產生的檔案，勿動 `docs/design/*.png`）。
4. 列出資料庫差異給使用者，再詢問是否以備份還原 `database.sqlite`；未經同意不得覆蓋，且還原前應請使用者先停掉連著該資料庫的伺服器。
   ```bash
   node -e "const D=require('better-sqlite3');const now=new D('database.sqlite',{readonly:true});const bak=new D(process.argv[1],{readonly:true});
   const c=(d,t)=>d.prepare('select count(*) n from '+t).get().n;
   for(const t of ['users','orders','order_items','cart_items','products']) console.log(t,'備份',c(bak,t),'現在',c(now,t));" "$SCRATCH/database.sqlite.bak"
   ```
