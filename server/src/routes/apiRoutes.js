/**
 * API Routes for Reelsidian Engine
 */

const express = require('express');
const multer = require('multer');
const {
  MAX_AUDIO_SIZE,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  WHISPER_MODEL
} = require('../config/constants');
const { registerClient, broadcast, getConnectedClientsCount } = require('../services/sseService');
const { transcribeAudio, checkWhisperReady } = require('../services/transcriptionService');
const { analyzeContent, checkOllamaReady } = require('../services/analysisService');
const storage = require('../services/storageService');
const {
  addGoal,
  deleteGoal,
  addReportToGraph,
  getGraph
} = require('../services/graphService');

const router = express.Router();

// Keep incoming audio in memory; the local Whisper worker uses a temporary file when needed.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_SIZE }
});

function findExistingLinkResult(url) {
  if (!url) return null;
  const report = storage.getReportByUrl(url);
  return report ? { success: true, result: report, duplicate: true } : null;
}

async function persistReportResult(result, { reprocess = false } = {}) {
  const saved = storage.saveReport(result, { reprocess });
  if (saved.duplicate) {
    return { result: saved.report, duplicate: true };
  }

  const graphResult = await addReportToGraph(saved.report);
  broadcast('graph_update', graphResult.graph);
  return {
    result: { ...saved.report, ...(result.audioDataUrl ? { audioDataUrl: result.audioDataUrl } : {}) },
    duplicate: false
  };
}

// SSE Events stream
router.get('/events', (req, res) => {
  registerClient(req, res);
});

// Real-Time Audio Processing Pipeline
router.post('/process', upload.single('audio'), async (req, res) => {
  const creator = (req.body.creator || 'creator').replace(/^@/, '');
  const caption = (req.body.caption || '').trim();
  const url = (req.body.url || '').trim();
  const reprocess = req.body.reprocess === 'true' || req.body.reprocess === '1';

  if (!reprocess) {
    const duplicate = findExistingLinkResult(url);
    if (duplicate) return res.json(duplicate);
  }

  // Validate audio buffer
  if (!req.file || req.file.size < 300) {
    // If no audio but caption is present, we can still analyze!
    if (caption.length > 5) {
      console.log(`\n⚡ LIVE PROCESSING: Text/Caption only from @${creator}`);
      try {
        broadcast('status', { step: 'analyzing', message: 'Analyzing caption with local Ollama...' });
        const analysis = await analyzeContent('', caption, url);
        const result = {
          id: 'card_' + Date.now(),
          creator,
          url,
          caption,
          transcript: '(No audio provided - analyzed directly from caption)',
          notice: 'Caption-only analysis',
          analysis: analysis.data,
          modelUsed: analysis.model,
          processedAt: new Date().toLocaleTimeString()
        };
        const persisted = await persistReportResult(result, { reprocess });
        broadcast('result', persisted.result);
        return res.json({ success: true, result: persisted.result, duplicate: persisted.duplicate });
      } catch (err) {
        broadcast('status', { step: 'error', message: `Error: ${err.message}` });
        return res.status(500).json({ error: err.message });
      }
    }
    return res.status(400).json({ error: 'No audio captured or recording was too short (<0.5s).' });
  }

  const audioDataUrl = `data:${req.file.mimetype || 'audio/webm'};base64,${req.file.buffer.toString('base64')}`;
  console.log(`\nLIVE PROCESSING: Reel from @${creator} (${(req.file.size / 1024).toFixed(1)} KB)`);

  broadcast('status', {
    step: 'transcribing',
    message: 'Transcribing speech locally with Whisper...'
  });

  try {
    // 1. Transcription (with graceful fallback for music/silence)
    const sttResult = await transcribeAudio(req.file.buffer, req.file.mimetype);
    console.log(`STT Output: "${(sttResult.transcript || sttResult.notice || '').slice(0, 70)}..."`);

    broadcast('status', {
      step: 'analyzing',
      message: 'Generating comprehensive study report...'
    });

    // 2. Structured Analysis
    const analysis = await analyzeContent(sttResult.transcript, caption, url);
    console.log(`Study report generated with ${analysis.source || analysis.model}: "${analysis.data.title}"`);

    const result = {
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      creator,
      url,
      caption,
      audioDataUrl,
      transcript: sttResult.transcript,
      notice: sttResult.notice,
      analysis: analysis.data,
      modelUsed: analysis.model,
      processedAt: new Date().toLocaleTimeString()
    };

    const persisted = await persistReportResult(result, { reprocess });
    if (persisted.duplicate) {
      return res.json({ success: true, result: persisted.result, duplicate: true });
    }

    // Broadcast live to all connected browser dashboards
    broadcast('result', persisted.result);

    // Audio buffer in req.file.buffer is naturally freed by garbage collector
    return res.json({ success: true, result: persisted.result, duplicate: false });
  } catch (err) {
    console.error('Pipeline error:', err.message);
    broadcast('status', {
      step: 'error',
      message: `Error: ${err.message}`
    });
    return res.status(500).json({ error: err.message });
  }
});

