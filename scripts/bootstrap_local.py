#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EZAgent local bootstrap — prepare Ollama + default model + .ezagent config.

Designed for non-technical operators: progress messages are plain language
(Traditional Chinese + English). Prefer running tools from Python rather than
asking the user to copy-paste commands. System installs require --yes.
Does not delete existing .ezagent/ run data.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = REPO_ROOT / "models.manifest.json"
EZAGENT_DIR = REPO_ROOT / ".ezagent"
CONFIG_PATH = EZAGENT_DIR / "config.json"
DEFAULT_MODEL = "qwen3.5:9b"
DEFAULT_HOST = "http://127.0.0.1:11434"
OLLAMA_DOWNLOAD_MAC = "https://ollama.com/download/mac"
OLLAMA_DOWNLOAD_WIN = "https://ollama.com/download/windows"
OLLAMA_DOWNLOAD_LINUX = "https://ollama.com/download/linux"


class BootstrapError(Exception):
    def __init__(self, zh: str, en: str, code: int = 1) -> None:
        super().__init__(zh)
        self.zh = zh
        self.en = en
        self.code = code


def say(zh: str, en: str) -> None:
    print(f"• {zh}")
    print(f"  {en}")


def say_ok(zh: str, en: str) -> None:
    print(f"✓ {zh}")
    print(f"  {en}")


def say_warn(zh: str, en: str) -> None:
    print(f"! {zh}", file=sys.stderr)
    print(f"  {en}", file=sys.stderr)


def detect_os() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "windows":
        return "windows"
    if system == "linux":
        return "linux"
    return system or "unknown"


def load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.is_file():
        return {
            "default_model_id": DEFAULT_MODEL,
            "ollama_host_default": DEFAULT_HOST,
            "models": [
                {
                    "id": DEFAULT_MODEL,
                    "min_ram_gb": 16,
                    "min_disk_gb": 8,
                    "recommended_default": True,
                    "blocked": False,
                    "tier": "default",
                }
            ],
        }
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BootstrapError(
            "模型清單檔案損壞，無法讀取。請向開發者回報 models.manifest.json。",
            "The model allowlist file is corrupted. Please report models.manifest.json to the developer.",
        ) from exc


def pick_model(manifest: dict[str, Any], requested: str | None, force: bool) -> dict[str, Any]:
    models = manifest.get("models") or []
    by_id = {m.get("id"): m for m in models if isinstance(m, dict) and m.get("id")}
    model_id = requested or manifest.get("default_model_id") or DEFAULT_MODEL
    model = by_id.get(model_id)
    if model is None:
        # Still allow the product default even if manifest is incomplete.
        if model_id == DEFAULT_MODEL:
            model = {
                "id": DEFAULT_MODEL,
                "display_name": "Qwen 3.5 · 預設",
                "min_ram_gb": 16,
                "min_disk_gb": 8,
                "recommended_default": True,
                "blocked": False,
                "tier": "default",
            }
        else:
            raise BootstrapError(
                f"模型「{model_id}」不在允許清單中，已拒絕下載。",
                f'Model "{model_id}" is not on the allowlist; download refused.',
            )
    if model.get("blocked"):
        raise BootstrapError(
            f"模型「{model_id}」已封鎖，不允許下載。",
            f'Model "{model_id}" is blocked; download refused.',
        )
    if model.get("tier") == "high_tier" and not force and not requested:
        # Never auto-select high tier when choosing default.
        for candidate in models:
            if candidate.get("recommended_default") and not candidate.get("blocked"):
                return candidate
    return model


def total_ram_gb() -> float | None:
    system = detect_os()
    try:
        if system == "macos":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            return int(out) / (1024**3)
        if system == "linux":
            # MemTotal is in kB
            for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    return kb / (1024**2)
        if system == "windows":
            out = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
                text=True,
            ).strip()
            return int(out) / (1024**3)
    except Exception:
        return None
    return None


def free_disk_gb(path: Path) -> float | None:
    try:
        usage = shutil.disk_usage(path)
        return usage.free / (1024**3)
    except Exception:
        return None


