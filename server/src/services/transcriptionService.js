/**
 * Local faster-whisper transcription.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  WHISPER_MODEL,
  WHISPER_PYTHON,
  WHISPER_WORKER_PATH,
  WHISPER_TIMEOUT_MS
} = require('../config/constants');

const execFileAsync = promisify(execFile);

function getAudioExtension(mimeType) {
  const mime = (mimeType || '').split(';', 1)[0].trim().toLowerCase();
  const extensions = {
    'audio/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'audio/x-wav': '.wav'
  };
  return extensions[mime] || '.webm';
}

function getWorkerError(error) {
  if (typeof error.stdout === 'string') {
    let workerResult;
    try {
      workerResult = JSON.parse(error.stdout);
    } catch {
      return error;
    }
    if (workerResult.error) {
      return new Error(workerResult.error);
    }
  }
  return error;
}

async function transcribeLocally(buffer, mimeType) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reelsidian-whisper-'));
  const audioPath = path.join(tempDir, `recording${getAudioExtension(mimeType)}`);
  const workerPath = WHISPER_WORKER_PATH;

  try {
    await fs.writeFile(audioPath, buffer);

    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        WHISPER_PYTHON,
        [workerPath, audioPath],
        {
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          timeout: WHISPER_TIMEOUT_MS,
          windowsHide: true
        }
      ));
    } catch (error) {
      throw getWorkerError(error);
    }

    const result = JSON.parse(stdout);
    if (typeof result.transcript !== 'string') {
      throw new Error(result.error || 'Whisper worker returned an invalid response.');
    }

    const transcript = result.transcript.trim();
    return {
      transcript,
      hasSpeech: transcript.length > 0,
      notice: transcript.length > 0 ? null : 'No spoken words detected (music/visual reel).'
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function transcribeAudio(buffer, mimeType) {
  try {
    const result = await transcribeLocally(buffer, mimeType);
    console.log(`Local Whisper (${WHISPER_MODEL}) transcription succeeded.`);
    return result;
  } catch (err) {
    console.warn(`Local Whisper transcription failed: ${err.message}`);
    return {
      transcript: '',
      hasSpeech: false,
      notice: `Local transcription unavailable (${err.message}). Using provided caption context if available.`
    };
  }
}

async function checkWhisperReady() {
  try {
    await fs.access(WHISPER_WORKER_PATH);
    const { stdout } = await execFileAsync(WHISPER_PYTHON, [WHISPER_WORKER_PATH, '--check'], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true
    });
    const result = JSON.parse(stdout);
    return {
      ready: result.ready === true,
      model: WHISPER_MODEL,
      error: result.ready ? null : result.error || 'Whisper model files are not downloaded.'
    };
  } catch (err) {
    return {
      ready: false,
      model: WHISPER_MODEL,
      error: `Local Whisper runtime is unavailable: ${err.message}`
    };
  }
}

module.exports = {
  transcribeAudio,
  checkWhisperReady
};
