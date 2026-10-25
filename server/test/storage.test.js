const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const suiteDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsidian-storage-suite-'));
process.env.REELSIDIAN_DB_PATH = path.join(suiteDirectory, 'singleton.sqlite');
const { createStorage, normalizeLink } = require('../src/services/storageService');
const singletonStorage = require('../src/services/storageService');

test.after(() => {
  singletonStorage.close();
  fs.rmSync(suiteDirectory, { recursive: true, force: true });
});

function sampleReport(overrides = {}) {
  return {
    id: 'report-test',
    creator: 'learner',
    url: 'https://example.test/reel/one',
    caption: 'A binary search lesson',
    transcript: 'Binary search repeatedly halves the sorted search interval.',
    notice: null,
    analysis: {
      title: 'Binary Search',
      analysis_and_solution: 'Search a sorted list by midpoint.',
      key_points: ['Input must be sorted'],
      action_items: ['Check the midpoint'],
      resources_and_links: [],
      flashcards: [],
      tags: ['Algorithms']
    },
    modelUsed: 'gemma4:e2b',
    processedAt: '12:00:00 PM',
    ...overrides
  };
}

test('report persistence survives reopening, supports search, URL deduplication, reprocessing, and deletion', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsidian-storage-'));
  const databasePath = path.join(directory, 'test.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let storage = createStorage(databasePath);
  const first = storage.saveReport(sampleReport());
  assert.equal(first.duplicate, false);
  assert.equal(first.report.analysis.tags[0], 'Algorithms');

  const duplicate = storage.saveReport(sampleReport({
    id: 'other-id',
    url: 'https://EXAMPLE.test/reel/one/?utm_source=share#clip'
  }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.report.id, first.report.id);

  const reprocessed = storage.saveReport(sampleReport({
    analysis: { ...sampleReport().analysis, title: 'Binary Search, Revised' }
  }), { reprocess: true });
  assert.equal(reprocessed.reprocessed, true);
  assert.equal(reprocessed.report.id, first.report.id);
  assert.equal(storage.countReports(), 1);
  assert.equal(storage.listReports({ search: 'Revised' })[0].analysis.title, 'Binary Search, Revised');
  assert.equal(normalizeLink('https://EXAMPLE.test/reel/one/?utm_source=share#clip'),
    'https://example.test/reel/one');

  storage.close();
  const freshProcessResult = execFileSync(process.execPath, [
    '-e',
    `const s=require('./src/services/storageService'); const r=s.getReportById(${JSON.stringify(first.report.id)}); process.stdout.write(r.transcript); s.close();`
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, REELSIDIAN_DB_PATH: databasePath },
    encoding: 'utf8'
  });
  assert.equal(freshProcessResult, sampleReport().transcript);
  storage = createStorage(databasePath);
  assert.equal(storage.getReportById(first.report.id).transcript, sampleReport().transcript);
  assert.deepEqual(storage.getReportByUrl('https://example.test/reel/one').analysis.tags, ['Algorithms']);

  storage.setReportGraphId(first.report.id, 'report_binary_search');
  const secondReport = storage.saveReport(sampleReport({
    id: 'report-same-graph-node',
    url: 'https://example.test/reel/duplicate-url',
    caption: 'Another binary search lesson'
  })).report;
  storage.setReportGraphId(secondReport.id, 'report_binary_search');
  storage.saveGoal({ id: 'goal-1', text: 'Learn binary search', createdAt: new Date().toISOString() });
  storage.saveGraphLink({
    id: 'link-1',
    source: 'report_binary_search',
    target: 'goal-1',
    score: 0.9,
    reason: 'Directly supports the goal.',
    type: 'report_to_goal'
  });
  assert.equal(storage.listGoals().length, 1);
  assert.equal(storage.listGraphLinks().length, 1);

  storage.setReportGraphId(first.report.id, 'report_reprocessed');
  assert.equal(storage.listGraphLinks().length, 1);
  storage.setReportGraphId(first.report.id, 'report_binary_search');
  assert.equal(storage.deleteReport(first.report.id), true);
  assert.equal(storage.getReportById(first.report.id), null);
  assert.equal(storage.listGraphLinks().length, 1);
  assert.equal(storage.deleteReport(secondReport.id), true);
  assert.equal(storage.listGraphLinks().length, 0);
  assert.equal(storage.deleteGoal('goal-1'), true);
  storage.close();
});

test('chat messages persist, are searchable, and cascade-delete with their chat', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsidian-chat-'));
  const databasePath = path.join(directory, 'test.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let storage = createStorage(databasePath);
  const chat = storage.createChat('Study session');
  const userMessage = storage.addChatMessage(chat.id, { role: 'user', content: 'Explain binary search.' });
  storage.addChatMessage(chat.id, { role: 'assistant', content: 'It searches sorted data by midpoint.' });
  assert.ok(userMessage.id);
  assert.equal(storage.listChats({ search: 'midpoint' })[0].messageCount, 2);
  storage.close();

  storage = createStorage(databasePath);
  assert.equal(storage.getChat(chat.id).messages.length, 2);
  assert.equal(storage.getChat(chat.id).messages[0].role, 'user');
  assert.equal(storage.deleteChat(chat.id), true);
  assert.equal(storage.getChat(chat.id), null);
  assert.equal(storage.listChats().length, 0);
  storage.close();
});
