/**
 * Knowledge Graph Service backed by persistent local SQLite storage.
 */

const crypto = require('crypto');
const {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  API_TIMEOUT_MS
} = require('../config/constants');
const storage = require('./storageService');
const { robustParseJSON } = require('../utils/jsonParser');

function computeReportFingerprint(report) {
  const normTranscript = (report.transcript || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normTranscript.length >= 15) {
    return crypto.createHash('sha256').update(normTranscript.slice(0, 350)).digest('hex').slice(0, 16);
  }

  const normTitle = (report.title || report.caption || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
  return crypto.createHash('sha256').update(normTitle).digest('hex').slice(0, 16);
}

function getGraph() {
  const reports = storage.listAllReports();
  const nodeByFingerprint = new Map();
  for (const report of reports) {
    const analysis = report.analysis || {};
    const fingerprint = computeReportFingerprint({
      title: analysis.title || report.caption,
      transcript: report.transcript
    });
    if (nodeByFingerprint.has(fingerprint)) continue;
    nodeByFingerprint.set(fingerprint, {
      id: report.graphId || `report_${fingerprint}`,
      type: 'report',
      label: analysis.title || report.caption || 'Video Report',
      creator: report.creator || 'unknown',
      summary: analysis.analysis_and_solution || analysis.summary || report.transcript,
      tags: analysis.tags || [],
      transcript: report.transcript || '',
      fingerprint,
      createdAt: report.createdAt
    });
  }

  return {
    nodes: [
      ...nodeByFingerprint.values(),
      ...storage.listGoals().map((goal) => ({
        id: goal.id,
        type: 'goal',
        label: goal.text,
        createdAt: goal.createdAt
      }))
    ],
    links: storage.listGraphLinks(),
    goals: storage.listGoals()
  };
}

async function evaluateSemanticConnection(reportNode, goalNode) {
  const prompt = `You are an educational ontology expert determining semantic learning connections between study reports and student academic goals.

STUDY REPORT:
- Title: "${reportNode.label}"
- Summary: "${(reportNode.summary || '').slice(0, 400)}"
- Tags: ${(reportNode.tags || []).join(', ') || 'General Knowledge'}

STUDENT GOAL / TASK / AIM:
- "${goalNode.text}"

Rule: If there is even a slight, practical, or conceptual connection where the report's knowledge could benefit, inspire, or assist the student in this goal, connect them.
Output strictly valid JSON with this exact schema:
{
  "connected": true,
  "score": 0.85,
  "reason": "One concise sentence explaining how this report directly helps or benefits the student in achieving this goal."
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json'
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    const json = await response.json();
    const parsed = robustParseJSON(json.response || '');
    if (typeof parsed.connected === 'boolean') {
      return {
        connected: parsed.connected,
        score: typeof parsed.score === 'number' ? parsed.score : 0.75,
        reason: parsed.reason || 'Provides contextual domain insights.'
      };
    }
    throw new Error('Ollama returned an invalid graph evaluation.');
  } catch (err) {
    console.warn('Ollama graph evaluation error:', err.message);
  } finally {
    clearTimeout(timeoutId);
  }

  const goalLower = goalNode.text.toLowerCase();
  const tagsMatch = (reportNode.tags || []).some((tag) => goalLower.includes(tag.toLowerCase()));
  const titleWords = reportNode.label.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const titleMatch = titleWords.some((word) => goalLower.includes(word));

  if (tagsMatch || titleMatch) {
    return {
      connected: true,
      score: 0.65,
      reason: `Shares key conceptual focus (${reportNode.label}) relevant to the goal.`
    };
  }
  return { connected: false, score: 0, reason: '' };
}

async function addGoal(goalText) {
  const text = (goalText || '').trim();
  if (!text) throw new Error('Goal text cannot be empty.');

  const goalItem = {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    createdAt: new Date().toISOString()
  };
  storage.saveGoal(goalItem);

  for (const reportNode of getGraph().nodes.filter((node) => node.type === 'report')) {
    const evaluation = await evaluateSemanticConnection(reportNode, goalItem);
    if (evaluation.connected && evaluation.score >= 0.40) {
      storage.saveGraphLink({
        id: `link_${reportNode.id}_${goalItem.id}`,
        source: reportNode.id,
        target: goalItem.id,
        score: evaluation.score,
        reason: evaluation.reason,
        type: 'report_to_goal'
      });
    }
  }

  return { goal: goalItem, graph: getGraph() };
}

function deleteGoal(goalId) {
  storage.deleteGoal(goalId);
  return getGraph();
}

async function addReportToGraph(reportData) {
  if (!reportData) return getGraph();

  const title = reportData.analysis?.title || reportData.caption || 'Video Report';
  const transcript = reportData.transcript || '';
  const fingerprint = computeReportFingerprint({ title, transcript });
  const graph = getGraph();

  let existingNode = graph.nodes.find((node) =>
    node.type === 'report' && node.fingerprint === fingerprint
  );

  if (!existingNode && transcript.length >= 25) {
    const newWords = new Set(transcript.toLowerCase().split(/\s+/).filter((word) => word.length > 3));
    existingNode = graph.nodes.find((node) => {
      if (node.type !== 'report' || !node.transcript) return false;
      const oldWords = new Set(node.transcript.toLowerCase().split(/\s+/).filter((word) => word.length > 3));
      const intersection = [...newWords].filter((word) => oldWords.has(word)).length;
      const union = new Set([...newWords, ...oldWords]).size;
      return union > 0 && intersection / union >= 0.70;
    });
  }

  if (existingNode) {
    if (reportData.id) storage.setReportGraphId(reportData.id, existingNode.id);
    console.log(`Knowledge Graph: Report "${title}" already present (fingerprint: ${existingNode.fingerprint}). Skipping duplicate.`);
    return {
      status: 'duplicate_skipped',
      nodeId: existingNode.id,
      graph: getGraph()
    };
  }

  const reportNodeId = `report_${fingerprint}`;
  const reportNode = {
    id: reportNodeId,
    type: 'report',
    label: title,
    creator: reportData.creator || 'unknown',
    transcript,
    summary: reportData.analysis?.analysis_and_solution || reportData.analysis?.summary || transcript,
    tags: reportData.analysis?.tags || [],
    fingerprint,
    createdAt: reportData.createdAt || reportData.processedAt || new Date().toISOString()
  };
  if (reportData.id) storage.setReportGraphId(reportData.id, reportNodeId);

  for (const goal of storage.listGoals()) {
    const evaluation = await evaluateSemanticConnection(reportNode, goal);
    if (evaluation.connected && evaluation.score >= 0.40) {
      storage.saveGraphLink({
        id: `link_${reportNode.id}_${goal.id}`,
        source: reportNode.id,
        target: goal.id,
        score: evaluation.score,
        reason: evaluation.reason,
        type: 'report_to_goal'
      });
    }
  }

  const otherReports = getGraph().nodes.filter((node) =>
    node.type === 'report' && node.id !== reportNode.id
  );
  for (const other of otherReports) {
    const sharedTags = (reportNode.tags || []).filter((tag) => (other.tags || []).includes(tag));
    if (sharedTags.length) {
      storage.saveGraphLink({
        id: `link_${reportNode.id}_${other.id}`,
        source: reportNode.id,
        target: other.id,
        score: 0.5 + sharedTags.length * 0.1,
        reason: `Shared topic domain: #${sharedTags.join(', #')}`,
        type: 'report_to_report'
      });
    }
  }

  return { status: 'node_created', nodeId: reportNodeId, graph: getGraph() };
}

module.exports = {
  addGoal,
  deleteGoal,
  addReportToGraph,
  getGraph,
  computeReportFingerprint
};
