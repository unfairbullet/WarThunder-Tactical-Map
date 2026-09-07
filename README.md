# WarThunder Tactical Map

The localhost telemetry site looks like hot dog water if you actually want to use it, this aims to make it at least somewhat visually appealing.

A desktop tactical map + telemetry viewer for War Thunder. It reads the game's official local telemetry server (`http://localhost:8111`, the same data behind the in-game browser map page) and shows it in a resizable window. Everything that can be pulled is pulled, live map with unit positions and headings, per-unit trail history, your vehicle's telemetry, game chat, and a persistent kill feed.

No memory reading, no packet sniffing, no overlays injected into the game. It only makes HTTP requests to the game's own localhost server.

Repo: https://github.com/unfairbullet/WarThunder-Tactical-Map/tree/main — bug reports and suggestions welcome via [issues](https://github.com/unfairbullet/WarThunder-Tactical-Map/issues).

Licensed under the Apache License 2.0 — see [LICENSE](LICENSE). Free to use and modify; keep the license notice when redistributing.

## Run without building

1. Have War Thunder running (the telemetry server only answers while the game is open).
2. Download and run `release/warthunder-tactical.exe` — no install needed.
3. Drag the window to your second monitor and resize it freely.

Windows 10/11 only. Requires the WebView2 runtime, which ships with Windows 10/11 by default.

## Build it yourself

You need:

- **Node.js 18+** (includes npm) — https://nodejs.org/
- **Rust (stable)** via rustup — https://rustup.rs/
- **Visual Studio Build Tools** with the "Desktop development with C++" workload (for compiling on Windows) — https://visualstudio.microsoft.com/downloads/
- **WebView2 runtime** (preinstalled on Windows 10/11) — https://developer.microsoft.com/microsoft-edge/webview2/

Steps:

```powershell
# 0. Clone the repo
git clone https://github.com/unfairbullet/WarThunder-Tactical-Map.git
cd WarThunder-Tactical-Map

# 1. Install frontend dependencies
npm install

# 2. Build the frontend
npm run build

# 3. Build the standalone exe (output below)
npx tauri build --no-bundle
```

The finished exe lands at `src-tauri\target\release\warthunder-tactical.exe`. (`cargo check` in `src-tauri/` is a faster sanity check if you only touched Rust code.)

For web-only development (no Tauri build), `npm run dev` starts the Vite preview instead.

## How it works

- **Rust backend** (`src-tauri/src/poller.rs`) polls the game's endpoints sequentially, the game answers one request at a time with no keep-alive, so polite sequential polling is what keeps it smooth. Chat/kill messages poll on a slower background loop.
- **Frontend** (React + Vite + Zustand + Canvas 2D) renders the map image with unit icons, persistent friendly-unit trails from match start, own-vehicle telemetry (metric/imperial toggle), selected-target info, game chat, and a whole-match kill feed.
- A new match is detected via `map_generation`; trails and feeds reset automatically.

## Project layout

```
src/                  React frontend (components, store, telemetry client)
src-tauri/            Tauri wrapper + Rust poller
src-tauri/src/poller.rs   all localhost:8111 polling lives here
public/placeholder-map.png  neutral fallback shown if a map image fails to load
release/              prebuilt portable exe
```