def gate_hardware(model: dict[str, Any], force: bool) -> None:
    need_ram = float(model.get("min_ram_gb") or 0)
    need_disk = float(model.get("min_disk_gb") or 0)
    ram = total_ram_gb()
    disk = free_disk_gb(REPO_ROOT)
    if ram is not None:
        say(f"偵測到大約 {ram:.0f} GB 記憶體。", f"Detected about {ram:.0f} GB of memory.")
        if ram + 0.5 < need_ram and not force:
            # Try to suggest a smaller allowlisted model.
            raise BootstrapError(
                f"此電腦記憶體大約 {ram:.0f} GB，低於「{model.get('id')}」建議的 {need_ram:g} GB。"
                "請改選較小模型（例如 qwen3.5:4b），或加上 --force（可能會很慢／不穩）。",
                f"This computer has about {ram:.0f} GB RAM, below the {need_ram:g} GB recommended for "
                f"\"{model.get('id')}\". Choose a smaller model (e.g. qwen3.5:4b) or pass --force "
                "(may be slow/unstable).",
            )
    else:
        say_warn("無法自動偵測記憶體；將繼續，但請留意電腦是否夠力。", "Could not detect RAM; continuing, but watch machine capacity.")
    if disk is not None:
        say(f"專案磁碟大約還有 {disk:.0f} GB 可用空間。", f"About {disk:.0f} GB free disk near the project.")
        if disk + 0.5 < need_disk and not force:
            raise BootstrapError(
                f"可用磁碟空間大約 {disk:.0f} GB，低於建議的 {need_disk:g} GB。請清出空間後再試。",
                f"Only about {disk:.0f} GB free; need about {need_disk:g} GB. Free space and retry.",
            )


