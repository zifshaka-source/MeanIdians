const desktop = window.reelsidianDesktop;
const elements = {
  backend: document.getElementById('backendStatus'),
  ollama: document.getElementById('ollamaStatus'),
  whisper: document.getElementById('whisperStatus'),
  database: document.getElementById('databasePath'),
  progress: document.getElementById('progress'),
  downloadOllama: document.getElementById('downloadOllama'),
  startOllama: document.getElementById('startOllama'),
  cancelDownload: document.getElementById('cancelDownload'),
  setupWhisper: document.getElementById('setupWhisper'),
  downloadWhisper: document.getElementById('downloadWhisper'),
  cancelSetup: document.getElementById('cancelSetup'),
  openApp: document.getElementById('openApp')
};

function appendProgress(message) {
  elements.progress.textContent = `${elements.progress.textContent}\n${message}`.trim();
  elements.progress.scrollTop = elements.progress.scrollHeight;
}

function setBusy(action) {
  const ollamaBusy = action === 'ollama';
  const setupBusy = action === 'whisper';
  elements.downloadOllama.disabled = ollamaBusy || setupBusy;
  elements.cancelDownload.disabled = !ollamaBusy;
  elements.setupWhisper.disabled = ollamaBusy || setupBusy;
  elements.downloadWhisper.disabled = ollamaBusy || setupBusy;
  elements.cancelSetup.disabled = !setupBusy;
}

async function refreshStatus() {
  try {
    const status = await desktop.getStatus();
    elements.backend.textContent = status.backendReady
      ? 'Ready. The backend is running locally.'
      : `Not ready. ${status.backendError || 'The server has not responded yet.'}`;
    elements.ollama.textContent = !status.ollamaInstalled
      ? 'Ollama is not installed or is not available on PATH.'
      : !status.ollamaRunning
        ? 'Ollama is installed but its local service is not running.'
        : status.modelInstalled
          ? `Ready. ${status.model} is installed locally.`
          : `${status.model} is not installed yet.`;
    elements.startOllama.disabled = !status.ollamaInstalled || status.ollamaRunning;
    elements.startOllama.textContent = status.ollamaRunning ? 'Ollama is running' : 'Start Ollama service';
    document.getElementById('openOllama').hidden = status.ollamaInstalled;
    elements.whisper.textContent = status.whisperReady
      ? 'Ready. Python, faster-whisper, and the selected model files are available.'
      : status.whisperError;
    elements.database.textContent = status.databasePath;
    elements.downloadOllama.disabled = !status.ollamaRunning;
    elements.setupWhisper.textContent = status.whisperReady ? 'Whisper is ready' : 'Set up Whisper runtime';
    elements.setupWhisper.disabled = status.whisperReady;
    elements.downloadWhisper.disabled = status.whisperReady || !status.pythonAvailable;
    elements.openApp.disabled = !status.backendReady;
  } catch (error) {
    appendProgress(`Readiness check failed: ${error.message}`);
  }
}

async function runAction(action) {
  try {
    setBusy(action);
    appendProgress(action === 'ollama' ? 'Starting Ollama model download…' : 'Starting Whisper setup…');
    const status = await action();
    if (status) await refreshStatus();
    appendProgress('Setup action finished.');
  } catch (error) {
    appendProgress(error.message);
  } finally {
    setBusy(null);
    await refreshStatus();
  }
}

document.getElementById('retryBackend').addEventListener('click', async () => {
  appendProgress('Checking backend startup…');
  const status = await desktop.retryBackend();
  if (status.backendError) appendProgress(status.backendError);
  await refreshStatus();
});

document.getElementById('openOllama').addEventListener('click', () => desktop.openOllamaDownload());
elements.startOllama.addEventListener('click', async () => {
  try {
    elements.startOllama.disabled = true;
    appendProgress('Starting the local Ollama service…');
    await desktop.startOllama();
    await refreshStatus();
  } catch (error) {
    appendProgress(error.message);
  } finally {
    await refreshStatus();
  }
});
elements.downloadOllama.addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Download Gemma 4 E2B with Ollama? It requires about 5 GB of free disk space and an internet connection. The download can be cancelled.'
  );
  if (confirmed) await runAction(() => desktop.pullOllamaModel());
});
elements.cancelDownload.addEventListener('click', () => desktop.cancelOllamaModel());
elements.setupWhisper.addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Set up local Whisper? This creates a Python virtual environment and downloads faster-whisper packages. Python 3.10+ and an internet connection are required.'
  );
  if (confirmed) await runAction(() => desktop.prepareWhisperEnvironment());
});
elements.downloadWhisper.addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Download the configured Whisper model? The small model uses about 500 MB of disk space and requires internet access. The download can be cancelled.'
  );
  if (confirmed) await runAction(() => desktop.prepareWhisperModel());
});
elements.cancelSetup.addEventListener('click', () => desktop.cancelProcess());
elements.openApp.addEventListener('click', async () => {
  try {
    await desktop.openDashboard();
  } catch (error) {
    appendProgress(error.message);
    await refreshStatus();
  }
});

desktop.onProgress(appendProgress);
desktop.onBackendError((message) => {
  elements.backend.textContent = message;
  elements.openApp.disabled = true;
});
desktop.onReady(refreshStatus);
refreshStatus();