// Backward compatibility alias for the Chrome extension
router.post('/ingest', (req, res, next) => {
  req.url = '/process';
  router.handle(req, res, next);
});

// Quick Text / Caption Analysis (No audio file required)
router.post('/analyze-text', express.json(), async (req, res) => {
  const { text, caption, creator, url } = req.body;
  const content = (text || caption || '').trim();

  if (!content) {
    return res.status(400).json({ error: 'Please provide some text or reel caption to analyze.' });
  }

  const reprocess = req.body.reprocess === true || req.body.reprocess === 'true';
  if (!reprocess) {
    const duplicate = findExistingLinkResult((url || '').trim());
    if (duplicate) return res.json(duplicate);
  }

  try {
    broadcast('status', { step: 'analyzing', message: 'Analyzing text with local Ollama...' });
    const analysis = await analyzeContent(content, caption || '', url || '');

    const result = {
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      creator: (creator || 'text_input').replace(/^@/, ''),
      url: url || '',
      caption: caption || '',
      transcript: content,
      notice: 'Text/Notes mode',
      analysis: analysis.data,
      modelUsed: analysis.model,
      processedAt: new Date().toLocaleTimeString()
    };

    const persisted = await persistReportResult(result, { reprocess });
    if (!persisted.duplicate) broadcast('result', persisted.result);
    return res.json({
      success: true,
      result: persisted.result,
      duplicate: persisted.duplicate
    });
  } catch (err) {
    broadcast('status', { step: 'error', message: `Error: ${err.message}` });
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Knowledge Graph & Academic Goals Endpoints
// ============================================================
router.get(['/reports', '/saved'], (req, res) => {
  const search = req.query.search || req.query.q || '';
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({
    success: true,
    reports: storage.listReports({ search, limit, offset }),
    total: storage.countReports({ search }),
    limit,
    offset
  });
});

router.get('/reports/:id', (req, res) => {
  const report = storage.getReportById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Saved report not found.' });
  return res.json({ success: true, report });
});

router.delete('/reports/:id', (req, res) => {
  if (!storage.deleteReport(req.params.id)) {
    return res.status(404).json({ error: 'Saved report not found.' });
  }
  broadcast('graph_update', getGraph());
  return res.json({ success: true });
});

router.get('/chats', (req, res) => {
  const search = req.query.search || req.query.q || '';
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return res.json({
    success: true,
    chats: storage.listChats({ search, limit, offset }),
    limit,
    offset
  });
});

router.post('/chats', express.json(), (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (title.length > 200) return res.status(400).json({ error: 'Chat title must be 200 characters or fewer.' });
  const chat = storage.createChat(title);
  return res.status(201).json({ success: true, chat: { ...chat, messages: [] } });
});

router.get('/chats/:id', (req, res) => {
  const chat = storage.getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  return res.json({ success: true, chat });
});

router.post('/chats/:id/messages', express.json(), (req, res) => {
  const { role, content } = req.body;
  if (!['user', 'assistant', 'system'].includes(role)) {
    return res.status(400).json({ error: 'Message role must be user, assistant, or system.' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Message content cannot be empty.' });
  }
  if (content.length > 100000) {
    return res.status(400).json({ error: 'Message content must be 100000 characters or fewer.' });
  }
  const message = storage.addChatMessage(req.params.id, { role, content: content.trim() });
  if (!message) return res.status(404).json({ error: 'Chat not found.' });
  return res.status(201).json({ success: true, message });
});

router.delete('/chats/:id', (req, res) => {
  if (!storage.deleteChat(req.params.id)) {
    return res.status(404).json({ error: 'Chat not found.' });
  }
  return res.json({ success: true });
});

router.get('/graph', (req, res) => {
  res.json({ success: true, graph: getGraph() });
});

router.post('/goals', express.json(), async (req, res) => {
  try {
    const { goalText } = req.body;
    const result = await addGoal(goalText);
    broadcast('graph_update', result.graph);
    res.json({ success: true, goal: result.goal, graph: result.graph });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/goals/:id', (req, res) => {
  try {
    const graph = deleteGoal(req.params.id);
    broadcast('graph_update', graph);
    res.json({ success: true, graph });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Diagnostic & Health Endpoint
router.get('/health', async (req, res) => {
  const [ollama, whisper] = await Promise.all([
    checkOllamaReady(),
    checkWhisperReady()
  ]);

  res.json({
    service: 'reelsidian',
    status: 'online',
    mode: 'local-persistent',
    connected_dashboards: getConnectedClientsCount(),
    ollama: {
      ready: ollama.ready,
      base_url: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      error: ollama.error
    },
    whisper: {
      ready: whisper.ready,
      model: WHISPER_MODEL,
      error: whisper.error
    }
  });
});

module.exports = router;