def which_ollama() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    for candidate in ("/Applications/Ollama.app/Contents/Resources/ollama", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"):
        if Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def ollama_host(cli_host: str | None, existing: dict[str, Any] | None) -> str:
    if cli_host:
        return cli_host.rstrip("/")
    if existing and existing.get("ollama_host"):
        return str(existing["ollama_host"]).rstrip("/")
    env = os.environ.get("OLLAMA_HOST") or os.environ.get("EZAGENT_OLLAMA_HOST")
    if env:
        return env.rstrip("/")
    return DEFAULT_HOST


def wait_for_ollama(host: str, seconds: int = 45) -> bool:
    url = f"{host}/api/tags"
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if 200 <= resp.status < 300:
                    return True
        except Exception:
            time.sleep(1.2)
    return False


def run_cmd(argv: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, check=check, text=True, capture_output=True)


def ensure_ollama_running(host: str) -> None:
    if wait_for_ollama(host, seconds=3):
        say_ok("本機 AI 引擎已在運行。", "The local AI engine is already running.")
        return
    ollama = which_ollama()
    if not ollama:
        raise BootstrapError(
            "尚未安裝本機 AI 引擎（Ollama）。",
            "The local AI engine (Ollama) is not installed.",
        )
    say("正在啟動本機 AI 引擎…", "Starting the local AI engine…")
    system = detect_os()
    try:
        if system == "macos":
            # Prefer opening the app; fall back to `ollama serve`.
            app = Path("/Applications/Ollama.app")
            if app.exists():
                subprocess.Popen(["open", "-a", "Ollama"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.Popen([ollama, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "windows":
            subprocess.Popen([ollama, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        else:
            subprocess.Popen([ollama, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as exc:
        raise BootstrapError(
            "無法啟動本機 AI 引擎。請從應用程式選單開啟 Ollama 後再重試。",
            "Could not start the local AI engine. Open Ollama from your apps menu, then retry.",
        ) from exc
    if not wait_for_ollama(host, seconds=60):
        raise BootstrapError(
            "本機 AI 引擎沒有在時限內就緒。請開啟 Ollama 應用程式後再執行一次。",
            "The local AI engine did not become ready in time. Open the Ollama app and run this again.",
        )
    say_ok("本機 AI 引擎已就緒。", "The local AI engine is ready.")


def install_ollama_macos(yes: bool) -> None:
    if which_ollama():
        return
    say("尚未找到本機 AI 引擎。", "Local AI engine not found yet.")
    brew = shutil.which("brew")
    if brew and yes:
        say("已獲同意（--yes）：嘗試用 Homebrew 安裝 Ollama…", "Consent given (--yes): installing Ollama via Homebrew…")
        proc = run_cmd([brew, "install", "ollama"], check=False)
        if proc.returncode == 0 and which_ollama():
            say_ok("已透過 Homebrew 安裝 Ollama。", "Ollama installed via Homebrew.")
            return
        say_warn(
            "Homebrew 安裝未成功，改為提供官方安裝器連結。",
            "Homebrew install did not succeed; falling back to the official installer link.",
        )
    # Try official macOS pkg via curl when --yes (still conservative: download only with yes).
    if yes:
        say("嘗試下載官方 macOS 安裝器…", "Trying the official macOS installer download…")
        # Opening the download page is safer than silently running a remote script.
        try:
            subprocess.run(["open", OLLAMA_DOWNLOAD_MAC], check=False)
        except OSError:
            pass
        raise BootstrapError(
            "請在開啟的網頁完成 Ollama 安裝，安裝後再執行本程式一次。"
            "（我們不會在未明確同意時自動執行系統級安裝腳本。）",
            "Finish installing Ollama in the page that opened, then run this program once more. "
            "(We will not silently run system-level install scripts without clear consent.)",
            code=2,
        )
    raise BootstrapError(
        "尚未安裝本機 AI 引擎。請先安裝 Ollama（官網：ollama.com/download/mac），"
        "或在確認後加上 --yes 讓本程式嘗試自動安裝，然後再執行一次。",
        "Ollama is not installed. Install it from ollama.com/download/mac, "
        "or re-run with --yes to attempt assisted install, then run again.",
        code=2,
    )


def install_ollama_other(system: str, yes: bool) -> None:
    if which_ollama():
        return
    url = OLLAMA_DOWNLOAD_WIN if system == "windows" else OLLAMA_DOWNLOAD_LINUX
    if system == "linux" and yes and shutil.which("curl"):
        say_warn(
            "Linux 上官方一鍵安裝需要下載並執行遠端腳本；為安全起見，本程式不會代你執行。"
            "請開啟官網完成安裝後再重試。",
            "On Linux, the official one-liner runs a remote script; this program will not execute it for you. "
            "Install from the official site, then retry.",
        )
    try:
        if system == "windows":
            subprocess.run(["cmd", "/c", "start", "", url], check=False)
        elif system == "linux" and shutil.which("xdg-open"):
            subprocess.run(["xdg-open", url], check=False)
    except OSError:
        pass
    raise BootstrapError(
        f"尚未安裝本機 AI 引擎。請到官方頁面安裝後再執行一次：{url}",
        f"Ollama is not installed. Install from the official page, then run again: {url}",
        code=2,
    )


def list_installed_models(host: str) -> set[str]:
    url = f"{host}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise BootstrapError(
            "無法讀取已安裝的模型清單。請確認 Ollama 正在運行。",
            "Could not read the installed model list. Confirm Ollama is running.",
        ) from exc
    names: set[str] = set()
    for item in payload.get("models") or []:
        name = item.get("name") if isinstance(item, dict) else None
        if isinstance(name, str):
            names.add(name)
            # Ollama sometimes reports tags with / without digest; also keep base.
            if ":" in name:
                names.add(name.split(":")[0])
    return names


def model_installed(host: str, model_id: str) -> bool:
    names = list_installed_models(host)
    if model_id in names:
        return True
    # Accept tags that start with the same id (e.g. digest suffixes in some listings).
    return any(n == model_id or n.startswith(model_id + ":") for n in names)


def pull_model(model_id: str) -> None:
    ollama = which_ollama()
    if not ollama:
        raise BootstrapError(
            "找不到 ollama 指令，無法下載模型。",
            "The ollama command was not found; cannot download the model.",
        )
    say(
        f"正在下載允許的預設模型（顯示名稱可能為技術代號 {model_id}）。這可能需要幾分鐘…",
        f"Downloading the allowed default model (technical id {model_id}). This may take a few minutes…",
    )
    # Stream progress to the user in human language by parsing JSON lines when possible.
    proc = subprocess.Popen(
        [ollama, "pull", model_id],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    last_status = ""
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        status = line
        try:
            data = json.loads(line)
            status = str(data.get("status") or data.get("error") or line)
            if "completed" in data and "total" in data and data["total"]:
                pct = 100.0 * float(data["completed"]) / float(data["total"])
                status = f"{data.get('status', 'downloading')} · {pct:.0f}%"
        except json.JSONDecodeError:
            pass
        if status != last_status:
            print(f"  … {status}")
            last_status = status
    code = proc.wait()
    if code != 0:
        raise BootstrapError(
            f"模型下載失敗（結束代碼 {code}）。請檢查網路與磁碟空間後重試。",
            f"Model download failed (exit code {code}). Check network and disk space, then retry.",
        )
    say_ok("模型已下載完成。", "Model download finished.")


def read_existing_config() -> dict[str, Any]:
    if not CONFIG_PATH.is_file():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        say_warn(
            "既有設定檔無法解析；將在保留其他 .ezagent 資料的前提下覆寫 config.json。",
            "Existing config.json was unreadable; rewriting config.json only (other .ezagent data kept).",
        )
        return {}


def write_config(model_id: str, host: str, os_name: str) -> None:
    EZAGENT_DIR.mkdir(parents=True, exist_ok=True)
    # Do not touch snapshot.json / sources / artifacts.
    existing = read_existing_config()
    existing.update(
        {
            "schema_version": 1,
            "model": model_id,
            "ollama_host": host,
            "os": os_name,
            "bootstrap_updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "source": "scripts/bootstrap_local.py",
        }
    )
    CONFIG_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    say_ok(
        "已寫入本機設定（不影響既有執行紀錄與匯入資料）。",
        "Wrote local settings (existing run records and imports were left alone).",
    )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="bootstrap_local.py",
        description=(
            "Prepare EZAgent's local AI engine and default model. "
            "Messages are bilingual (zh-Hant + EN). Soft system installs need --yes."
        ),
    )
    p.add_argument("--json", action="store_true", help="Structured UI status/progress; no system package installation.")
    p.add_argument("--yes", action="store_true", help="Allow non-interactive assisted install attempts where safe.")
    p.add_argument("--model", default=None, help="Allowlisted model id to pull (default: qwen3.5:9b).")
    p.add_argument("--host", default=None, help="Ollama base URL (default: http://127.0.0.1:11434).")
    p.add_argument("--force", action="store_true", help="Bypass RAM/disk soft gates; blocked models remain blocked.")
    p.add_argument("--skip-pull", action="store_true", help="Only check/start engine and write config; do not pull.")
    p.add_argument("--check-only", action="store_true", help="Report readiness and exit; write nothing.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.json or args.check_only:
        from bootstrap_ui import run
        return run(args)
    os_name = detect_os()
    say(f"正在為 EZAgent 準備本機環境（系統：{os_name}）…", f"Preparing the EZAgent local environment (OS: {os_name})…")

    try:
        manifest = load_manifest()
        model = pick_model(manifest, args.model, args.force)
        model_id = str(model["id"])
        display = model.get("display_name") or model_id
        say(f"目標模型：{display}", f"Target model: {display} ({model_id})")

        gate_hardware(model, args.force)

        if not which_ollama():
            if os_name == "macos":
                install_ollama_macos(args.yes)
            else:
                install_ollama_other(os_name, args.yes)

        existing = read_existing_config()
        host = ollama_host(args.host, existing)
        ensure_ollama_running(host)

        installed = model_installed(host, model_id)
        if installed:
            say_ok(f"模型已就緒：{display}", f"Model already ready: {display}")
        elif args.skip_pull or args.check_only:
            say_warn(
                f"模型尚未下載：{display}",
                f"Model not downloaded yet: {display}",
            )
            if args.check_only:
                return 3
        else:
            pull_model(model_id)
            if not model_installed(host, model_id):
                raise BootstrapError(
                    "下載結束後仍偵測不到模型。請稍後再開啟 Ollama 檢查。",
                    "After download, the model still was not detected. Open Ollama and check shortly.",
                )

        if args.check_only:
            say_ok("檢查完成：引擎與模型看起來可用。", "Check complete: engine and model look usable.")
            return 0

        write_config(model_id, host, os_name)
        say_ok(
            "完成。接下來可由開發者啟動 EZAgent 應用程式；一般使用者不需記得路徑或指令。",
            "Done. A developer can start the EZAgent app next; end users should not need paths or CLI commands.",
        )
        return 0
    except BootstrapError as exc:
        print(f"✗ {exc.zh}", file=sys.stderr)
        print(f"  {exc.en}", file=sys.stderr)
        return exc.code
    except KeyboardInterrupt:
        print("✗ 已取消。 / Cancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
