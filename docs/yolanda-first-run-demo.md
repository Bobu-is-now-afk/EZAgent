# 首次使用與發票示範（2026-10-10）

## 給示範使用者的五個步驟

1. 開啟 EZAgent，首頁會自動檢查本機 AI。首次下載模型需要網路與數 GB 空間。
2. 若顯示尚未安裝，按「開啟官方安裝頁」，完成圖形安裝後回來按「重新檢查」。
   按「準備本機 AI（允許下載）」啟動引擎及下載模型；看到「本機 AI 已準備好」再繼續。
   系統預設使用 Qwen 3.5，資源較少的電腦會推薦輕量模型。
3. 按「開始發票示範」，再按「使用示範發票」。來源與任務目標會自動填入，不需找檔案。
4. 按「建立計畫」，核對篩選條件與五個處理步驟。勾選確認後按「確認並開始整理」。
5. 看到完成後按「下載並檢視 CSV」。示範結果為 4 列，其中 1 列缺少客戶名稱，會保留標記。

目前只處理發票 CSV／TXT；PDF／XLSX 尚未支援。Builder 是另一個流程設計／規則預覽入口，
不是通用 AI Agent。請只用合成資料示範。首次下載需要網路，完全斷網運作尚未驗證。

## 開發與交付條件

此批次改善的是「App 已可開啟」之後的流程，不包含 Tauri 安裝包。安裝人員仍需先準備
Node 相依套件、Python 3（macOS/Linux 使用 python3；Windows 使用 python）及啟動本機 Node server。
沒有 Python 時畫面會提示修復安裝，不會要求一般使用者輸入指令。
Linux 的 Ollama 官網沒有此專案提供的免指令安裝流程，仍需安裝人員協助。

開發者可使用既有 `npm run build`，再以 `npm run start -- --hostname 127.0.0.1` 啟動。
請保留 scripts/bootstrap_local.py、scripts/bootstrap_ui.py、models.manifest.json、data/demo
與 Node server 在相同專案根目錄，不支援純靜態 hosting。不要讓多個 Node process 共用 .ezagent。

- GET /api/local-ai：純檢查，不啟動服務、不開網頁、不寫入設定。
- POST /api/local-ai：僅同來源 loopback JSON 請求，模型由 manifest 驗證；不接受 host/path/force。
- UI 準備流程不執行 Homebrew 或遠端安裝腳本；安裝由使用者在官方圖形安裝程式完成。
- 一次只允許一個準備工作；引擎等待與模型下載均有逾時，下載失敗不儲存新選擇。
- UI（--json）準備流程以原子方式寫入 .ezagent/config.json，保留其他欄位；損壞或非預設 host 的設定不覆寫。
- 聊天與 Planner 每次請求讀取所選模型；不能在 UI 宣告輕量模型、實際仍呼叫 9B。
- 72B 在 UI/API/腳本皆封鎖；32B 只可明確選擇且需通過硬體檢查。
- 沒有在此工作階段安裝套件／引擎或下載模型。測試用現有 Qwen 3.5 9B。

## 驗證紀錄

- 基底 origin/Yolanda_v1：b87bf73；Agent 還原來源 worker-a/t1-inspection：8bcaad1。
- 14 項 Python 準備流程測試通過：弱機降選、未知硬體、空間不足、缺少引擎、唯讀檢查、封鎖模型、
  下載失敗、設定保留與損壞保護皆有測試。
- 100 項 Agent + Yolanda + local-AI TypeScript 測試通過；型別／未使用符號檢查、production build、git diff --check 通過。
- 可重跑 `sh scripts/check_local.sh`；build 另跑 `npm run build`，均不安裝套件或下載模型。
- 實際 HTTP 跨來源準備請求回傳 403，72B 準備請求回傳 400。
- 首頁及 builder 的繁中／英文準備介面已在瀏覽器確認。
- 實機瀏覽器：首頁偵測現有 Qwen 3.5 9B → 載入合成資料 → 真實模型產生五步計畫 →
  核准執行 → 4 列結果／1 列缺少客戶 → 瀏覽器下載事件成功且預覽顯示 4 列。
- 此專案未配置 ESLint 或其他 lint 工具；沒有新增相依套件。型別與未使用符號檢查不等同 ESLint。
- 缺少引擎／弱機由隔離測試模擬；沒有卸載現有引擎、切斷網路或實測 Windows/Linux。
- 未 commit、push 或建立 PR。合併計畫見 yolanda-agent-merge-plan.md。
