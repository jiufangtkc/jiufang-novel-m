# 九方小說編輯器M

可加到 iPhone 主畫面、可離線打開的網頁小說編輯器。這次是階段 0 與階段 1 的**樣品**：外觀照現有 App，資料全是標了「示範」的假內容，可以真的打字，還沒有匯入電腦版的 `.db`。

給非程式背景的說明在 [docs/階段1樣品報告.md](docs/階段1樣品報告.md)。

## 在自己電腦上看

需要 Node.js 20 或以上。

```bash
npm install
npm test
npm run dev
```

建置正式檔案：

```bash
npm run build
```

產出在 `dist`。

## Cloudflare Pages

接上這個 GitHub 倉庫之後，請這樣填。不需要任何密碼或金鑰。

| 項目 | 值 |
|---|---|
| 建置指令 | `npm run build` |
| 輸出資料夾 | `dist` |
| 正式分支 | `main` |
| Node.js | 20 或以上 |

其他分支的合併請求會各自產生預覽網址。正式網址預定是 `jiufang-novel-m.pages.dev`，要等九方在 Cloudflare 接上之後才算數。

## 字型

畫面使用芫荽（Iansui），來自 [ButTaiwan/iansui](https://github.com/ButTaiwan/iansui) 發行標籤 v1.020，依 SIL Open Font License 1.1 散布。授權全文在 [public/fonts/OFL.txt](public/fonts/OFL.txt)。這是字型自己的授權，不是這個 App 的授權條款。

## 這次沒有做的事

- 不匯入、不匯出 `.db`
- 不做 AI
- 不放任何真實書稿

## 授權

授權：MIT，詳見 LICENSE。
