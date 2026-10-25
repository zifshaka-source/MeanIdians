const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require('electron');
const Database = require('better-sqlite3');

const MODEL_NAME = 'gemma4:e2b';
const OLLAMA_URL = 'http://localhost:11434';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

app.setName('Reelsidian');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let setupWindow;
let backendProcess;
let backendOwned = false;
let backendUrl;
let backendError = null;
let ollamaPullController;
let setupProcess;

function projectRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function serverRoot() {
  return path.join(projectRoot(), 'server');
}

function whisperAssetsRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'whisper')
    : path.join(serverRoot(), 'src', 'services');
}

function loadEnvironment() {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(serverRoot(), '.env') });
  dotenv.config({ path: path.join(projectRoot(), '.env') });
}

function pythonExecutable() {
  const candidates = [
    path.join(app.getPath('userData'), 'whisper-venv', 'Scripts', 'python.exe'),
    path.join(serverRoot(), 'whisper-venv', 'Scripts', 'python.exe')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function backendEnvironment() {
  const dataDirectory = app.getPath('userData');
  return {
    ...process.env,
    REELSIDIAN_DESKTOP: 'true',
    PORT: process.env.PORT || '5000',
    OLLAMA_BASE_URL: OLLAMA_URL,
    OLLAMA_MODEL: MODEL_NAME,
    WHISPER_MODEL: process.env.WHISPER_MODEL || 'small',
    WHISPER_PYTHON: pythonExecutable(),
    WHISPER_WORKER_PATH: path.join(whisperAssetsRoot(), 'whisper_worker.py'),
    WHISPER_LOCAL_FILES_ONLY: 'true',
    HF_HOME: path.join(dataDirectory, 'huggingface'),
    HF_HUB_CACHE: path.join(dataDirectory, 'huggingface', 'hub'),
    REELSIDIAN_DB_PATH: path.join(dataDirectory, 'reelsidian.sqlite')
  };
}

function backendAddress() {
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port number.');
  }
  return `http://127.0.0.1:${port}`;
}

function isReelsidianHealth(health) {
  return health?.service === 'reelsidian' ||
    (health?.status === 'online' && health.ollama && health.whisper);
}

async function migrateExistingDatabase(destination) {
  if (fs.existsSync(destination)) return;

  const legacyCandidates = [
    process.env.REELSIDIAN_DB_PATH
      ? path.resolve(serverRoot(), process.env.REELSIDIAN_DB_PATH)
      : null,
    path.join(app.getPath('appData'), 'mlh-hackathon-workspace', 'reelsidian.sqlite'),
    path.join(serverRoot(), 'data', 'reelsidian.sqlite')
  ].filter(Boolean);

  for (const source of [...new Set(legacyCandidates)]) {
    if (source === destination || !fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const database = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await database.backup(destination);
      console.log(`Migrated existing Reelsidian database from ${source}.`);
    } finally {
      database.close();
    }
    return;
  }
}

async function readJson(url, timeout = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function findOllamaExecutable() {
  const result = spawnSync('where.exe', ['ollama'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3000
  });
  if (result.status === 0) {
    const executable = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (executable) return executable;
  }
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    path.join(programFiles, 'Ollama', 'ollama.exe')
  ].find((candidate) => fs.existsSync(candidate)) || null;
}

async function getStatus() {
  const health = backendUrl ? await readJson(`${backendUrl}/api/health`, 35000) : null;
  const ollamaTags = await readJson(`${OLLAMA_URL}/api/tags`);
  const modelInstalled = Boolean(ollamaTags?.models?.some((model) =>
    model.name === MODEL_NAME || model.model === MODEL_NAME
  ));
  return {
    backendReady: Boolean(isReelsidianHealth(health)),
    backendError,
    ollamaInstalled: Boolean(findOllamaExecutable()),
    ollamaRunning: Boolean(ollamaTags),
    modelInstalled,
    model: MODEL_NAME,
    whisperReady: health?.whisper?.ready === true,
    whisperError: health?.whisper?.error || 'The backend health check is unavailable.',
    pythonAvailable: fs.existsSync(pythonExecutable()),
    databasePath: path.join(app.getPath('userData'), 'reelsidian.sqlite'),
    pythonPath: pythonExecutable()
  };
}

async function startOllamaService() {
  if (await readJson(`${OLLAMA_URL}/api/tags`)) return getStatus();
  const executable = findOllamaExecutable();
  if (!executable) throw new Error('Install Ollama for Windows before starting its local service.');

  const child = spawn(executable, ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.once('error', (error) => sendProgress('setup-progress', `Could not start Ollama: ${error.message}`));
  child.unref();
  sendProgress('setup-progress', 'Starting the local Ollama service…');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await readJson(`${OLLAMA_URL}/api/tags`)) return getStatus();
    await sleep(500);
  }
  throw new Error('Ollama did not start. Start the Ollama application and retry.');
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 640,
    minHeight: 640,
    title: 'Reelsidian Setup',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!app.isQuitting) app.quit();
  });
}

