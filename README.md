# BreezeFlow

> **A modern desktop orchestration layer for GoodbyeDPI — built to restore Discord on Turkish ISPs.**

[![Built with Tauri](https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust)](https://www.rust-lang.org)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## What Is BreezeFlow?

Turkish ISPs deep-packet-inspect and block Discord at the transport layer — not by DNS, but by fingerprinting TLS ClientHello packets. Standard proxies and DNS changes don't fix this.

**BreezeFlow** wraps [GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI), a Windows kernel-level DPI bypass tool, in a polished Tauri desktop application. It handles the entire lifecycle:

- Starting / stopping the engine with the correct argument presets
- Flushing the Windows DNS cache before and after engine runs
- Managing per-domain routing via an editable hostlist
- Persisting user preferences and syncing domain lists from the cloud
- Living in the system tray without consuming foreground attention

BreezeFlow is an **orchestrator**, not a proxy. It does not intercept traffic itself — it configures GoodbyeDPI, which hooks into the Windows networking stack via the [WinDivert](https://reqrypt.org/windivert.html) kernel driver.

---

## Key Features

| Feature | Description |
|---|---|
| **Global Bypass** | Routes all traffic through GoodbyeDPI's DPI-defeat arguments |
| **Smart Routing** | Only targets domains listed in `breeze_list.txt` via `--blacklist`, leaving other traffic untouched |
| **Custom Arguments** | Full passthrough of raw GoodbyeDPI CLI arguments from the UI — no recompile needed |
| **Cloud Sync** | Fetch and replace the domain hostlist from any plain-text URL with one click |
| **System Tray** | Minimize to tray; left-click restores, right-click shows Show / Toggle / Quit menu |
| **Start With Windows** | Optional autostart via `tauri-plugin-autostart` |
| **DNS Hygiene** | `ipconfig /flushdns` runs silently before engine start and after engine stop |
| **WinDivert Safety** | 300 ms cooldown between kill and respawn prevents kernel handle contention |

---

## Technical Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2.0](https://tauri.app) (Rust + WebView2) |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Rust 2021 edition |
| DPI engine | GoodbyeDPI (bundled as Tauri sidecar) |
| Kernel driver | WinDivert (bundled with GoodbyeDPI) |
| Argument parsing | [`shlex`](https://crates.io/crates/shlex) — shell-aware tokenizer |
| HTTP client | [`reqwest`](https://crates.io/crates/reqwest) 0.12 with `rustls-tls` |
| Autostart | [`tauri-plugin-autostart`](https://crates.io/crates/tauri-plugin-autostart) |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  BreezeFlow UI                  │
│           (React + Tailwind + Tauri IPC)        │
└────────────────────┬────────────────────────────┘
                     │  invoke() / listen()
┌────────────────────▼────────────────────────────┐
│               Tauri Rust Backend                │
│  start_engine / stop_engine / sync_list / ...   │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │  AppState    │  │  Hostlist management    │  │
│  │  Mutex<Child>│  │  find / sanitize / write│  │
│  └──────────────┘  └─────────────────────────┘  │
└────────────────────┬────────────────────────────┘
                     │  sidecar spawn
┌────────────────────▼────────────────────────────┐
│              goodbyedpi.exe (sidecar)           │
│  WinDivert kernel driver hook                   │
│  Yandex DNS forwarding (77.88.8.8:1253)         │
└─────────────────────────────────────────────────┘
```

### Routing Profiles

**Global Bypass** — passes the full argument string directly to GoodbyeDPI. Default preset:

```
-5 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253
   --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253
```

**Smart Routing** — same base arguments, but appends `--blacklist <clean_hostlist.txt>` so only domains in your list are processed. The backend strips comments and blank lines from `breeze_list.txt` before passing it to GoodbyeDPI (which rejects unclean files).

---

## Installation & Setup (Developers)

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [Rust](https://rustup.rs) stable (1.78+)
- [Tauri CLI v2](https://tauri.app/v2/guides/getting-started/setup/)
- Windows 10/11 (WinDivert is Windows-only)

### 1. Clone and install

```powershell
git clone https://github.com/yilmaz-mert/breeze-flow.git
cd breeze-flow
npm install
```

### 2. Place sidecar binaries

GoodbyeDPI and its WinDivert kernel driver are **not bundled in this repository**. Download the latest release from [ValdikSS/GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI/releases) and place the following files into `src-tauri/bin/`:

```
src-tauri/bin/
├── goodbyedpi-x86_64-pc-windows-msvc.exe   ← rename from goodbyedpi.exe
├── WinDivert.dll
├── WinDivert64.sys
└── WinDivert32.sys
```

> **Important:** Tauri sidecar binaries must include the target triple in their filename. The `tauri.conf.json` `externalBin` entry is `"goodbyedpi"` — Tauri automatically resolves to the `*-x86_64-pc-windows-msvc.exe` variant on 64-bit Windows.

### 3. Run in development

```powershell
npm run tauri dev
```

> The app requires **Administrator privileges** to open WinDivert handles. Run the terminal as Administrator or accept the UAC prompt.

### 4. Build for release

```powershell
npm run tauri build
```

The signed installer is output to `src-tauri/target/release/bundle/`.

---

## Usage

### Starting the engine

1. Launch BreezeFlow (run as Administrator).
2. Choose a profile: **Global Bypass** or **Smart Routing**.
3. Optionally edit the ENGINE ARGUMENTS field and click **[APPLY ARGUMENTS]**.
4. Click **[START ENGINE]**.

The status dot turns green and the active parameter string is displayed.

### Smart Routing — editing the domain list

1. Select the **Smart Routing** profile.
2. Click **[EDIT DOMAIN LIST]** to open the hostlist editor.
3. Add one domain per line. Lines starting with `#` and blank lines are ignored (stripped before the file is passed to GoodbyeDPI).
4. Use the **CLOUD SYNC** bar to fetch a remote list from any plain-text URL and overwrite the local file.
5. Click **[SAVE & RESTART]** — the engine restarts automatically with the updated list.

### System tray

Closing the window hides it to the system tray. A one-time notification confirms this on the first hide.

| Tray action | Result |
|---|---|
| Left-click icon | Restore window |
| Right-click → Show Dashboard | Restore window |
| Right-click → Toggle Engine | Start (opens window) or stop the engine |
| Right-click → Quit BreezeFlow | Kill engine and exit cleanly |

### Autostart

Enable **START WITH WINDOWS** in the dashboard to register BreezeFlow with the Windows startup registry via `tauri-plugin-autostart`. The toggle persists across sessions.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Engine failed to start" | Not running as Administrator | Relaunch as Administrator |
| Engine starts but Discord still blocked | DNS cache stale | Click Stop then Start again to force a second flush |
| `OS Error 2` on first launch | Sidecar binaries missing from `src-tauri/bin/` | Follow the sidecar placement instructions above |
| Smart Routing has no effect | `breeze_list.txt` empty or missing target domains | Open the editor and verify domain entries |

---

## Disclaimer

BreezeFlow is a personal, open-source tool. It does not provide anonymity, encrypt traffic, or replace a VPN. It is designed specifically to work around DPI-based application blocks in jurisdictions where such blocks have been implemented.

Use of this software is subject to the laws of your jurisdiction. The authors assume no liability for misuse. GoodbyeDPI and WinDivert are third-party projects with their own licenses — review them before distributing binaries.

---

## Credits

- [GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI) by ValdikSS — the DPI bypass engine
- [WinDivert](https://reqrypt.org/windivert.html) by basil — the Windows packet interception driver
- [Tauri](https://tauri.app) — the desktop application framework
