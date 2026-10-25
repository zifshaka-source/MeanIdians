const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsidian-api-'));
process.env.REELSIDIAN_DB_PATH = path.join(dataDirectory, 'api.sqlite');
process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
process.env.OLLAMA_MODEL = 'gemma4:e2b';
process.env.WHISPER_PYTHON = path.join(os.tmpdir(), 'reelsidian-api-python-not-installed.exe');

const storage = require('../src/services/storageService');
const apiRoutes = require('../src/routes/apiRoutes');
const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

let server;
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  storage.close();
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(`${baseUrl}${pathname}`, {
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      } : {}
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: responseBody ? JSON.parse(responseBody) : null
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('report API saves, searches, opens, deduplicates, reprocesses, and deletes reports', async () => {
  const originalFetch = global.fetch;
  let generationCount = 0;
  global.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://localhost:11434');
    assert.equal(url.pathname, '/api/chat');
    generationCount += 1;
    const report = {
      title: generationCount === 1 ? 'Photosynthesis Basics' : 'Photosynthesis Revised',
      analysis_and_solution: 'Plants convert light into chemical energy.',
      key_points: ['Light energy is captured by chlorophyll'],
      action_items: [],
      resources_and_links: [],
      flashcards: [],
      tags: ['Biology']
    };
    return {
      ok: true,
      json: async () => ({
        model: 'gemma4:e2b',
        message: { content: JSON.stringify(report) }
      })
    };
  };

  try {
    const created = await request('POST', '/analyze-text', {
      text: 'Photosynthesis converts carbon dioxide and water into glucose.',
      caption: 'Photosynthesis lesson',
      creator: 'student',
      url: 'https://example.test/reel/photosynthesis'
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.duplicate, false);
    const reportId = created.body.result.id;
    assert.ok(reportId);

    const duplicate = await request('POST', '/analyze-text', {
      text: 'This different text must not be generated for the same link.',
      url: 'https://EXAMPLE.test/reel/photosynthesis/?utm_source=share'
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.result.id, reportId);
    assert.equal(generationCount, 1);

    const reprocessed = await request('POST', '/analyze-text', {
      text: 'Updated photosynthesis notes.',
      url: 'https://example.test/reel/photosynthesis',
      reprocess: true
    });
    assert.equal(reprocessed.status, 200);
    assert.equal(reprocessed.body.result.id, reportId);
    assert.equal(reprocessed.body.result.analysis.title, 'Photosynthesis Revised');
    assert.equal(storage.countReports(), 1);

    const search = await request('GET', '/reports?search=Revised');
    assert.equal(search.status, 200);
    assert.equal(search.body.total, 1);
    assert.equal(search.body.reports[0].id, reportId);

    const opened = await request('GET', `/reports/${encodeURIComponent(reportId)}`);
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.report.analysis.tags, ['Biology']);

    const removed = await request('DELETE', `/reports/${encodeURIComponent(reportId)}`);
    assert.equal(removed.status, 200);
    assert.equal((await request('GET', `/reports/${encodeURIComponent(reportId)}`)).status, 404);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat APIs persist messages and support search, opening, and deletion', async () => {
  const created = await request('POST', '/chats', { title: 'Biology study' });
  assert.equal(created.status, 201);
  const chatId = created.body.chat.id;

  const userMessage = await request('POST', `/chats/${chatId}/messages`, {
    role: 'user',
    content: 'Explain photosynthesis.'
  });
  assert.equal(userMessage.status, 201);
  await request('POST', `/chats/${chatId}/messages`, {
    role: 'assistant',
    content: 'Plants convert light energy into chemical energy.'
  });

  const listing = await request('GET', '/chats?search=chemical');
  assert.equal(listing.status, 200);
  assert.equal(listing.body.chats[0].id, chatId);
  assert.equal(listing.body.chats[0].messageCount, 2);

  const opened = await request('GET', `/chats/${chatId}`);
  assert.equal(opened.body.chat.messages.length, 2);
  assert.equal(opened.body.chat.messages[0].role, 'user');

  assert.equal((await request('DELETE', `/chats/${chatId}`)).status, 200);
  assert.equal((await request('GET', `/chats/${chatId}`)).status, 404);
});

test('health API reports local model and Whisper readiness, not cloud credentials', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://localhost:11434');
    assert.equal(url.pathname, '/api/tags');
    requestCount += 1;
    return {
      ok: true,
      json: async () => ({ models: [{ name: 'gemma4:e2b' }] })
    };
  };

  try {
    const response = await request('GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.mode, 'local-persistent');
    assert.equal(response.body.ollama.ready, true);
    assert.equal(response.body.ollama.model, 'gemma4:e2b');
    assert.equal(response.body.whisper.ready, false);
    assert.match(response.body.whisper.error, /Local Whisper runtime is unavailable/);
    assert.equal(requestCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('health API reports Ollama unavailable without treating it as ready', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('connection refused');
  };

  try {
    const response = await request('GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.ollama.ready, false);
    assert.match(response.body.ollama.error, /Ollama is unavailable/);
  } finally {
    global.fetch = originalFetch;
  }
});