async function startBackend() {
  backendUrl = backendAddress();
  const existing = await probe(`${backendUrl}/api/desktop-ready`);
  if (existing) {
    if (existing.body?.service === 'reelsidian') {
      console.log('Using the existing Reelsidian backend; not starting a duplicate.');
      return;
    }
    const legacyHealth = await readJson(`${backendUrl}/api/health`);
    if (isReelsidianHealth(legacyHealth)) {
      console.log('Using the existing Reelsidian backend; not starting a duplicate.');
      return;
    }
    throw new Error(`Port ${new URL(backendUrl).port} is already in use by another service.`);
  }

  const environment = backendEnvironment();
  await migrateExistingDatabase(environment.REELSIDIAN_DB_PATH);
  backendProcess = utilityProcess.fork(
    path.join(serverRoot(), 'server.js'),
    [],
    { serviceName: 'Reelsidian backend', env: environment, stdio: 'pipe' }
  );
  backendOwned = true;
  backendProcess.stdout?.on('data', (data) => console.log(data.toString().trimEnd()));
  backendProcess.stderr?.on('data', (data) => console.error(data.toString().trimEnd()));
  backendProcess.on('exit', (code) => {
    if (!app.isQuitting && backendOwned) {
      backendError = `The local backend stopped unexpectedly (exit code ${code}).`;
      setupWindow?.webContents.send('backend-error', backendError);
    }
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (backendProcess.exitCode !== null) {
      throw new Error('The backend stopped while starting. Review the startup log and port configuration.');
    }
    const ready = await readJson(`${backendUrl}/api/desktop-ready`);
    if (ready?.service === 'reelsidian') return;
    await sleep(500);
  }
  throw new Error('The backend did not become ready within 30 seconds.');
}

function sendProgress(channel, message) {
  setupWindow?.webContents.send(channel, message);
}

async function pullOllamaModel() {
  if (ollamaPullController) throw new Error('An Ollama model download is already running.');
  ollamaPullController = new AbortController();
  try {
    const response = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL_NAME, stream: true }),
      signal: ollamaPullController.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`Ollama model download failed (HTTP ${response.status}).`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const item = JSON.parse(line);
        const progress = item.total && item.completed
          ? ` (${Math.floor(item.completed / item.total * 100)}%)`
          : '';
        sendProgress('setup-progress', `${item.status || 'Downloading model'}${progress}`);
        if (item.error) throw new Error(item.error);
      }
    }
    if (pending.trim()) {
      const item = JSON.parse(pending);
      if (item.error) throw new Error(item.error);
    }
    return await getStatus();
  } finally {
    ollamaPullController = null;
  }
}

function runCommand(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      ...options
    });
    setupProcess = child;
    const report = (chunk) => sendProgress('setup-progress', chunk.toString().trim());
    child.stdout?.on('data', report);
    child.stderr?.on('data', report);
    child.once('error', (error) => {
      setupProcess = null;
      reject(error);
    });
    child.once('close', (code) => {
      setupProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`Setup command exited with code ${code}.`));
    });
  });
}

