import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // tests/e2e 由 Playwright 執行，不納入 Vitest
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    // 測試專用環境變數（會覆蓋 .env；dotenv 不會覆寫已存在的變數）：
    // - DB_PATH=':memory:'：每個測試檔在獨立的 worker 載入 app，各自擁有一份全新的
    //   記憶體資料庫（含種子資料），測試結束即消失，不會動到專案的 database.sqlite
    // - JWT_SECRET / ADMIN_*：讓測試不依賴本機 .env 也能執行
    env: {
      DB_PATH: ':memory:',
      NODE_ENV: 'test',
      JWT_SECRET: 'vitest-only-jwt-secret',
      ADMIN_EMAIL: 'admin@hexschool.com',
      ADMIN_PASSWORD: '12345678',
    },
    fileParallelism: false, // 檔案循序執行（各檔資料庫已隔離，主要是避免 bcrypt 搶 CPU）
    hookTimeout: 10000,
  },
});
