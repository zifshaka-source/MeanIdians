/**
 * Content Analysis Service using Ollama first, with Google Gemma 4 fallbacks
 * Supports:
 * 1. Ollama (Primary)
 * 2. Google AI Studio SDK (Fallback)
 * 3. OpenRouter Google Gemma 4 (Fallback)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  GEMINI_API_KEY,
  GOOGLE_GEMMA_MODELS,
  CANDIDATE_MODELS,
  OPENROUTER_API_KEY,
  PORT,
  API_TIMEOUT_MS
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

// ============================================================
// 2. Direct Google AI Studio SDK (Gemma 4 Models)
// ============================================================
async function callGoogleAIStudio(modelName, apiKey, prompt, fallbackContext = '') {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName
  });

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const raw = response.text() || '';
  const parsedData = robustParseJSON(raw);

  const safeData = {
    title: parsedData.title || '',
    analysis_and_solution: parsedData.analysis_and_solution || parsedData.summary || '',
    key_points: Array.isArray(parsedData.key_points) ? parsedData.key_points : [],
    action_items: Array.isArray(parsedData.action_items) ? parsedData.action_items : [],
    resources_and_links: Array.isArray(parsedData.resources_and_links) ? parsedData.resources_and_links : [],
    flashcards: Array.isArray(parsedData.flashcards) ? parsedData.flashcards : [],
    tags: Array.isArray(parsedData.tags) ? parsedData.tags : []
  };

  return {
    source: 'Google AI Studio SDK',
    model: `google/${modelName}`,
    data: safeData
  };
}

// ============================================================
// 1. Ollama (Primary)
// ============================================================
async function callOllama(prompt) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434')
    .replace(/\/+$/, '');
  const model = process.env.OLLAMA_MODEL || 'gemma4:cloud';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
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

    const parsedData = robustParseJSON(raw);
    const safeData = {
      title: parsedData.title || '',
      analysis_and_solution: parsedData.analysis_and_solution || parsedData.summary || '',
      key_points: Array.isArray(parsedData.key_points) ? parsedData.key_points : [],
      action_items: Array.isArray(parsedData.action_items) ? parsedData.action_items : [],
      resources_and_links: Array.isArray(parsedData.resources_and_links) ? parsedData.resources_and_links : [],
      flashcards: Array.isArray(parsedData.flashcards) ? parsedData.flashcards : [],
      tags: Array.isArray(parsedData.tags) ? parsedData.tags : []
    };

    return {
      source: 'Ollama',
      model: json.model || model,
      data: safeData
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================
// 3. OpenRouter Fallback (Strictly Gemma 4)
// ============================================================
async function callOpenRouter(model, apiKey, prompt, fallbackContext = '') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': `http://localhost:${PORT}`,
        'X-Title': 'Reelsidian Educational Engine'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You convert video transcripts into structured study notes. Output only raw valid JSON without markdown code blocks.'
          },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`OpenRouter API error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    const raw = json.choices?.[0]?.message?.content || '';
    const parsedData = robustParseJSON(raw);

    const safeData = {
      title: parsedData.title || '',
      analysis_and_solution: parsedData.analysis_and_solution || parsedData.summary || '',
      key_points: Array.isArray(parsedData.key_points) ? parsedData.key_points : [],
      action_items: Array.isArray(parsedData.action_items) ? parsedData.action_items : [],
      resources_and_links: Array.isArray(parsedData.resources_and_links) ? parsedData.resources_and_links : [],
      flashcards: Array.isArray(parsedData.flashcards) ? parsedData.flashcards : [],
      tags: Array.isArray(parsedData.tags) ? parsedData.tags : []
    };

    return {
      source: 'OpenRouter (Gemma 4)',
      model: json.model || model,
      data: safeData
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ============================================================
// Main Analysis Pipeline: Prioritizes Ollama
// ============================================================
async function analyzeContent(transcript, caption, url) {
  const prompt = buildEducationalPrompt(transcript, caption, url);
  const fallbackContext = transcript || caption || 'Educational video insights';

  try {
    console.log('Using Ollama for study-report generation...');
    const result = await callOllama(prompt);
    console.log(`Ollama succeeded: ${result.model}`);
    return result;
  } catch (err) {
    console.warn(`Ollama failed: ${err.message}`);
    console.warn('Falling back to existing cloud providers...');
  }

  // Pathway 2: Google AI Studio SDK (Direct Gemma 4) fallback
  if (GEMINI_API_KEY && GEMINI_API_KEY.trim()) {
    console.log('⚡ Using Google AI Studio SDK with direct Google Gemma 4 models...');
    for (const modelName of GOOGLE_GEMMA_MODELS) {
      try {
        console.log(`🧠 Querying Google AI Studio Gemma 4: ${modelName}...`);
        const result = await callGoogleAIStudio(modelName, GEMINI_API_KEY, prompt, fallbackContext);
        console.log(`✅ Success via Google AI Studio SDK: ${result.model}`);
        return result;
      } catch (err) {
        console.warn(`⚠️ Google AI Studio (${modelName}) notice: ${err.message}. Trying next Gemma 4 model...`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  } else {
    console.log('ℹ️ GEMINI_API_KEY not yet detected in server/.env — using Google Gemma 4 via OpenRouter.');
  }

  // Pathway 3: OpenRouter Google Gemma 4 (Strictly Gemma 4 models only)
  if (!OPENROUTER_API_KEY || !OPENROUTER_API_KEY.trim()) {
    throw new Error('Please set either GEMINI_API_KEY or OPENROUTER_API_KEY in server/.env');
  }

  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      console.log(`🧠 Querying Google Gemma 4 model: ${model}...`);
      const result = await callOpenRouter(model, OPENROUTER_API_KEY, prompt, fallbackContext);
      console.log(`✅ Success with Google Gemma 4: ${result.model}`);
      return result;
    } catch (err) {
      console.warn(`⚠️ Google Gemma 4 (${model}) issue: ${err.message}. Trying next Gemma 4 variant...`);
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  throw lastError || new Error('Google Gemma 4 models failed to respond.');
}

module.exports = {
  analyzeContent
};
