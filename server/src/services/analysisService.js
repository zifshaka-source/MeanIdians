/**
 * Study report generation using the configured local Ollama model.
 */

const {
  OLLAMA_GENERATION_TIMEOUT_MS,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL
} = require('../config/constants');
const { robustParseJSON } = require('../utils/jsonParser');

function buildEducationalPrompt(transcript, caption, url) {
  const hasSpoken = Boolean(transcript && transcript.trim());
  const hasCaption = Boolean(caption && caption.trim());

  let contextDescription = '';
  if (hasSpoken && hasCaption) {
    contextDescription = `Spoken Audio Transcript:\n"${transcript}"\n\nReel Caption & Description:\n"${caption}"`;
  } else if (hasSpoken) {
    contextDescription = `Spoken Audio Transcript:\n"${transcript}"`;
  } else if (hasCaption) {
    contextDescription = `Visual Reel with Background Music (No Spoken Speech Detected).\nReel Caption, Code & Instructions:\n"${caption}"`;
  } else {
    contextDescription = `Short educational reel on social media (${url || 'No link'}). Extract high-yield learning insights.`;
  }

  return `You are Reelsidian, an expert educational intelligence engine transforming video transcripts into comprehensive, high-value study reports.

Analyze this Reel content carefully:
${contextDescription}

Respond strictly with valid JSON with this exact schema:
{
  "title": "Clear, precise title of the topic taught",
  "analysis_and_solution": "A very thorough, in-depth explanation and solution based on the transcript. Detail the fundamental problem addressed, walk through the exact solution, techniques, or tools introduced, and provide complete technical clarity on the topic.",
  "key_points": [
    "Detailed core takeaway 1",
    "Detailed core takeaway 2",
    "Detailed core takeaway 3"
  ],
  "action_items": [
    "Specific practical step, code tip, tool command, or implementation action"
  ],
  "resources_and_links": [
    {
      "name": "Official Tool, Library, Archive, or Documentation Name",
      "url": "https://... or domain / search query if verified"
    }
  ],
  "flashcards": [
    {
      "question": "Conceptual or technical question about this topic?",
      "answer": "Concise, exact answer for active recall revision"
    },
    {
      "question": "Second active recall question?",
      "answer": "Concise, exact answer"
    }
  ],
  "tags": ["Topic1", "Topic2"]
}`;
}

function normalizeReport(parsedData) {
  return {
    title: parsedData.title || '',
    analysis_and_solution: parsedData.analysis_and_solution || parsedData.summary || '',
    key_points: Array.isArray(parsedData.key_points) ? parsedData.key_points : [],
    action_items: Array.isArray(parsedData.action_items) ? parsedData.action_items : [],
    resources_and_links: Array.isArray(parsedData.resources_and_links) ? parsedData.resources_and_links : [],
    flashcards: Array.isArray(parsedData.flashcards) ? parsedData.flashcards : [],
    tags: Array.isArray(parsedData.tags) ? parsedData.tags : []
  };
}

async function callOllama(prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You convert video transcripts into structured study notes. Output only raw valid JSON without markdown code blocks.'
          },
          { role: 'user', content: prompt }
        ],
        format: 'json',
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${errText}`);
    }

    const json = await response.json();
    const raw = json.message?.content || '';
    if (!raw.trim()) {
      throw new Error('Ollama returned an empty response.');
    }

    return {
      source: 'Ollama',
      model: json.model || OLLAMA_MODEL,
      data: normalizeReport(robustParseJSON(raw))
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function analyzeContent(transcript, caption, url) {
  const prompt = buildEducationalPrompt(transcript, caption, url);
  console.log(`Generating study report with local Ollama model ${OLLAMA_MODEL}...`);

  try {
    const result = await callOllama(prompt);
    console.log(`Local Ollama succeeded: ${result.model}`);
    return result;
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const detail = isTimeout
      ? `The local model did not finish within ${Math.ceil(OLLAMA_GENERATION_TIMEOUT_MS / 1000)} seconds. It may still be loading or processing a large request; wait for Ollama to finish and retry.`
      : err.message;
    const nextStep = isTimeout
      ? 'Increase OLLAMA_GENERATION_TIMEOUT_MS if your computer needs more time.'
      : `Start Ollama and ensure the model is installed with "ollama pull ${OLLAMA_MODEL}".`;
    const error = new Error(
      `Local Ollama could not generate the study report using "${OLLAMA_MODEL}": ${detail} ${nextStep}`
    );
    error.cause = err;
    throw error;
  }
}

async function checkOllamaReady() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return { ready: false, error: `Ollama returned HTTP ${response.status}.` };
    }

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const installed = models.some((model) =>
      model.name === OLLAMA_MODEL || model.model === OLLAMA_MODEL
    );
    return {
      ready: installed,
      error: installed ? null : `Model "${OLLAMA_MODEL}" is not installed locally.`
    };
  } catch (err) {
    return { ready: false, error: `Ollama is unavailable: ${err.message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  analyzeContent,
  checkOllamaReady
};