async function prepareWhisperEnvironment() {
  if (setupProcess) throw new Error('A local setup task is already running.');
  const venvPath = path.join(app.getPath('userData'), 'whisper-venv');
  const python = path.join(venvPath, 'Scripts', 'python.exe');
  const requirements = path.join(whisperAssetsRoot(), 'requirements.txt');
  if (fs.existsSync(python)) {
    sendProgress('setup-progress', 'Installing faster-whisper into the existing environment…');
  } else {
    const launcher = spawnSync('py', [
      '-3',
      '-c',
      'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    const version = launcher.stdout?.trim().split('.').map(Number) || [];
    if (
      launcher.status !== 0 ||
      version.length < 2 ||
      version[0] < 3 ||
      (version[0] === 3 && version[1] < 10)
    ) {
      throw new Error('Install Python 3.10 or newer from python.org, then retry Whisper setup.');
    }
    sendProgress('setup-progress', 'Creating the local Whisper Python environment…');
    await runCommand('py', ['-3', '-m', 'venv', venvPath]);
  }
  sendProgress('setup-progress', 'Installing faster-whisper. This requires an internet connection…');
  await runCommand(python, [
    '-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements
  ]);
  process.env.WHISPER_PYTHON = python;
  return await getStatus();
}

async function prepareWhisperModel() {
  if (setupProcess) throw new Error('A local setup task is already running.');
  const python = pythonExecutable();
  if (!fs.existsSync(python)) {
    throw new Error('Set up the Whisper Python environment before downloading its model.');
  }
  const worker = path.join(whisperAssetsRoot(), 'whisper_worker.py');
  const environment = {
    ...process.env,
    WHISPER_MODEL: process.env.WHISPER_MODEL || 'small',
    HF_HOME: path.join(app.getPath('userData'), 'huggingface'),
    HF_HUB_CACHE: path.join(app.getPath('userData'), 'huggingface', 'hub')
  };
  sendProgress('setup-progress', 'Preparing the Whisper model. Download progress will appear below…');
  await runCommand(python, [worker, '--prepare'], { env: environment });
  return await getStatus();
}

ipcMain.handle('setup:get-status', getStatus);
ipcMain.handle('setup:retry-backend', async () => {
  backendError = null;
  try {
    await startBackend();
  } catch (error) {
    backendError = error.message;
  }
  return getStatus();
});
ipcMain.handle('setup:open-dashboard', async () => {
  const ready = backendUrl ? await readJson(`${backendUrl}/api/desktop-ready`) : null;
  if (ready?.service !== 'reelsidian') {
    throw new Error(backendError || 'The Reelsidian backend is not ready.');
  }
  await setupWindow.loadURL(backendUrl);
  setupWindow.setTitle('Reelsidian');
});
ipcMain.handle('setup:pull-ollama-model', pullOllamaModel);
ipcMain.handle('setup:cancel-ollama-model', () => {
  ollamaPullController?.abort();
  return true;
});
ipcMain.handle('setup:start-ollama', startOllamaService);
ipcMain.handle('setup:prepare-whisper-environment', prepareWhisperEnvironment);
ipcMain.handle('setup:prepare-whisper-model', prepareWhisperModel);
ipcMain.handle('setup:cancel-process', () => {
  if (setupProcess) setupProcess.kill();
  return true;
});
ipcMain.handle('setup:open-ollama-download', () =>
  shell.openExternal('https://ollama.com/download/windows')
);

app.on('second-instance', () => {
  if (setupWindow) {
    if (setupWindow.isMinimized()) setupWindow.restore();
    setupWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  ollamaPullController?.abort();
  setupProcess?.kill();
  if (backendOwned) backendProcess?.kill();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  loadEnvironment();
  createSetupWindow();
  try {
    await startBackend();
  } catch (error) {
    backendError = error.message;
    sendProgress('setup-progress', `Backend startup error: ${error.message}`);
  }
  setupWindow?.webContents.send('setup:ready');
}).catch(async (error) => {
  await dialog.showMessageBox({ type: 'error', title: 'Reelsidian startup failed', message: error.message });
  app.quit();
});

app.on('window-all-closed', () => app.quit());
