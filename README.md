# BreezeFlow

> **A modern desktop orchestration layer for GoodbyeDPI — built to restore Discord on Turkish ISPs.**

[![Built with Tauri](https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust)](https://www.rust-lang.org)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Download

> **End users: no build tools needed.**

1. Go to the [**Releases**](https://github.com/yilmaz-mert/breeze-flow/releases) tab on GitHub.
2. Download the latest `BreezeFlow_x.x.x_x64-setup.exe` (NSIS) or `.msi` installer.
3. Run the installer — Windows will ask for **Administrator** elevation. This is required and expected.
4. Launch BreezeFlow from the Start Menu or Desktop shortcut.

> **Important:** BreezeFlow's `app.manifest` is set to `requireAdministrator`. The application **will not function correctly** without elevation — GoodbyeDPI requires kernel-level access via the WinDivert driver, which Windows only grants to elevated processes. Always run as Administrator.

---

## Screenshots

> Replace these placeholders with actual screenshots after your first build.

| Dashboard | Smart Routing Editor |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Editor](docs/screenshots/editor.png) |

| Engine Error Modal | System Tray |
|---|---|
| ![Error Modal](docs/screenshots/error-modal.png) | ![Tray](docs/screenshots/tray.png) |

---

## What Is BreezeFlow?

Turkish ISPs deep-packet-inspect and block Discord at the transport layer — not by DNS, but by fingerprinting TLS ClientHello packets. Standard proxies and DNS changes don't fix this.

**BreezeFlow** wraps [GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI), a Windows kernel-level DPI bypass tool, in a polished Tauri desktop application. It handles the entire lifecycle:

- Starting / stopping the engine with a fully configurable argument string
- Flushing the Windows DNS cache before and after engine runs
- Managing per-domain routing via an editable hostlist
- Persisting user preferences and syncing domain lists from the cloud
- Living in the system tray without consuming foreground attention
- Registering an elevated autostart task so the engine is ready at logon — no UAC prompt required

BreezeFlow is an **orchestrator**, not a proxy. It does not intercept traffic itself — it configures GoodbyeDPI, which hooks into the Windows networking stack via the [WinDivert](https://reqrypt.org/windivert.html) kernel driver.

---

## Key Features

| Feature | Description |
|---|---|
| **Global Bypass** | Routes all traffic through GoodbyeDPI's DPI-defeat arguments |
| **Smart Routing** | Only targets domains listed in `breeze_list.txt` via `--blacklist`, leaving all other traffic untouched |
| **Custom Arguments** | Full passthrough of raw GoodbyeDPI CLI arguments from the UI — no recompile needed |
| **Global Hotkey** | `Ctrl + Shift + B` toggles the engine on/off system-wide, even when the window is hidden in the tray |
| **Uptime Counter** | Live timer tracking how long the engine has been running in the current session |
| **Cloud Sync** | Fetch and replace the domain hostlist from any plain-text URL with one click |
| **System Tray** | Minimize to tray; left-click restores, right-click shows Show / Toggle / Quit menu |
| **Start With Windows** | Autostart via Windows Task Scheduler with Highest Privileges — no UAC prompt, guaranteed elevation |
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
| Autostart | Windows Task Scheduler (`schtasks.exe`) — native, no extra crate |
| Global hotkey | [`tauri-plugin-global-shortcut`](https://crates.io/crates/tauri-plugin-global-shortcut) |

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
│  ┌────────────────────────────────────────────┐  │
│  │  Global Shortcut: Ctrl+Shift+B             │  │
│  │  Registered at startup — works tray-only   │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │  Autostart: schtasks.exe                   │  │
│  │  Task runs at logon, /rl highest — no UAC  │  │
│  └────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────┘
                     │  sidecar spawn
┌────────────────────▼────────────────────────────┐
│              goodbyedpi.exe (sidecar)           │
│  WinDivert kernel driver hook                   │
│  Yandex DNS forwarding (77.88.8.8:1253)         │
└─────────────────────────────────────────────────┘
```

### Routing Profiles

**Global Bypass** — passes the full argument string directly to GoodbyeDPI. Default:

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

> **All development commands must be run from an Administrator terminal.** WinDivert loads a kernel driver at runtime, which requires elevation. Without it, `goodbyedpi.exe` will fail with `OS Error 5 (Access Denied)`.

### 1. Clone and install

```powershell
git clone https://github.com/yilmaz-mert/breeze-flow.git
cd breeze-flow
npm install
```

### 2. Place sidecar binaries

GoodbyeDPI ships as a single `.zip` containing the executable and all required WinDivert driver files. These are **not included in this repository** — you must supply them.

**a) Download GoodbyeDPI**

Download `goodbyedpi.zip` from the [ValdikSS/GoodbyeDPI releases page](https://github.com/ValdikSS/GoodbyeDPI/releases).

**b) Place files in `src-tauri/`**

```
src-tauri/
├── goodbyedpi-x86_64-pc-windows-msvc.exe   ← rename from goodbyedpi.exe
├── WinDivert.dll                            ← copy from the zip
└── WinDivert64.sys                          ← copy from the zip
```

> **Why this exact location?** Tauri sidecar binaries live in `src-tauri/` root during development. The WinDivert DLL and driver must be in the **same directory as the executable** that loads them — at dev time that is also `src-tauri/`, and at runtime that is the app's install directory.

> **Why the target-triple suffix?** Tauri resolves sidecar names to `<name>-<target-triple>.exe` automatically. The `externalBin` entry is `"goodbyedpi"`; on a 64-bit Windows host, Tauri looks for `goodbyedpi-x86_64-pc-windows-msvc.exe`. The original filename from the zip is just `goodbyedpi.exe` — you must rename it.

**c) For release bundles**

When building an installer (`npm run tauri build`), the `tauri.conf.json` `resources` field ensures the DLL and driver are copied into the bundle automatically:

```json
"bundle": {
  "externalBin": ["goodbyedpi"],
  "resources": [
    "WinDivert.dll",
    "WinDivert64.sys"
  ]
}
```

### 3. Run in development

```powershell
# Must be run from an Administrator terminal
npm run tauri dev
```

> If you see `OS Error 5 (Access Denied)` during the build step (not at runtime), a previous `goodbyedpi.exe` process is still running and locking the binary. Run `taskkill /f /im goodbyedpi.exe` then retry.

### 4. Build for release

```powershell
npm run tauri build
```

The installer is output to `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/bundle/msi/`.

---

## Usage

### Starting the engine

> BreezeFlow's `app.manifest` is configured with `requireAdministrator` — Windows will show a UAC prompt on first launch. This is intentional and cannot be bypassed without breaking the kernel driver.

1. Launch BreezeFlow and accept the UAC elevation prompt.
2. Choose a profile: **Global Bypass** or **Smart Routing**.
3. Optionally edit the ENGINE ARGUMENTS field directly and press Enter or click **[APPLY ARGUMENTS]**.
4. Click **[START ENGINE]**.

The status dot turns green and the uptime counter starts.

### Global hotkey

`Ctrl + Shift + B` toggles the engine from anywhere on the system — the BreezeFlow window does not need to be open or focused. A brief toast notification appears in the top-center of the screen confirming the new state (`BREEZEFLOW: ENABLED` / `BREEZEFLOW: DISABLED`).

The hotkey uses the **last-used configuration**, so it always restarts with the same profile and arguments as the previous manual start.

### Smart Routing — editing the domain list

1. Select the **Smart Routing** profile.
2. Click **[EDIT ROUTING LIST]** to open the hostlist editor.
3. Add one domain per line. Lines starting with `#` and blank lines are stripped automatically before the file reaches GoodbyeDPI.
4. Use the **CLOUD SYNC** bar to fetch a remote list from any plain-text URL and overwrite the local file.
5. Click **[SAVE]** — the engine restarts automatically if Smart Routing is already active.

The hostlist is stored at:
```
%APPDATA%\com.breezeflow\com.breezeflow\breeze_list.txt
```

### System tray

Closing the window hides it to the system tray. A one-time notification confirms this on the first hide.

| Tray action | Result |
|---|---|
| Left-click icon | Restore window |
| Right-click → Show Dashboard | Restore window |
| Right-click → Toggle Engine | Stop engine (or open window if stopped) |
| Right-click → Quit BreezeFlow | Kill engine and exit cleanly |

### Autostart (Start With Windows)

Toggle **START WITH WINDOWS** in the Controls panel. When enabled, BreezeFlow calls `schtasks.exe` to register a Task Scheduler entry with the following properties:

| Property | Value |
|---|---|
| Trigger | At user logon |
| Run level | Highest Privileges |
| Task name | `BreezeFlow_Autostart` |

Because the task runs at **Highest Privileges**, Windows launches BreezeFlow fully elevated at logon with no UAC prompt. This is the only reliable approach for `requireAdministrator` applications — standard registry autostart (`HKCU\Run`) cannot trigger elevation silently and will either show a UAC dialog or silently fail to load the kernel driver.

To inspect or remove the task manually:

```powershell
# View task details
schtasks /query /tn BreezeFlow_Autostart /fo LIST /v

# Remove the task
schtasks /delete /tn BreezeFlow_Autostart /f
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Engine failed to start" error modal | Not running as Administrator | The app manifest requires elevation — relaunch and accept the UAC prompt |
| `OS Error 5` during `npm run tauri dev` | Previous `goodbyedpi.exe` locking the binary | `taskkill /f /im goodbyedpi.exe` then retry |
| `OS Error 2` — sidecar not found | Binary missing or not renamed | Follow the sidecar placement instructions above |
| Engine starts but Discord still blocked | DNS cache stale | Click KILL SWITCH then START ENGINE to force a second flush |
| Smart Routing has no effect | `breeze_list.txt` empty or missing target domains | Open the editor and verify domain entries |
| WinDivert error on start | DLL / driver not in same directory as the exe | Ensure `WinDivert.dll` and `WinDivert64.sys` are in `src-tauri/` |
| Autostart task not created | schtasks call failed | Confirm the app is running as Administrator; check the Terminal Log for the error |
| `Ctrl + Shift + B` does nothing | App not running, or shortcut conflict | Check system tray for BreezeFlow icon; check for conflicting global shortcuts |

---

## Disclaimer

BreezeFlow is a personal, open-source tool. It does not provide anonymity, encrypt traffic, or replace a VPN. It is designed specifically to work around DPI-based application blocks in jurisdictions where such blocks have been implemented.

Use of this software is subject to the laws of your jurisdiction. The authors assume no liability for misuse. GoodbyeDPI and WinDivert are third-party projects with their own licenses — review them before distributing binaries.

---

## Credits

- [GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI) by ValdikSS — the DPI bypass engine
- [WinDivert](https://reqrypt.org/windivert.html) by basil — the Windows packet interception driver
- [Tauri](https://tauri.app) — the desktop application framework
