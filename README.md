# Reelsidian: The Obsidian for Instagram Reels & YouTube Shorts

> **Autonomous Video Intelligence, Academic Study Synthesis & Semantic Knowledge Graph**  
> *Turn passive doom-scrolling into an interconnected, actionable second brain.*

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-green.svg)](https://nodejs.org/)
[![Local Gemma 4](https://img.shields.io/badge/AI%20Model-Local%20Gemma%204-orange.svg)](https://ollama.com/)
[![Local Whisper](https://img.shields.io/badge/STT-Local%20Whisper-purple.svg)](https://github.com/SYSTRAN/faster-whisper)
[![Knowledge Graph](https://img.shields.io/badge/Visualization-Force--Graph%20%2B%20D3.js-red.svg)](https://github.com/vasturiano/force-graph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The Problem: The "Collector's Fallacy" of Social Media

Students, engineers, and lifelong learners consume hundreds of educational micro-videos every week on Instagram Reels and YouTube Shorts covering algorithms, system design, life hacks, mathematics, and productivity.

However, saving them creates a **digital graveyard**:
1. **The Bookmark Cemetery**: You save 500 reels into Instagram folders (*"Coding"*, *"Math"*, *"Productivity"*), but you almost never open them again.
2. **The Black Box Dilemma**: Video is an unsearchable format. When you need that specific 10-second explanation 3 weeks later, you cannot search inside the video audio. You are forced to re-watch dozens of flashy 60-second clips with loud background music.
3. **No Synthesis or Goal Connection**: Videos exist in total isolation. They do not connect to your actual current projects, homework, or exam goals.

---

## The Solution: Reelsidian

**Reelsidian** bridges the gap between passive short-form video consumption and permanent personal knowledge management. It captures clean audio directly from the video tab, transcribes spoken words verbatim, synthesizes a structured academic study report, and plots every concept onto an interactive, **Obsidian-style Force-Directed Knowledge Graph** that automatically links to your personal academic goals.

```
┌──────────────────────────────────────────────────────────────┐
│                    INSTAGRAM / YOUTUBE                       │
│              Educational Short-Form Video Feed               │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│            REELSIDIAN CHROME EXTENSION (MV3)                 │
│  - Obsidian Glass Dialog Popup                               │
│  - Dedicated Start Capture & Stop Capture Controls           │
│  - Real-time 7-Bar Audio Wave Equalizer Loader               │
│  - Ephemeral WebRTC tabCapture & Offscreen Opus Streamer     │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTP POST multipart/form-data
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                REELSIDIAN NODE.JS SERVER                     │
│  - Speech Transcription: Local faster-whisper                │
│  - Academic Study Synthesis: Local Gemma 4 via Ollama         │
│  - Canonical De-Duplication Engine (SHA-256 Fingerprinting)  │
│  - Local Semantic Link Evaluation (Ollama + keyword fallback)│
└──────────────────────────────┬───────────────────────────────┘
                               │ WebSocket Real-Time Stream
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  REELSIDIAN DASHBOARD                        │
│  - Fluted Glass Three.js WebGL Shader Background             │
│  - Structured Study Cards (Problem, Solution, Action Items)  │
│  - Interactive Bipartite Obsidian Knowledge Graph            │
│  - Multi-Lingual Text-to-Speech Review (EN / HI / BN)        │
│  - One-Click Anki Flashcard & Markdown Export                │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 1. Modern Chrome Extension Popup (Manifest V3)
- **Glassmorphic Popup Dialog**: Opens directly from the browser toolbar with an obsidian dark theme and burnt copper highlights.
- **Dedicated Controls**: Distinct **Start Capture** (burnt copper gradient) and **Stop Capture** (pulsing glass red border) buttons.
- **Audio-Themed Animated Wave Equalizer**: A dynamic 7-bar audio frequency wave equalizer pulses during active recording alongside a live elapsed timer (`00:00`).
- **Context-Aware Tab Detection**: Automatically detects whether you are viewing an **Instagram Reel**, a **YouTube Short**, or a generic browser video.
- **State Persistence**: The background service worker preserves active recording timers and equalizer state even if you close and reopen the popup.
- **Instant Dispatch Confirmation**: Displays a completion banner when the audio is successfully transmitted to the server with an **Open Dashboard** shortcut button.

### 2. High-Yield Academic Study Synthesis
- **Local Speech Transcription**: Powered by **faster-whisper** running on CPU with int8 quantization.
- **Structured Knowledge Extraction**: Powered by the local **Gemma 4 E2B** model through Ollama:
  - **Core Problem Breakdown**: Identifies the fundamental question or challenge.
  - **Detailed Solution & Mechanics**: Explains the technical and theoretical foundation without hand-waving.
  - **Core Key Points**: Scannable, bulleted principles.
  - **Action Items**: Immediate, practical steps the student can take.
  - **Self-Check Flashcards**: Active recall questions to test concept retention.
- **Export Ready**: Export flashcards directly to **Anki** (TSV) or copy markdown directly into **Obsidian** or **Notion**.

### 3. Obsidian-Style Goal Knowledge Graph
- **Force-Directed Bipartite Graph**: Visualizes the relationship between what you watch and what you want to achieve.
  - **Study Reports** anchor to the left ($x = -260$).
  - **Academic Goals** anchor to the right ($x = +260$).
  - Repulsive force simulation keeps cards spaced with zero overlap.
- **Frosted Glass Cards on Canvas**: Rendered directly in HTML5 Canvas with transparent obsidian backgrounds, rounded pill borders, and multi-line automatic text wrapping.
- **Local Semantic Bridges**: When a new goal or report is added, Ollama evaluates the semantic connection, generating a relevance score ($0.0 - 1.0$) and a human-readable explanation. Local keyword matching is used if Ollama is unavailable.
- **Traveling Particle Links**: Dynamic illuminated particles travel along links in the graph, showing active knowledge pathways.

### 4. Zero-Spam De-Duplication Engine
- If you watch 5 different creators explaining the same topic (e.g. *"CSS Grid vs Flexbox"* or *"JavaScript Closures"*), Reelsidian normalizes the transcript and computes a **SHA-256 canonical fingerprint**.
- Evaluates Jaccard token similarity ($\ge 80\%$). Duplicate uploads are seamlessly rejected or linked to existing nodes, preventing graph clutter.

### 5. Fluted Glass WebGL Background
- Hardware-accelerated **Three.js** custom fragment shader.
- Features vertical optical ribs, organic fluid caustics, and subtle copper/obsidian wave diffraction running at a smooth 60 FPS.

---

## Repository Structure

```
MLH-HACKATHON/
├── .env.example               # Root environment variable template
├── .gitignore                  # Security-first Git exclusions (.env, node_modules)
├── package.json               # Desktop runtime and Windows installer configuration
├── desktop/                   # Electron startup and first-run setup
├── README.md                  # Comprehensive project documentation
├── reelsidian-extension/      # Chrome Extension (Manifest V3)
│   ├── manifest.json          # Extension configuration & permissions
│   ├── popup.html             # Obsidian glass popup dialog UI
│   ├── popup.css              # Styled equalizer animations & theme tokens
│   ├── popup.js               # State coordinator, live timer, and event listener
│   ├── background.js          # Service worker managing tabs, streams, and badges
│   ├── content.js             # Intelligent video metadata extractor (IG & YouTube)
│   ├── offscreen.html         # Offscreen document container
│   └── offscreen.js           # MediaRecorder Opus streamer & API dispatcher
└── server/                    # Node.js & Express Backend
    ├── server.js              # Application entry point & static file server
    ├── package.json           # Backend dependencies and scripts
    ├── data/                  # Local SQLite database (created automatically; git-ignored)
    ├── public/                # Web Dashboard Frontend
    │   ├── index.html         # Main dashboard HTML (Deck & Graph views)
    │   ├── css/style.css      # Segregated Obsidian styling & theme tokens
    │   └── js/
    │       ├── app.js         # Knowledge Deck & Force-Directed Graph application
    │       └── shader.js      # Three.js WebGL fluted glass background shader
    └── src/                   # Backend Architecture & Services
        ├── config/
        │   └── constants.js   # API keys and model configuration
        ├── routes/
        │   └── apiRoutes.js   # /api/process, /api/goals, /api/graph endpoints
        ├── services/
        │   ├── analysisService.js      # Local Ollama educational extraction
        │   ├── graphService.js         # Force-graph engine & AI semantic link evaluator
        │   ├── sseService.js           # Server-Sent Events / WebSocket real-time hub
        │   └── transcriptionService.js # Local faster-whisper speech-to-text
        └── utils/
            └── jsonParser.js           # Resilient JSON repair utility
```

---

## Getting Started

### Prerequisites
- **Node.js**: v20.0.0 or higher for the backend; v22.12.0 or higher for the desktop development runtime
- **Google Chrome**: Latest version (Manifest V3 support)
- **Ollama for Windows**: Local model runtime
- **Python**: 3.10 or later for local faster-whisper setup

### Windows Desktop App

Install the generated `Reelsidian Setup` installer and launch Reelsidian from the Start menu or desktop shortcut. On first launch, the setup window starts the backend and checks Ollama, the local Gemma model, Python/faster-whisper, and Whisper model files. You can open the dashboard while an AI dependency is unavailable; the setup page explains what is missing.

Model downloads are never started automatically. The setup page asks before downloading Gemma 4 E2B (about 5 GB) or the configured Whisper model (about 500 MB); both require internet access and can be cancelled. If Ollama is not installed, use **Get Ollama** to install the official Windows runtime. If it is installed but stopped, select **Start Ollama service**. Whisper setup requires Python 3.10 or newer and downloads the Python packages only after you select **Set up Whisper runtime**.

For developers, install the root dependencies with `npm install` (this prepares SQLite for Electron), then launch the desktop app with `npm run dev`. Build the x64 Windows installer on Windows with `npm run dist:win`; the output is placed in `dist/`. The build does not bundle Python environments, Ollama, Gemma, Whisper weights, or user data.

The desktop app stores its database, Python virtual environment, and downloaded Whisper files under Electron's per-user `userData` directory (normally `%APPDATA%\\Reelsidian`). Updates and uninstalling the application do not remove this directory. When the app first runs over an existing `server/data/reelsidian.sqlite` database, it backs the database up into the persistent user-data directory before starting the backend. Back up this directory before manually removing it.

Troubleshooting:
- **Port already in use**: close the other service using the configured `PORT` (default `5000`) and retry.
- **Ollama unavailable**: install and start Ollama, then choose **Retry backend** or relaunch the app.
- **Gemma missing**: confirm Ollama is running, then select **Download Gemma 4 E2B** in setup.
- **Whisper unavailable**: install Python 3.10+, choose **Set up Whisper runtime**, and then explicitly download the Whisper model.

The installer is not code-signed in this repository, so Windows may show a SmartScreen publisher warning. A trusted signing certificate is required for a signed public release.

---

### Step 1: Clone & Configure Server

1. **Clone the repository**:
   ```bash
   git clone https://github.com/anshuvdebnath-cyber/MLH-HACKATHON.git
   cd MLH-HACKATHON
   ```

2. **Install and download the local models**:
   ```powershell
   ollama pull gemma4:e2b
   cd server
   py -m venv whisper-venv
   .\whisper-venv\Scripts\python.exe -m pip install -r requirements.txt
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   cd ..
   ```
   The Whisper model weights download on first transcription. Set `WHISPER_MODEL` in `server/.env` to choose a different faster-whisper model.

3. **Install Dependencies & Start Server**:
   ```bash
   cd server
   npm install
   npm start
   ```
   Your terminal will confirm:
   ```
   ======================================================
   🚀 Reelsidian Real-Time Engine active at http://localhost:5000
   ✨ Local SQLite storage: Reports, goals, graph links, and chats persist on this computer.
   📡 SSE Stream: http://localhost:5000/api/events
   ======================================================
   ```

---

### Step 2: Install Chrome Extension

1. Open Google Chrome and enter `chrome://extensions/` in the URL bar.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `reelsidian-extension/` folder from this project directory.
5. Pin **Reelsidian Audio Grabber** to your Chrome toolbar.

---

## Step-by-Step Usage Guide

### 1. Capturing an Instagram Reel or YouTube Short
1. Open any educational video on [Instagram Reels](https://www.instagram.com/reels/) or [YouTube Shorts](https://www.youtube.com/shorts/).
2. Click the **Reelsidian icon** in your Chrome toolbar.
3. The popup will automatically detect your tab (e.g. *"Instagram Reel"*).
4. Click **Start Capture**:
   - The **animated 7-bar audio wave equalizer** will begin dancing in burnt copper and amber.
   - The live timer will track the clip duration.
5. Click **Stop Capture** (or let the reel finish):
   - The audio is transmitted to the local engine.
   - The popup displays: *"Audio Sent to Website!"*.
   - Click **Open Dashboard** to jump directly to your synthesized study card.

### 2. Exploring the Dashboard
- **Knowledge Deck View**:
  - Listen to the captured clean audio.
  - Review the verbatim local Whisper transcript.
  - Read the structured problem breakdown, core solution, action items, and flashcards.
  - Export cards to Anki or copy formatted Markdown.
- **Knowledge Graph View**:
  - Click **Knowledge Graph** in the top navigation.
  - Input an academic goal (e.g., *"Master JavaScript Scopes and Closures"*).
  - Watch the graph position your goal on the right and your study cards on the left.
  - Observe the traveling particle links indicating relevance computed locally by Ollama.

---

## API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/process` | Multipart upload (`audio` buffer, `url`, `caption`, `creator`). Transcribes with local Whisper and analyzes with local Gemma 4. |
| `POST` | `/api/analyze-text` | JSON body (`text`, `caption`, `url`). Directly analyzes textual transcripts. |
| `GET` | `/api/graph` | Retrieves current graph state (`nodes`, `links`, `goals`). |
| `POST` | `/api/goals` | Adds an academic goal and triggers local Ollama semantic link evaluations. |
| `DELETE` | `/api/goals/:id` | Removes an academic goal and cleans up associated graph links. |
| `GET` | `/api/events` | Server-Sent Events (SSE) stream for real-time live updates. |
| `GET` | `/api/health` | Reports local Ollama model availability and Whisper runtime readiness. |
| `GET` | `/api/reports?search=...` | Lists and searches locally saved study reports. |
| `GET` | `/api/reports/:id` | Opens a saved report by ID. |
| `DELETE` | `/api/reports/:id` | Deletes a saved report and removes orphaned graph links. |
| `POST` | `/api/chats` | Creates a local conversation. |
| `GET` | `/api/chats?search=...` | Lists and searches saved chats and their messages. |
| `GET` | `/api/chats/:id` | Opens a chat with its conversation history. |
| `POST` | `/api/chats/:id/messages` | Appends a user, assistant, or system message to a chat. |
| `DELETE` | `/api/chats/:id` | Deletes a chat and its messages. |

---

## Privacy & Security Architecture

1. **Temporary Audio Handling**: Uploaded audio is written to a uniquely named temporary file for the local Whisper worker, then removed after transcription. The application does not retain it as a report file.
2. **Local persistence**: Reports, captions, transcripts, goals, graph connections, and chat messages are stored in `server/data/reelsidian.sqlite`. Set `REELSIDIAN_DB_PATH` to change its location. Database files are ignored by Git.
3. **Tab Capture Isolation**: The extension strictly captures the audio of the active media tab using `chrome.tabCapture`. It does not record your screen, microphone, or camera.
4. **Local inference**: Study generation and transcription do not automatically send prompts or audio to remote AI providers. Initial model downloads require internet access. Browser fonts/libraries and accessed video pages may also use the network; this project has not been certified as fully offline.

---

## Technology Stack

- **Extension**: Chrome Extension Manifest V3, Web Audio API, WebRTC `tabCapture`, `chrome.offscreen`.
- **Desktop & Backend**: Electron, Node.js, Express, Multer, SQLite, Server-Sent Events.
- **AI & Speech Models**: Local Gemma 4 E2B via Ollama and local faster-whisper.
- **Frontend & Visuals**: Vanilla JavaScript (ES6+), Three.js (WebGL Fluted Glass Shader), Force-Graph, D3.js.
- **Typography & Theme**: Outfit, JetBrains Mono, Obsidian Glass, Burnt Copper (`#ea580c`), Warm Amber (`#fed7aa`).

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details. Built for the MLH Hackathon.
