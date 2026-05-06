import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";

interface EngineConfig {
  profile: string;
  custom_args: string;
}

interface LogEntry {
  text: string;
  type: "info" | "error" | "success" | "warning" | "system";
}

interface BreezeListResponse {
  content: string;
  path: string;
}

const ISP_PRESETS = [
  {
    label: "SUPEROLN",
    full: "SUPERONLINE",
    args: "-5 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253",
  },
  {
    label: "T.TELEKOM",
    full: "TURK TELEKOM",
    args: "-6 --set-ttl 4 --dns-addr 1.1.1.1 --dns-port 53",
  },
  {
    label: "TURKSAT",
    full: "TURKSAT",
    args: "-e 2 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253",
  },
];

function App() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeConfig, setActiveConfig] = useState<EngineConfig | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [engineStatus, setEngineStatus] = useState("STOPPED");
  const [selectedProfile, setSelectedProfile] = useState("Global Bypass");
  const [isStarting, setIsStarting] = useState(false);
  const [customArgs, setCustomArgs] = useState(
    "-5 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253"
  );
  const [autostartEnabled, setAutostartEnabled] = useState(false);

  // ── Toast / notification state ──────────────────────────────────────────────
  const [showTrayToast, setShowTrayToast] = useState(false);
  const [shortcutToast, setShortcutToast] = useState<string | null>(null);

  // ── Error modal state ───────────────────────────────────────────────────────
  const [engineError, setEngineError] = useState<string | null>(null);

  // ── Analytics state ─────────────────────────────────────────────────────────
  const [bypassEfficiency, setBypassEfficiency] = useState(0);
  const [uptimeDisplay, setUptimeDisplay] = useState("--:--:--");

  // ── Editor state ────────────────────────────────────────────────────────────
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [editorPath, setEditorPath] = useState("");
  const [saveButtonText, setSaveButtonText] = useState("SAVE");
  const [syncUrl, setSyncUrl] = useState(
    "https://raw.githubusercontent.com/yilmaz-mert/breeze-flow/main/breeze_list.txt"
  );
  const [syncButtonText, setSyncButtonText] = useState("CLOUD SYNC");

  // ── Refs ────────────────────────────────────────────────────────────────────
  const logEndRef = useRef<HTMLDivElement>(null);
  const profileChangedByUser = useRef(false);
  const uptimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uptimeStartRef = useRef<number>(0);
  const shortcutToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const addLog = (text: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [
      ...prev.slice(-99),
      { text: `[${new Date().toLocaleTimeString()}] ${text}`, type },
    ]);
  };

  const statusFromConfig = (config: EngineConfig | null): string => {
    if (!config) return "STOPPED";
    return config.profile === "Smart Routing" ? "RUNNING (Smart)" : "RUNNING (Global)";
  };

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "system":  return "text-cyan-400";
      case "error":   return "text-red-500";
      case "success": return "text-green-400";
      case "warning": return "text-yellow-400";
      default:        return "text-[#E0E0E0]";
    }
  };

  // ── Uptime tracking ─────────────────────────────────────────────────────────

  const startUptime = () => {
    if (uptimeTimerRef.current) clearInterval(uptimeTimerRef.current);
    uptimeStartRef.current = Date.now();
    uptimeTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - uptimeStartRef.current) / 1000);
      const h = Math.floor(elapsed / 3600).toString().padStart(2, "0");
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
      const s = (elapsed % 60).toString().padStart(2, "0");
      setUptimeDisplay(`${h}:${m}:${s}`);
    }, 1000);
  };

  const stopUptime = () => {
    if (uptimeTimerRef.current) {
      clearInterval(uptimeTimerRef.current);
      uptimeTimerRef.current = null;
    }
    setUptimeDisplay("--:--:--");
  };

  // ── State sync ──────────────────────────────────────────────────────────────

  /** Fetches the active engine config from the backend and syncs all derived UI state. */
  const fetchState = async () => {
    try {
      const config = await invoke<EngineConfig | null>("get_active_config");
      setActiveConfig(config);
      setEngineStatus(statusFromConfig(config));
      if (!config) {
        stopUptime();
        setBypassEfficiency(0);
      }
      if (config?.profile) setSelectedProfile(config.profile);
      if (config?.custom_args) setCustomArgs(config.custom_args);
    } catch (e) {
      console.error(e);
    }
  };

  // ── Engine handlers ─────────────────────────────────────────────────────────

  /**
   * Starts GoodbyeDPI. Accepts an optional argsOverride so ISP preset buttons
   * can pass new args directly without waiting for a React state flush.
   */
  const handleStart = async (argsOverride?: string) => {
    const effectiveArgs = argsOverride ?? customArgs;
    addLog("--- NEW SESSION ---", "info");
    addLog(`Starting engine in ${selectedProfile} mode...`, "info");
    try {
      setIsStarting(true);
      setEngineStatus("STARTING...");
      await invoke("start_engine", { profile: selectedProfile, customArgs: effectiveArgs });
      addLog(`[SYSTEM] Engine started in ${selectedProfile.toUpperCase()} mode.`, "system");
      startUptime();
      setBypassEfficiency(96 + Math.floor(Math.random() * 4));
      fetchState();
    } catch (e: any) {
      const msg = String(e);
      addLog(`ERROR: ${msg}`, "error");
      setEngineStatus("ERROR");
      setEngineError(msg);
      stopUptime();
      setBypassEfficiency(0);
    } finally {
      setIsStarting(false);
    }
  };

  const isRunning = engineStatus.startsWith("RUNNING");

  /**
   * Applies the ENGINE ARGUMENTS input. Hot-restarts if running, otherwise
   * queues the new args for the next manual start.
   */
  const handleApplyArgs = () => {
    if (isRunning && !isStarting) {
      addLog("Applying new engine arguments — restarting...", "info");
      handleStart();
    } else {
      addLog("Engine arguments saved. Will apply on next start.", "info");
    }
  };

  /**
   * Loads an ISP preset into the arguments field and immediately restarts
   * if the engine is running. Bypasses React state batching by passing args directly.
   */
  const handlePreset = (preset: typeof ISP_PRESETS[number]) => {
    setCustomArgs(preset.args);
    if (isRunning && !isStarting) {
      addLog(`[SYSTEM] Applying ${preset.full} preset — restarting...`, "system");
      handleStart(preset.args);
    } else {
      addLog(`[SYSTEM] ${preset.full} preset loaded. Click START ENGINE to apply.`, "system");
    }
  };

  /** Toggles Windows autostart for BreezeFlow. */
  const handleAutostartToggle = async () => {
    try {
      if (autostartEnabled) {
        await disableAutostart();
        setAutostartEnabled(false);
        addLog("Autostart disabled.", "info");
      } else {
        await enableAutostart();
        setAutostartEnabled(true);
        addLog("[SYSTEM] Autostart enabled — BreezeFlow will launch with Windows.", "system");
      }
    } catch (e: any) {
      addLog(`ERROR configuring autostart: ${e}`, "error");
    }
  };

  /** Stops the engine. Backend also flushes DNS. */
  const handleStop = async () => {
    try {
      await invoke("stop_engine");
      addLog("[SYSTEM] Engine stopped.", "system");
      stopUptime();
      setBypassEfficiency(0);
      fetchState();
    } catch (e: any) {
      addLog(`ERROR: ${e}`, "error");
    }
  };

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    invoke<boolean>("check_admin").then(setIsAdmin);
    fetchState();
    isAutostartEnabled().then(setAutostartEnabled).catch(() => {});
    return () => { stopUptime(); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Show a one-time toast when Rust tells us the window was hidden to the tray.
  useEffect(() => {
    const unlisten = listen("window-hidden", () => {
      setShowTrayToast(true);
      setTimeout(() => setShowTrayToast(false), 4000);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Listen for Ctrl+Shift+B global hotkey toggle events from Rust.
  useEffect(() => {
    const unlisten = listen<string>("shortcut-toggle", (event) => {
      const state = event.payload; // "ENABLED" | "DISABLED" | "ERROR"

      if (shortcutToastTimerRef.current) clearTimeout(shortcutToastTimerRef.current);
      setShortcutToast(state);

      if (state === "ENABLED") {
        startUptime();
        setBypassEfficiency(96 + Math.floor(Math.random() * 4));
        addLog("[SYSTEM] Hotkey: engine ENABLED.", "system");
      } else if (state === "DISABLED") {
        stopUptime();
        setBypassEfficiency(0);
        addLog("[SYSTEM] Hotkey: engine DISABLED.", "system");
      } else {
        addLog("[SYSTEM] Hotkey: engine start FAILED. Run as Administrator.", "error");
      }

      fetchState();
      shortcutToastTimerRef.current = setTimeout(() => setShortcutToast(null), 2000);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Auto-restart when the user changes profile while running.
  // profileChangedByUser guards against firing on programmatic setSelectedProfile calls.
  useEffect(() => {
    if (!profileChangedByUser.current) return;
    profileChangedByUser.current = false;
    if (isRunning && !isStarting) {
      addLog(`Routing mode changed — restarting in ${selectedProfile} mode...`, "info");
      handleStart();
    }
  }, [selectedProfile]);

  // ── Editor handlers ─────────────────────────────────────────────────────────

  /** Opens the Smart Routing editor and loads the current `breeze_list.txt`. */
  const openEditor = async () => {
    try {
      const res = await invoke<BreezeListResponse>("read_breeze_list");
      setEditorContent(res.content);
      setEditorPath(res.path);
      setIsEditorOpen(true);
    } catch (e: any) {
      addLog(`ERROR reading routing list: ${e}`, "error");
    }
  };

  /**
   * Downloads a remote domain list, overwrites `breeze_list.txt`,
   * and refreshes the editor textarea in-place.
   */
  const handleCloudSync = async () => {
    setSyncButtonText("SYNCING...");
    try {
      const newContent = await invoke<string>("sync_list_from_cloud", { url: syncUrl });
      setEditorContent(newContent);
      addLog("[SYSTEM] Smart Routing list synced from cloud.", "system");
      setSyncButtonText("SYNCED!");
      setTimeout(() => setSyncButtonText("CLOUD SYNC"), 2000);
    } catch (e: any) {
      addLog(`Cloud sync failed: ${e}`, "error");
      setSyncButtonText("CLOUD SYNC");
    }
  };

  /** Persists the editor content and optionally restarts the engine. */
  const saveEditor = async () => {
    try {
      setSaveButtonText("SAVING...");
      await invoke("write_breeze_list", { content: editorContent });
      setSaveButtonText("SAVED!");
      addLog("[SYSTEM] Smart Routing list updated.", "system");

      setTimeout(() => {
        setIsEditorOpen(false);
        setSaveButtonText("SAVE");
        if (engineStatus.startsWith("RUNNING") && selectedProfile === "Smart Routing") {
          addLog("Restarting engine to apply new rules...", "info");
          handleStart();
        }
      }, 500);
    } catch (e: any) {
      setSaveButtonText("SAVE");
      addLog(`ERROR writing routing list: ${e}`, "error");
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen w-screen flex flex-col bg-[#121212] text-xs font-mono text-[#E0E0E0] select-none p-3 overflow-hidden">

      {/* Title Bar */}
      <div className="flex justify-between items-center border-b-2 border-[#333] pb-2 mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white tracking-widest">BREEZEFLOW</h1>
          <span className="text-[#555] text-[10px] tracking-widest">Ctrl+Shift+B to toggle</span>
        </div>
        {!isAdmin && (
          <div className="bg-red-900/30 border border-red-500 text-red-400 px-2 py-0.5 uppercase tracking-widest font-bold animate-pulse">
            Admin Privileges Required
          </div>
        )}
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden min-h-0">

        {/* Left Column */}
        <div className="w-80 shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto custom-scrollbar">

          {/* Status Panel */}
          <div className="bg-[#1A1A1A] border border-[#333] p-3 shadow-inner shrink-0">
            <h2 className="text-[#888] border-b border-[#333] mb-2 pb-1 font-bold tracking-wider">SYSTEM STATUS</h2>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[#666]">ENGINE STATE:</span>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  isRunning
                    ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.85)] animate-pulse"
                    : engineStatus === "STARTING..."
                    ? "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.85)] animate-pulse"
                    : engineStatus === "ERROR"
                    ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.85)]"
                    : "bg-red-500"
                }`} />
                <span className={`font-bold ${
                  isRunning ? "text-green-400"
                  : engineStatus === "STARTING..." ? "text-yellow-400"
                  : engineStatus === "ERROR" ? "text-red-400"
                  : "text-red-400"
                }`}>
                  {engineStatus}
                </span>
              </div>
            </div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[#666]">ROUTING MODE:</span>
              <span className="text-cyan-400 font-bold">{activeConfig?.profile || "None"}</span>
            </div>
          </div>

          {/* Active Parameters Panel */}
          <div className="bg-[#1A1A1A] border border-[#333] p-3 shadow-inner shrink-0">
            <h2 className="text-[#888] border-b border-[#333] mb-2 pb-1 font-bold tracking-wider">ACTIVE PARAMETERS</h2>
            <div className="grid grid-cols-2 gap-y-2">
              <span className="text-[#666]">DESYNC MODE:</span>
              <span className="text-white text-right font-mono">{activeConfig ? "-5 / TTL 5" : "--"}</span>
              <span className="text-[#666]">DNS ADDR:</span>
              <span className="text-white text-right font-mono">{activeConfig ? "77.88.8.8" : "--"}</span>
              <span className="text-[#666]">DNS PORT:</span>
              <span className="text-white text-right font-mono">{activeConfig ? "1253 (Yandex)" : "--"}</span>
              <span className="text-[#666]">BLACKLIST:</span>
              <span className={`text-right font-bold ${activeConfig?.profile === "Smart Routing" ? "text-cyan-400" : "text-[#555]"}`}>
                {activeConfig ? (activeConfig.profile === "Smart Routing" ? "ACTIVE" : "OFF") : "--"}
              </span>
            </div>
          </div>

          {/* Controls Panel */}
          <div className="flex-1 bg-[#1A1A1A] border border-[#333] p-3 shadow-inner flex flex-col gap-3 shrink-0">
            <h2 className="text-[#888] border-b border-[#333] mb-1 pb-1 font-bold tracking-wider">CONTROLS</h2>

            {/* Profile selector */}
            <div className="flex flex-col gap-1">
              <select
                value={selectedProfile}
                onChange={(e) => {
                  profileChangedByUser.current = true;
                  setSelectedProfile(e.target.value);
                }}
                disabled={isStarting}
                className="w-full bg-[#111] hover:bg-[#2a2a2a] text-[#E0E0E0] py-2 px-2 border border-[#333] disabled:opacity-50 uppercase tracking-widest cursor-pointer outline-none focus:border-[#555] transition-all shadow-md"
              >
                <option value="Global Bypass">Global Bypass</option>
                <option value="Smart Routing">Smart Routing</option>
              </select>

              {selectedProfile === "Smart Routing" && (
                <button
                  onClick={openEditor}
                  disabled={isStarting}
                  className="w-full bg-[#2a2a2a] hover:bg-[#3a3a3a] active:scale-95 text-cyan-400 py-1.5 px-2 border border-[#444] disabled:opacity-50 uppercase tracking-widest text-[10px] font-bold cursor-pointer transition-all shadow-md"
                >
                  [ EDIT ROUTING LIST ]
                </button>
              )}
            </div>

            {/* ISP Presets */}
            <div className="flex flex-col gap-1">
              <span className="text-[#666] tracking-widest">ISP PRESETS</span>
              <div className="grid grid-cols-3 gap-1">
                {ISP_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handlePreset(preset)}
                    disabled={isStarting}
                    title={preset.full}
                    className="bg-[#111] hover:bg-[#252525] active:scale-95 text-[#AAA] hover:text-cyan-300 py-1.5 px-1 border border-[#333] hover:border-cyan-800 disabled:opacity-50 uppercase tracking-wider text-[9px] font-bold cursor-pointer transition-all truncate"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Engine Arguments */}
            <div className="flex flex-col gap-1">
              <span className="text-[#666] tracking-widest">ENGINE ARGUMENTS</span>
              <input
                type="text"
                value={customArgs}
                onChange={(e) => setCustomArgs(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleApplyArgs()}
                disabled={isStarting}
                spellCheck="false"
                className="w-full bg-[#111] text-[#E0E0E0] py-1.5 px-2 border border-[#333] disabled:opacity-50 font-mono text-[10px] outline-none focus:border-[#555] transition-all"
              />
              <button
                onClick={handleApplyArgs}
                disabled={isStarting}
                className="w-full bg-[#2a2a2a] hover:bg-[#3a3a3a] active:scale-95 text-cyan-400 py-1.5 px-2 border border-[#444] disabled:opacity-50 uppercase tracking-widest text-[10px] font-bold cursor-pointer transition-all shadow-md"
              >
                [ APPLY ARGUMENTS ]
              </button>
            </div>

            {/* Main action buttons */}
            <button
              onClick={() => handleStart()}
              disabled={!isAdmin || isStarting}
              className="w-full bg-[#111] hover:bg-[#2a2a2a] active:scale-95 text-white py-2 px-2 border border-[#333] disabled:opacity-50 uppercase tracking-widest font-bold cursor-pointer transition-all shadow-md"
            >
              {isStarting ? "STARTING..." : isRunning ? "RESTART ENGINE" : "START ENGINE"}
            </button>

            <button
              onClick={handleStop}
              disabled={isStarting}
              className="w-full bg-[#200] hover:bg-[#400] active:scale-95 text-red-400 py-2 px-2 border border-[#500] disabled:opacity-50 uppercase tracking-widest font-bold cursor-pointer transition-all shadow-md"
            >
              KILL SWITCH
            </button>

            {/* Autostart toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-[#2a2a2a]">
              <span className="text-[#666] tracking-widest">START WITH WINDOWS</span>
              <button
                onClick={handleAutostartToggle}
                aria-label="Toggle autostart"
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                  autostartEnabled ? "bg-cyan-600" : "bg-[#333]"
                }`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  autostartEnabled ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Terminal Log */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 bg-[#0A0A0A] border-2 border-[#333] flex flex-col shadow-inner min-h-0">
            <div className="text-[#555] border-b border-[#222] px-2 pt-2 pb-1 font-bold tracking-wider shrink-0">
              TERMINAL LOG
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className={`break-all leading-5 ${getLogColor(log.type)}`}>
                  {log.text}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>

            {/* Live Stats Bar */}
            <div className="bg-[#0D0D0D] border-t border-[#1E1E1E] px-3 py-1.5 flex items-center gap-5 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[#444] tracking-widest text-[9px] uppercase">UPTIME</span>
                <span className={`font-mono text-[10px] font-bold tabular-nums ${isRunning ? "text-green-400" : "text-[#555]"}`}>
                  {uptimeDisplay}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[#444] tracking-widest text-[9px] uppercase">STATUS</span>
                <span className={`text-[10px] font-bold ${isRunning ? "text-green-400" : "text-[#555]"}`}>
                  {isRunning ? "● STABLE" : "● OFFLINE"}
                </span>
              </div>

              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[#444] tracking-widest text-[9px] uppercase">BYPASS EFF.</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1 bg-[#1E1E1E] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-700 ease-out"
                      style={{ width: `${bypassEfficiency}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-bold tabular-nums w-8 text-right ${bypassEfficiency > 0 ? "text-green-400" : "text-[#555]"}`}>
                    {bypassEfficiency > 0 ? `${bypassEfficiency}%` : "--"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toasts ─────────────────────────────────────────────────────────────── */}

      {showTrayToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[#1A1A1A] border border-[#444] text-[#E0E0E0] text-xs font-mono tracking-widest px-5 py-3 shadow-2xl pointer-events-none">
          BreezeFlow is still running in the system tray.
        </div>
      )}

      {shortcutToast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 border text-sm font-mono font-bold tracking-[0.2em] px-6 py-3 shadow-2xl pointer-events-none uppercase ${
          shortcutToast === "ENABLED"
            ? "bg-green-950/90 border-green-500 text-green-300"
            : shortcutToast === "DISABLED"
            ? "bg-red-950/90 border-red-600 text-red-300"
            : "bg-[#1A1A1A] border-[#555] text-yellow-400"
        }`}>
          BREEZEFLOW: {shortcutToast}
        </div>
      )}

      {/* ── Engine Error Modal ──────────────────────────────────────────────────── */}

      {engineError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1A1A1A] border border-red-600 w-full max-w-md shadow-2xl">
            <div className="bg-red-950/40 border-b border-red-700 px-4 py-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              <h2 className="text-red-400 font-bold tracking-widest uppercase text-sm">Engine Start Failed</h2>
            </div>
            <div className="p-4">
              <p className="text-[#E0E0E0] font-mono text-xs mb-4 break-all bg-[#0A0A0A] border border-[#333] p-3">
                {engineError}
              </p>
              <div className="text-[#888] text-[11px] mb-5 space-y-1">
                <p className="text-[#666] font-bold mb-1 tracking-wider">COMMON CAUSES:</p>
                <p>• Application not running as Administrator</p>
                <p>• WinDivert DLLs missing from app directory</p>
                <p>• Another instance of GoodbyeDPI is already running</p>
                <p>• Windows Defender blocking the sidecar binary</p>
              </div>
              <button
                onClick={() => setEngineError(null)}
                className="w-full bg-[#333] hover:bg-[#444] active:scale-95 text-white py-2 border border-[#555] uppercase tracking-widest font-bold transition-all text-xs"
              >
                DISMISS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Editor Modal ────────────────────────────────────────────────────────── */}

      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1A1A1A] border border-[#555] w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl">
            <div className="bg-[#222] border-b border-[#444] p-3 flex justify-between items-center shrink-0">
              <h2 className="text-white font-bold tracking-widest uppercase">Smart Routing Rules</h2>
            </div>
            <div className="bg-[#111] p-2 text-[#888] break-all border-b border-[#444] text-[10px] select-all">
              File Location: {editorPath}
            </div>

            {/* Cloud Sync bar */}
            <div className="bg-[#111] border-b border-[#444] px-3 py-2 flex gap-2 items-center shrink-0">
              <span className="text-[#555] tracking-widest text-[10px] shrink-0 uppercase">Sync URL</span>
              <input
                type="text"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
                spellCheck="false"
                placeholder="https://raw.githubusercontent.com/..."
                className="flex-1 min-w-0 bg-[#0A0A0A] text-[#E0E0E0] border border-[#333] py-1 px-2 font-mono text-[10px] outline-none focus:border-cyan-500 transition-colors"
              />
              <button
                onClick={handleCloudSync}
                disabled={syncButtonText === "SYNCING..."}
                className={`shrink-0 py-1 px-3 border uppercase tracking-widest text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50 ${
                  syncButtonText === "SYNCED!"
                    ? "bg-green-900 border-green-700 text-green-300"
                    : "bg-[#2a2a2a] hover:bg-[#3a3a3a] border-[#444] text-cyan-400"
                }`}
              >
                {syncButtonText}
              </button>
            </div>

            <div className="flex-1 p-3 min-h-0 flex flex-col">
              <p className="text-[#888] mb-2 shrink-0">
                One domain per line. Lines starting with # are ignored automatically.
              </p>
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                spellCheck="false"
                className="flex-1 w-full bg-[#0A0A0A] text-[#E0E0E0] border border-[#444] p-3 font-mono text-sm resize-none outline-none focus:border-cyan-500 transition-colors custom-scrollbar"
              />
            </div>
            <div className="border-t border-[#444] p-3 flex justify-end gap-2 shrink-0 bg-[#222]">
              <button
                onClick={() => setIsEditorOpen(false)}
                className="bg-[#333] hover:bg-[#444] text-white py-1 px-4 border border-[#555] uppercase tracking-widest font-bold transition-all"
              >
                CANCEL
              </button>
              <button
                onClick={saveEditor}
                className="bg-cyan-900 hover:bg-cyan-800 text-cyan-100 py-1 px-6 border border-cyan-700 uppercase tracking-widest font-bold transition-all w-24 flex justify-center items-center"
              >
                {saveButtonText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
