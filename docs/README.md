# 花卉電商網站（backend-project）

[![Tests](https://github.com/z58occc/2026-ai-adv-homework-course02/actions/workflows/test.yml/badge.svg)](https://github.com/z58occc/2026-ai-adv-homework-course02/actions/workflows/test.yml)

花卉電商全端應用，提供前台商品瀏覽、購物車、訂單管理、配送運費計算與綠界金流付款，以及後台商品與訂單管理功能。支援訪客購物車（X-Session-Id）與會員登入（JWT）雙模式。

### 配送運費一覽

| 項目 | 費用 |
|------|------|
| 宅配基本運費 | NT$ 120（商品小計滿 NT$ 1,500 免基本運費） |
| 超商取貨 | NT$ 60（非基本運費，滿額不免） |
| 偏遠地區（離島） | 加收 NT$ 200 |
| 當日急件 | 加收 NT$ 250 |

規則實作於 `src/utils/shipping.js`，詳見 [FEATURES.md › 配送運費](./FEATURES.md#配送運費)。

## 技術棧

| 分類 | 技術 | 版本 |
|------|------|------|
| 執行環境 | Node.js | — |
| Web 框架 | Express | ~4.16.1 |
| 資料庫 | SQLite（better-sqlite3） | ^12.8.0 |
| 模板引擎 | EJS | ^5.0.1 |
| CSS 框架 | Tailwind CSS | ^4.2.2 |
| 認證 | JSON Web Token（jsonwebtoken） | ^9.0.2 |
| 密碼雜湊 | bcrypt | ^6.0.0 |
| ID 生成 | uuid（v4） | ^11.1.0 |
| CORS | cors | ^2.8.5 |
| 環境變數 | dotenv | ^16.4.7 |
| API 文件 | swagger-jsdoc | ^6.2.8 |
| 測試框架 | Vitest | ^2.1.9 |
| HTTP 測試 | supertest | ^7.2.2 |
| E2E 測試 | Playwright（@playwright/test） | ^1.65.0 |

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數
cp .env.example .env
# 編輯 .env，至少設定 JWT_SECRET

# 3. 啟動伺服器（含 CSS 編譯）
npm run start
# 伺服器預設在 http://localhost:3001

# 4. 開發模式（分別啟動）
npm run dev:server   # 啟動 Express 伺服器
npm run dev:css      # Tailwind CSS watch 模式

# 5. 執行測試
npm run test:unit          # 單元測試
npm run test:integration   # 整合測試（記憶體 SQLite，不動 database.sqlite）
npx playwright install chromium   # 首次執行 E2E 前安裝瀏覽器
npm run test:e2e           # E2E（需先 npm run start，會走綠界 Staging 付款）

# 6. 生成 OpenAPI 文件與 Postman Collection
npm run openapi
npm run postman
```

### 預設帳號

| 角色 | Email | 密碼 |
|------|-------|------|
| 管理員 | admin@hexschool.com | 12345678 |

管理員帳號在伺服器首次啟動時自動建立（可透過 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 環境變數自訂）。

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm run start` | 編譯 CSS + 啟動伺服器 |
| `npm run dev:server` | 僅啟動伺服器 |
| `npm run dev:css` | Tailwind CSS watch 模式 |
| `npm run css:build` | 編譯並壓縮 CSS |
| `npm run test` | 單元 + 整合測試 |
| `npm run test:unit` | 單元測試（`tests/unit/`） |
| `npm run test:integration` | 整合測試（`tests/integration/`，記憶體 SQLite） |
| `npm run test:e2e` | Playwright E2E（測試已啟動的 `http://localhost:3001`） |
| `npm run openapi` | 生成 openapi.json |
| `npm run postman` | 生成 openapi.json 並轉為 `postman/flower-shop.postman_collection.json` |

push 或對 `main` 開 Pull Request 時，GitHub Actions（`.github/workflows/test.yml`）會自動執行 `test:unit` 與 `test:integration`。

## 文件索引

| 文件 | 說明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架構、目錄結構、資料流 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 開發規範、命名規則、計畫歸檔流程 |
| [FEATURES.md](./FEATURES.md) | 功能列表與完成狀態（含行為描述） |
| [TESTING.md](./TESTING.md) | 測試規範與指南 |
| [CHANGELOG.md](./CHANGELOG.md) | 更新日誌 |
| [plans/](./plans/) | 開發計畫目錄 |
| [plans/archive/](./plans/archive/) | 已完成計畫歸檔 |
