const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
process.env.OLLAMA_MODEL = 'gemma4:e2b';
process.env.WHISPER_PYTHON = path.join(os.tmpdir(), 'reelsidian-test-python-not-installed.exe');
const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsidian-local-ai-'));
process.env.REELSIDIAN_DB_PATH = path.join(testDataDirectory, 'local-ai.sqlite');
test.after(() => {
  storage.close();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

const { analyzeContent, checkOllamaReady } = require('../src/services/analysisService');
const { addGoal, addReportToGraph } = require('../src/services/graphService');
const { transcribeAudio } = require('../src/services/transcriptionService');
const storage = require('../src/services/storageService');

const validReport = {
  title: 'Binary Search',
  analysis_and_solution: 'Binary search repeatedly halves a sorted search interval.',
  key_points: ['Requires sorted input'],
  action_items: ['Compare the target with the midpoint'],
  resources_and_links: [],
  flashcards: [],
  tags: ['Algorithms']
};

function mockLocalFetch(implementation) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (input, options) => {
    const requestUrl = new URL(input);
    assert.ok(
      ['localhost', '127.0.0.1'].includes(requestUrl.hostname),
      `Unexpected non-local network request: ${requestUrl.hostname}`
    );
    requests.push({ url: requestUrl, options });
    return implementation(requestUrl, options);
  };
  return {
    requests,
    restore() {
      global.fetch = originalFetch;
    }
  };
}

test('study reports use local Ollama and preserve report fields', async () => {
  const fetchMock = mockLocalFetch(async (url, options) => {
    assert.equal(url.href, 'http://localhost:11434/api/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gemma4:e2b');
    return {
      ok: true,
      json: async () => ({
        model: 'gemma4:e2b',
        message: { content: JSON.stringify(validReport) }
      })
    };
  });

  try {
    const report = await analyzeContent('A sorted array is searched by midpoint.', '', '');
    assert.equal(report.source, 'Ollama');
    assert.equal(report.model, 'gemma4:e2b');
    assert.deepEqual(report.data, validReport);
    assert.equal(fetchMock.requests.length, 1);
  } finally {
    fetchMock.restore();
  }
});

test('study report generation fails locally without making a cloud fallback request', async () => {
  const fetchMock = mockLocalFetch(async () => {
    throw new Error('connection refused');
  });

  try {
    await assert.rejects(
      analyzeContent('A sample transcript.', '', ''),
      /Local Ollama could not generate the study report/
    );
    assert.equal(fetchMock.requests.length, 1);
  } finally {
    fetchMock.restore();
  }
});

test('study report timeout explains that local generation may need more time', async () => {
  const fetchMock = mockLocalFetch(async () => {
    throw new DOMException('The operation was aborted.', 'AbortError');
  });

  try {
    await assert.rejects(
      analyzeContent('A sample transcript.', '', ''),
      /did not finish within 600 seconds.*Increase OLLAMA_GENERATION_TIMEOUT_MS/
    );
    assert.equal(fetchMock.requests.length, 1);
  } finally {
    fetchMock.restore();
  }
});

test('Ollama readiness requires the configured local model', async () => {
  const fetchMock = mockLocalFetch(async () => ({
    ok: true,
    json: async () => ({ models: [{ name: 'another-model' }] })
  }));

  try {
    const status = await checkOllamaReady();
    assert.equal(status.ready, false);
    assert.match(status.error, /gemma4:e2b/);
    assert.equal(fetchMock.requests.length, 1);
  } finally {
    fetchMock.restore();
  }
});

test('graph evaluation uses local Ollama and retains keyword fallback', async () => {
  const fetchMock = mockLocalFetch(async (url, options) => {
    assert.equal(url.href, 'http://localhost:11434/api/generate');
    assert.equal(JSON.parse(options.body).model, 'gemma4:e2b');
    return { ok: false, status: 503 };
  });

  try {
    const { goal } = await addGoal('Study binary search algorithms');
    const result = await addReportToGraph({
      transcript: 'Binary search repeatedly halves the search interval.',
      analysis: {
        title: 'Binary Search',
        analysis_and_solution: 'A divide-and-conquer search method.',
        tags: ['Algorithms']
      }
    });
    assert.equal(result.status, 'node_created');
    assert.ok(result.graph.links.some((link) => link.target === goal.id));
    assert.equal(fetchMock.requests.length, 1);
  } finally {
    fetchMock.restore();
  }
});

test('Whisper failure returns caption-fallback notice without a network request', async () => {
  const fetchMock = mockLocalFetch(async () => {
    throw new Error('Cloud endpoints must not be called.');
  });

  try {
    const result = await transcribeAudio(Buffer.from('test audio'), 'audio/webm');
    assert.equal(result.transcript, '');
    assert.equal(result.hasSpeech, false);
    assert.match(result.notice, /Local transcription unavailable/);
    assert.equal(fetchMock.requests.length, 0);
  } finally {
    fetchMock.restore();
  }
});
