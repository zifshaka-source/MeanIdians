const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = process.env.REELSIDIAN_DESKTOP === 'true'
  ? require(path.resolve(__dirname, '../../../node_modules/better-sqlite3'))
  : require('better-sqlite3');

const configuredDatabasePath = process.env.REELSIDIAN_DB_PATH
  ? path.resolve(__dirname, '../../', process.env.REELSIDIAN_DB_PATH)
  : path.resolve(__dirname, '../../data/reelsidian.sqlite');

function normalizeLink(link) {
  const value = (link || '').trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return value;
  }
}

function parseReport(row) {
  if (!row) return null;
  const report = {
    id: row.id,
    creator: row.creator,
    url: row.url,
    caption: row.caption,
    transcript: row.transcript,
    notice: row.notice,
    analysis: JSON.parse(row.analysis_json),
    modelUsed: row.model_used,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.graph_id) report.graphId = row.graph_id;
  return report;
}

function createStorage(databasePath = configuredDatabasePath) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const migrations = [
    (database) => {
      database.exec(`
        CREATE TABLE reports (
          id TEXT PRIMARY KEY,
          graph_id TEXT,
          url TEXT NOT NULL DEFAULT '',
          url_key TEXT UNIQUE,
          creator TEXT NOT NULL DEFAULT 'unknown',
          caption TEXT NOT NULL DEFAULT '',
          transcript TEXT NOT NULL DEFAULT '',
          notice TEXT,
          analysis_json TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          model_used TEXT NOT NULL DEFAULT '',
          processed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX reports_created_at_idx ON reports(created_at DESC);
        CREATE TABLE goals (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE graph_links (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          score REAL NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL
        );
        CREATE INDEX graph_links_source_idx ON graph_links(source_id);
        CREATE INDEX graph_links_target_idx ON graph_links(target_id);
        CREATE TABLE chats (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE chat_messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX chat_messages_chat_idx ON chat_messages(chat_id, created_at);
      `);
    }
  ];

  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion > migrations.length) {
    db.close();
    throw new Error(`Database schema version ${currentVersion} is newer than this application supports.`);
  }
  for (let version = currentVersion; version < migrations.length; version += 1) {
    const migrate = db.transaction(() => {
      migrations[version](db);
      db.pragma(`user_version = ${version + 1}`);
    });
    migrate();
  }

  const statements = {
    reportById: db.prepare('SELECT * FROM reports WHERE id = ?'),
    reportByUrl: db.prepare('SELECT * FROM reports WHERE url_key = ?'),
    insertReport: db.prepare(`
      INSERT INTO reports (
        id, url, url_key, creator, caption, transcript, notice, analysis_json,
        tags_json, model_used, processed_at, created_at, updated_at
      ) VALUES (
        @id, @url, @url_key, @creator, @caption, @transcript, @notice, @analysis_json,
        @tags_json, @model_used, @processed_at, @created_at, @updated_at
      )
    `),
    updateReport: db.prepare(`
      UPDATE reports SET
        url = @url, url_key = @url_key, creator = @creator, caption = @caption,
        transcript = @transcript, notice = @notice, analysis_json = @analysis_json,
        tags_json = @tags_json, model_used = @model_used, processed_at = @processed_at,
        updated_at = @updated_at
      WHERE id = @id
    `)
  };

  function saveReport(report, { reprocess = false } = {}) {
    const url = (report.url || '').trim();
    const urlKey = normalizeLink(url) || null;
    const existing = urlKey ? statements.reportByUrl.get(urlKey) : null;
    if (existing && !reprocess) {
      return { report: parseReport(existing), duplicate: true };
    }

    const now = new Date().toISOString();
    const id = existing ? existing.id : (report.id || crypto.randomUUID());
    const row = {
      id,
      url,
      url_key: urlKey,
      creator: report.creator || 'unknown',
      caption: report.caption || '',
      transcript: report.transcript || '',
      notice: report.notice || null,
      analysis_json: JSON.stringify(report.analysis || {}),
      tags_json: JSON.stringify(Array.isArray(report.analysis?.tags) ? report.analysis.tags : []),
      model_used: report.modelUsed || '',
      processed_at: report.processedAt || now,
      created_at: existing ? existing.created_at : (report.createdAt || now),
      updated_at: now
    };

    const save = db.transaction(() => {
      if (existing) {
        statements.updateReport.run(row);
      } else {
        statements.insertReport.run(row);
      }
    });
    save();

    return {
      report: parseReport(statements.reportById.get(id)),
      duplicate: false,
      reprocessed: Boolean(existing)
    };
  }

  function listReports({ search = '', limit = 50, offset = 0 } = {}) {
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const boundedOffset = Math.max(0, Number(offset) || 0);
    const query = String(search).trim();
    if (!query) {
      return db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(boundedLimit, boundedOffset).map(parseReport);
    }
    const pattern = `%${query}%`;
    return db.prepare(`
      SELECT * FROM reports
      WHERE url LIKE ? COLLATE NOCASE
        OR creator LIKE ? COLLATE NOCASE
        OR caption LIKE ? COLLATE NOCASE
        OR transcript LIKE ? COLLATE NOCASE
        OR analysis_json LIKE ? COLLATE NOCASE
        OR tags_json LIKE ? COLLATE NOCASE
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, boundedLimit, boundedOffset)
      .map(parseReport);
  }

  function countReports({ search = '' } = {}) {
    const query = String(search).trim();
    if (!query) {
      return db.prepare('SELECT COUNT(*) AS count FROM reports').get().count;
    }
    const pattern = `%${query}%`;
    return db.prepare(`
      SELECT COUNT(*) AS count FROM reports
      WHERE url LIKE ? COLLATE NOCASE
        OR creator LIKE ? COLLATE NOCASE
        OR caption LIKE ? COLLATE NOCASE
        OR transcript LIKE ? COLLATE NOCASE
        OR analysis_json LIKE ? COLLATE NOCASE
        OR tags_json LIKE ? COLLATE NOCASE
    `).get(pattern, pattern, pattern, pattern, pattern, pattern).count;
  }

  function listAllReports() {
    return db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all().map(parseReport);
  }

  function setReportGraphId(reportId, graphId) {
    const transaction = db.transaction(() => {
      const report = statements.reportById.get(reportId);
      if (!report) return;
      db.prepare('UPDATE reports SET graph_id = ? WHERE id = ?').run(graphId, reportId);
      if (
        report.graph_id &&
        report.graph_id !== graphId &&
        !db.prepare('SELECT 1 FROM reports WHERE graph_id = ?').get(report.graph_id)
      ) {
        db.prepare('DELETE FROM graph_links WHERE source_id = ? OR target_id = ?')
          .run(report.graph_id, report.graph_id);
      }
    });
    transaction();
  }

  function deleteReport(reportId) {
    const transaction = db.transaction(() => {
      const report = statements.reportById.get(reportId);
      if (!report) return false;
      db.prepare('DELETE FROM reports WHERE id = ?').run(reportId);
      if (
        report.graph_id &&
        !db.prepare('SELECT 1 FROM reports WHERE graph_id = ?').get(report.graph_id)
      ) {
        db.prepare('DELETE FROM graph_links WHERE source_id = ? OR target_id = ?')
          .run(report.graph_id, report.graph_id);
      }
      return true;
    });
    return transaction();
  }

  function listGoals() {
    return db.prepare('SELECT id, text, created_at AS createdAt FROM goals ORDER BY created_at DESC')
      .all();
  }

  function saveGoal(goal) {
    db.prepare('INSERT INTO goals (id, text, created_at) VALUES (?, ?, ?)')
      .run(goal.id, goal.text, goal.createdAt);
  }

  function deleteGoal(goalId) {
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM graph_links WHERE source_id = ? OR target_id = ?')
        .run(goalId, goalId);
      return db.prepare('DELETE FROM goals WHERE id = ?').run(goalId).changes > 0;
    });
    return transaction();
  }

  function listGraphLinks() {
    return db.prepare(`
      SELECT id, source_id AS source, target_id AS target, score, reason, type
      FROM graph_links
    `).all();
  }

  function saveGraphLink(link) {
    db.prepare(`
      INSERT INTO graph_links (id, source_id, target_id, score, reason, type)
      VALUES (@id, @source, @target, @score, @reason, @type)
      ON CONFLICT(id) DO UPDATE SET
        score = excluded.score, reason = excluded.reason, type = excluded.type
    `).run(link);
  }

  function createChat(title) {
    const now = new Date().toISOString();
    const chat = { id: crypto.randomUUID(), title: title || 'New chat', createdAt: now, updatedAt: now };
    db.prepare('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(chat.id, chat.title, chat.createdAt, chat.updatedAt);
    return chat;
  }

  function listChats({ search = '', limit = 50, offset = 0 } = {}) {
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const boundedOffset = Math.max(0, Number(offset) || 0);
    const query = String(search).trim();
    const rows = query
      ? db.prepare(`
        SELECT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt,
          COUNT(m.id) AS messageCount
        FROM chats c LEFT JOIN chat_messages m ON m.chat_id = c.id
        WHERE c.title LIKE ? COLLATE NOCASE OR EXISTS (
          SELECT 1 FROM chat_messages sm
          WHERE sm.chat_id = c.id AND sm.content LIKE ? COLLATE NOCASE
        )
        GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?
      `).all(`%${query}%`, `%${query}%`, boundedLimit, boundedOffset)
      : db.prepare(`
        SELECT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt,
          COUNT(m.id) AS messageCount
        FROM chats c LEFT JOIN chat_messages m ON m.chat_id = c.id
        GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?
      `).all(boundedLimit, boundedOffset);
    return rows;
  }

  function getChat(chatId) {
    const chat = db.prepare(`
      SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
      FROM chats WHERE id = ?
    `).get(chatId);
    if (!chat) return null;
    chat.messages = db.prepare(`
      SELECT id, role, content, created_at AS createdAt
      FROM chat_messages WHERE chat_id = ? ORDER BY created_at, rowid
    `).all(chatId);
    return chat;
  }

  function addChatMessage(chatId, { role, content }) {
    const transaction = db.transaction(() => {
      const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId);
      if (!chat) return null;
      const message = {
        id: crypto.randomUUID(),
        role,
        content,
        createdAt: new Date().toISOString()
      };
      db.prepare(`
        INSERT INTO chat_messages (id, chat_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(message.id, chatId, role, content, message.createdAt);
      db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?')
        .run(message.createdAt, chatId);
      return message;
    });
    return transaction();
  }

  function deleteChat(chatId) {
    return db.prepare('DELETE FROM chats WHERE id = ?').run(chatId).changes > 0;
  }

  function close() {
    if (!db.open) return;
    for (const key of Object.keys(statements)) statements[key] = null;
    db.close();
  }

  return {
    addChatMessage,
    close,
    countReports,
    createChat,
    deleteChat,
    deleteGoal,
    deleteReport,
    getChat,
    getReportById: (id) => parseReport(statements.reportById.get(id)),
    getReportByUrl: (url) => parseReport(statements.reportByUrl.get(normalizeLink(url))),
    listChats,
    listAllReports,
    listGoals,
    listGraphLinks,
    listReports,
    saveGoal,
    saveGraphLink,
    saveReport,
    setReportGraphId
  };
}

const storage = createStorage();

module.exports = {
  createStorage,
  normalizeLink,
  ...storage
};
