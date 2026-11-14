# 自動點擊測試腳本（WO-66／WO-67／WO-69）

本目錄放的是本機自動點擊測試腳本，用來在四種版面（手機直拿、手機橫拿、中等、寬版）檢查「入口走得到」和「新稿另存後再打開，數字與內容還在」。

這些腳本**不是** `npm test` 的一部分，也不會在 Cloudflare 建置時執行。倉庫既有慣例是瀏覽器操作腳本放在 `scripts/`（例如截樣品圖、離線 WebKit 證明）；這批測試產物較多，因此獨立放在 `qa/`，避免和截圖腳本混在一起。

## 裡面有什麼

| 路徑 | 用途 |
|---|---|
| `入口檢查/run.mjs` | WO-66：四種版面走訪各頁入口，確認看得到、按得下去、走得到、回得來 |
| `存檔再開/run.mjs` | WO-67／WO-69：用 App 建立【範例】新稿，另存後再開，核對章節、字數與寫作紀錄 |
| `存檔再開/wo69-甲乙不串稿.mjs` | WO-69 補充：甲、乙兩份新稿與內建範例書的「今天寫了」與統計互不干擾 |

腳本只會在測試中用 App 建立【範例】稿。唯一會讀取的 `.db`，是該趟測試「另存專案」下載到的那一份（寫在 `test-results/`，不會進倉庫）。請不要把真實書稿路徑寫進腳本或環境變數。

## 怎麼跑

先建置並開本機預覽（埠號可改，記得一併改 `BASE`）：

```bash
npm ci
npm run build
npx vite preview --host 127.0.0.1 --port 4173 --strictPort
```

Playwright 不是專案依賴，載入方式與 `scripts/` 目錄既有腳本相同，請設定 `PLAYWRIGHT_MODULE`（指向本機 playwright 套件，例如其 `index.js`）。若瀏覽器執行檔不在 Playwright 預設位置，再設 `CHROMIUM_PATH`。

```bash
export PLAYWRIGHT_MODULE=...   # 本機 playwright 模組路徑
# 若有需要：export CHROMIUM_PATH=...

BASE=http://127.0.0.1:4173 ENGINE=chromium node qa/入口檢查/run.mjs
BASE=http://127.0.0.1:4173 ENGINE=chromium node qa/存檔再開/run.mjs
BASE=http://127.0.0.1:4173 node qa/存檔再開/wo69-甲乙不串稿.mjs
```

也可以把 `BASE` 設成第 3 階段的分支預覽網址（`https://stage3-cards.jiufang-novel-m.pages.dev`），用來測已部署的版本。測尚未上線的本機修改時，請對準本機預覽。

常用環境變數：

- `BASE`：測試網址，預設 `http://127.0.0.1:4173`
- `ENGINE=chromium`：直拿、橫拿、中等改用 Chromium 代測（WebKit 未裝妥時）；報告會註明沒有 WebKit 證據
- `RUN_LABEL` / `RUN_INDEX`：產出資料夾或次數編號
- `QA_DIR`、`OUT_DIR`、`WO66_DIR`、`WO67_DIR`：產出位置；未設時寫入 `test-results/qa/`（已列入 `.gitignore`）
- `LAYOUTS`：`存檔再開/run.mjs` 可只跑部分版面，例如 `LAYOUTS=phone-portrait`

## 不會進倉庫的東西

截圖、結果報告、終端機日誌、測試過程下載的 `.db`，預設都寫到 `test-results/`，根目錄 `.gitignore` 已忽略。請不要把這些檔、真實書稿或任何憑證提交進倉庫。
