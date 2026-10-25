const path = require('path');
const fs = require('fs');

// 1. Check server/.env
const serverEnv = path.resolve(__dirname, '../../.env');
if (fs.existsSync(serverEnv)) {
  require('dotenv').config({ path: serverEnv });
}

// 2. Check root .env
const rootEnv = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
}

// 3. Fallback standard CWD .env
require('dotenv').config();

function getLocalOllamaBaseUrl(value) {
  const configuredUrl = value || 'http://localhost:11434';
  let parsedUrl;

  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error('OLLAMA_BASE_URL must be a valid local URL (http://localhost:11434).');
  }

  if (
    parsedUrl.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(parsedUrl.hostname) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error('OLLAMA_BASE_URL must point to localhost or 127.0.0.1 over HTTP.');
  }

  return configuredUrl.replace(/\/+$/, '');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  OLLAMA_BASE_URL: getLocalOllamaBaseUrl(process.env.OLLAMA_BASE_URL),
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'gemma4:e2b',
  WHISPER_MODEL: process.env.WHISPER_MODEL || 'small',
  WHISPER_PYTHON: process.env.WHISPER_PYTHON ||
    path.resolve(__dirname, '../../whisper-venv/Scripts/python.exe'),
  WHISPER_WORKER_PATH: process.env.WHISPER_WORKER_PATH ||
    path.join(__dirname, '../services/whisper_worker.py'),
  WHISPER_TIMEOUT_MS: Number(process.env.WHISPER_TIMEOUT_MS) || 600000,
  // Maximum uploaded audio size before local Whisper writes a temporary file.
  MAX_AUDIO_SIZE: 30 * 1024 * 1024,
  API_TIMEOUT_MS: 120000,
  OLLAMA_GENERATION_TIMEOUT_MS: Number(process.env.OLLAMA_GENERATION_TIMEOUT_MS) || 600000
};
