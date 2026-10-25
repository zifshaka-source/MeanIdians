/**
 * Reelsidian Dashboard Application Logic
 * Formats reports matching the notebook layout:
 * 1. Audio Player Preview
 * 2. Local Whisper Transcript Box
 * 3. Deep Analysis & Solution (Local Gemma 4)
 * 4. Core Key Points & Action Items
 * 5. Verified Resources & Documentation Links
 * 6. Active Recall Flashcards
 * 7. Topic Tags
 * Zero emojis, sleek typography.
 */

// Application State
const state = {
  cards: [],
  activeTab: 'file',
  activeMainView: 'deck',
  sseStatus: 'connecting',
  graphData: { nodes: [], links: [], goals: [] },
  forceGraphInstance: null,
  selectedGraphItem: null
};

// DOM Elements
const statusBanner = document.getElementById('statusBanner');
const statusMessage = document.getElementById('statusMessage');
const cardsFeed = document.getElementById('cardsFeed');
const emptyState = document.getElementById('emptyState');
const sseDot = document.getElementById('sseDot');
const sseText = document.getElementById('sseText');
const dropLabel = document.getElementById('dropLabel');
const audioInput = document.getElementById('audioInput');
const graphNodesCountBadge = document.getElementById('graphNodesCountBadge');
const statReportsCount = document.getElementById('statReportsCount');
const statGoalsCount = document.getElementById('statGoalsCount');
const statLinksCount = document.getElementById('statLinksCount');
const goalsContainer = document.getElementById('goalsContainer');
const connectionInspector = document.getElementById('connectionInspector');

// Escape HTML utility
function esc(val) {
  return String(val ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Format multi-line paragraphs cleanly
function formatParagraphs(text) {
  if (!text) return '';
  return text
    .split(/\n\s*\n/)
    .map(p => `<p>${esc(p.trim())}</p>`)
    .join('');
}

// ==========================================
// 1. DYNAMIC SSE CONNECTION MONITOR
// ==========================================
function updateConnectionStatus(status, label) {
  state.sseStatus = status;
  sseDot.className = 'status-dot ' + (status === 'connected' ? '' : status);
  sseText.textContent = label;
}

function initSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.onopen = () => {
    updateConnectionStatus('connected', 'Live Engine Connected');
  };

  evtSource.addEventListener('connected', () => {
    updateConnectionStatus('connected', 'Live Engine Connected');
  });

  evtSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      showStatus(data.message, data.step === 'error');
    } catch (err) { /* ignore */ }
  });

  evtSource.addEventListener('result', (e) => {
    try {
      const data = JSON.parse(e.data);
      addCard(data);
    } catch (err) { /* ignore */ }
  });

  evtSource.addEventListener('graph_update', (e) => {
    try {
      const graphData = JSON.parse(e.data);
      updateKnowledgeGraph(graphData);
    } catch (err) { /* ignore */ }
  });

  evtSource.onerror = () => {
    updateConnectionStatus('reconnecting', 'Reconnecting to Engine...');
  };
}

// ==========================================
// 2. STATUS BANNER
// ==========================================
function showStatus(msg, isError = false) {
  statusBanner.classList.add('active');
  statusMessage.textContent = msg;
  if (isError) {
    statusBanner.style.borderColor = 'rgba(239, 68, 68, 0.5)';
    statusBanner.style.color = '#fca5a5';
  } else {
    statusBanner.style.borderColor = 'rgba(234, 88, 12, 0.45)';
    statusBanner.style.color = '#fed7aa';
  }
}

function hideStatus() {
  statusBanner.classList.remove('active');
}

// ==========================================
// 3. CARD MANAGEMENT & EXPORT
// ==========================================
function addCard(data) {
  hideStatus();
  if (!data) return;

  // De-duplication check: if card with this backend id already exists, do not duplicate
  const rawId = data.id || '';
  if (rawId && state.cards.some((c) => c.backendId === rawId || c.id === rawId)) {
    console.log('Skipping duplicate card delivery for:', rawId);
    return;
  }

  // Assign a guaranteed unique DOM instance ID
  const uniqueInstanceId = 'card_inst_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const cardData = {
    ...data,
    id: uniqueInstanceId,
    backendId: rawId || uniqueInstanceId
  };

  state.cards.unshift(cardData);
  renderFeed();
}

async function removeCard(instanceId) {
  // Locate the exact single card in state by unique instance ID
  const index = state.cards.findIndex((c) => c.id === instanceId);
  if (index === -1) return;

  const card = state.cards[index];
  try {
    const response = await fetch(`/api/reports/${encodeURIComponent(card.backendId)}`, {
      method: 'DELETE'
    });
    if (!response.ok && response.status !== 404) {
      const data = await response.json();
      throw new Error(data.error || 'Could not delete saved report.');
    }
  } catch (err) {
    showStatus(`Could not delete saved report: ${err.message}`, true);
    return;
  }

  // Smooth DOM exit animation before removing from state
  const cardEl = document.getElementById(instanceId);
  if (cardEl) {
    cardEl.style.transition = 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.96) translateY(-10px)';
    setTimeout(() => {
      const currentIndex = state.cards.findIndex((c) => c.id === instanceId);
      if (currentIndex !== -1) state.cards.splice(currentIndex, 1);
      renderFeed();
    }, 220);
  } else {
    const currentIndex = state.cards.findIndex((c) => c.id === instanceId);
    if (currentIndex !== -1) state.cards.splice(currentIndex, 1);
    renderFeed();
  }
}

function clearDeck() {
  state.cards = [];
  renderFeed();
  hideStatus();
}

// Copy study notes to clipboard in rich Markdown
function copyMarkdown(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;

  const a = card.analysis || {};
  let md = `# ${a.title || 'Reel Knowledge Notes'}\n`;
  md += `**Creator**: @${card.creator || 'unknown'} | **Model**: ${card.modelUsed || 'Local Gemma 4'}\n\n`;

  if (a.analysis_and_solution) {
    md += `## Detailed Analysis & Solution\n${a.analysis_and_solution}\n\n`;
  }

  if (a.key_points && a.key_points.length) {
    md += `## Core Key Points\n`;
    a.key_points.forEach((pt) => { md += `- ${pt}\n`; });
    md += `\n`;
  }

  if (a.action_items && a.action_items.length) {
    md += `## Action Items & Implementation\n`;
    a.action_items.forEach((item) => { md += `- [ ] ${item}\n`; });
    md += `\n`;
  }

  if (a.resources_and_links && a.resources_and_links.length) {
    md += `## Verified Resources & Documentation\n`;
    a.resources_and_links.forEach((r) => { md += `- [${r.name}](${r.url})\n`; });
    md += `\n`;
  }

  if (a.flashcards && a.flashcards.length) {
    md += `## Active Recall Flashcards (Q&A)\n`;
    a.flashcards.forEach((fc) => {
      md += `**Q: ${fc.question}**\n*A: ${fc.answer}*\n\n`;
    });
  }

  if (card.transcript && card.transcript.length > 5) {
    md += `## Spoken Audio Transcript (Local Whisper)\n> ${card.transcript}\n`;
  }

  navigator.clipboard.writeText(md).then(() => {
    alert('Study report copied as Markdown! Ready to paste into Notion or Obsidian.');
  });
}

// Export Flashcards to Anki TSV format (.txt)
function exportAnki(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;

  const flashcards = card.analysis?.flashcards || [];
  if (!flashcards.length) {
    alert('No flashcards found for this report.');
    return;
  }

  const tsv = flashcards
    .map((fc) => `${fc.question.replace(/\t/g, ' ')}\t${fc.answer.replace(/\t/g, ' ')}\tReelsidian`)
    .join('\n');

  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Anki_${card.creator || 'Reel'}_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Render the Notebook Layout
function renderFeed() {
  if (state.cards.length === 0) {
    emptyState.style.display = 'block';
    cardsFeed.innerHTML = '';
    return;
  }

  emptyState.style.display = 'none';
  cardsFeed.innerHTML = state.cards.map((data) => {
    const a = data.analysis || {};
    const points = a.key_points || [];
    const actions = a.action_items || [];
    const resources = a.resources_and_links || [];
    const flashcards = a.flashcards || [];
    const tags = a.tags || [];

    return `
      <article class="result-card" id="${esc(data.id)}">
        <div class="result-header">
          <div class="creator-tag">@${esc(data.creator || 'unknown')}</div>
          <div class="meta-right">
            <span class="timestamp-tag">${esc(data.processedAt || 'Processed')}</span>
          </div>
        </div>

        <h2 class="result-title">${esc(a.title || data.caption || 'Video Knowledge Report')}</h2>

        <!-- SECTION 1: AUDIO PLAYER PREVIEW -->
        ${data.audioDataUrl ? `
          <div class="audio-player-container">
            <div class="audio-player-label">Audio Playback Preview</div>
            <audio class="audio-player" controls src="${esc(data.audioDataUrl)}"></audio>
          </div>
        ` : ''}

        <!-- SECTION 2: TRANSCRIPT BOX (Local Whisper) -->
        <div class="report-section">
          <div class="section-label">
            <span>Spoken Transcript</span>
            <span class="section-badge-tag">Local Whisper</span>
          </div>
          <p class="transcript-text">"${esc(data.transcript || 'No spoken audio transcript detected.')}"</p>
        </div>

        <!-- SECTION 3: DEEP ANALYSIS & SOLUTION (Local Gemma 4) -->
        <div class="report-section">
          <div class="section-label">
            <span>Analysis & Solution</span>
            <span class="section-badge-tag">Local Gemma 4</span>
          </div>
          <div class="analysis-text">
            ${formatParagraphs(a.analysis_and_solution || a.summary || 'Analysis generated from video audio.')}
          </div>
        </div>

        <!-- SECTION 4: CORE KEY POINTS -->
        ${points.length > 0 ? `
          <div class="report-section">
            <div class="section-label">Core Key Points</div>
            <ul class="key-points-list">
              ${points.map(pt => `<li>${esc(pt)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- SECTION 5: ACTION ITEMS & IMPLEMENTATION -->
        ${actions.length > 0 ? `
          <div class="report-section">
            <div class="section-label">Action Items & Practical Implementation</div>
            <ul class="key-points-list">
              ${actions.map(act => `<li>${esc(act)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- SECTION 6: VERIFIED RESOURCES & DOCUMENTATION LINKS -->
        ${resources.length > 0 ? `
          <div class="report-section">
            <div class="section-label">Verified Resources & Documentation</div>
            <div class="resources-grid">
              ${resources.map(r => `
                <a href="${esc(r.url || '#')}" target="_blank" rel="noopener noreferrer" class="resource-link-card">
                  <span class="resource-name">${esc(r.name || 'Resource')}</span>
                  <span class="resource-url">${esc(r.url || 'Documentation Reference')}</span>
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- SECTION 7: ACTIVE RECALL FLASHCARDS -->
        ${flashcards.length > 0 ? `
          <div class="report-section">
            <div class="section-label">
              <span>Active Recall Flashcards</span>
              <span class="section-badge-tag">${flashcards.length} Cards · Click to Flip</span>
            </div>
            <div class="flashcards-grid">
              ${flashcards.map(fc => `
                <div class="flashcard" onclick="this.classList.toggle('flipped')">
                  <div class="flashcard-q">${esc(fc.question)}</div>
                  <div class="flashcard-a">${esc(fc.answer)}</div>
                  <div class="flashcard-hint">Click to reveal answer</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- SECTION 8: TAGS -->
        ${tags.length > 0 ? `
          <div class="tags-row">
            ${tags.map(t => `<span class="tag-badge">#${esc(t)}</span>`).join('')}
          </div>
        ` : ''}

        <!-- ACTION TOOLBAR -->
        <div class="card-actions">
          <button class="btn-action" onclick="copyMarkdown('${esc(data.id)}')">
            Copy Markdown
          </button>
          <button class="btn-action" onclick="exportAnki('${esc(data.id)}')">
            Export Anki (.txt)
          </button>
          ${data.url ? `
            <a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer" class="btn-action">
              Open Reel
            </a>
          ` : ''}
          <button class="btn-action btn-action-delete" onclick="removeCard('${esc(data.id)}')">
            Remove
          </button>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================
// 4. TAB SWITCHING
// ==========================================
function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById('tabFileBtn').classList.toggle('active', tab === 'file');
  document.getElementById('tabTextBtn').classList.toggle('active', tab === 'text');
  document.getElementById('fileUploadSection').style.display = tab === 'file' ? 'block' : 'none';
  document.getElementById('textInputSection').style.display = tab === 'text' ? 'block' : 'none';
}

// ==========================================
// 5. EVENT LISTENERS & FORM SUBMISSION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initSSE();

  // File picker label update
  if (audioInput) {
    audioInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        dropLabel.textContent = e.target.files[0].name;
      }
    });
  }

  // Audio Upload Form
  const uploadForm = document.getElementById('uploadForm');
  if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!audioInput.files.length) {
        alert('Please choose an audio or video file first.');
        return;
      }

      const submitBtn = document.getElementById('fileSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Transcribing & Analyzing...';
      showStatus('Uploading & running local Whisper + Gemma 4...');

      const formData = new FormData();
      formData.append('audio', audioInput.files[0]);
      formData.append('creator', document.getElementById('fileCreatorInput').value || 'direct_upload');
      formData.append('caption', document.getElementById('fileCaptionInput').value || '');

      try {
        const res = await fetch('/api/process', { method: 'POST', body: formData });
        const json = await res.json();
        if (res.ok && json.result) {
          addCard(json.result);
          audioInput.value = '';
          dropLabel.textContent = 'Select Audio / Video File';
        } else {
          showStatus(`Error: ${json.error || 'Processing failed'}`, true);
        }
      } catch (err) {
        showStatus(`Upload failed: ${err.message}`, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Parse & Analyze Audio';
      }
    });
  }

  // Quick Text Analysis Form
  const textForm = document.getElementById('textForm');
  if (textForm) {
    textForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = document.getElementById('quickTextInput').value.trim();
      if (!content) {
        alert('Please enter text or notes to analyze.');
        return;
      }

      const submitBtn = document.getElementById('textSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Analyzing Text...';
      showStatus('Analyzing text context with local Gemma 4...');

      try {
        const res = await fetch('/api/analyze-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: content,
            creator: document.getElementById('textCreatorInput').value || 'manual_entry',
            url: document.getElementById('textUrlInput').value || ''
          })
        });

        const json = await res.json();
        if (res.ok && json.result) {
          addCard(json.result);
          document.getElementById('quickTextInput').value = '';
        } else {
          showStatus(`Error: ${json.error || 'Analysis failed'}`, true);
        }
      } catch (err) {
        showStatus(`Analysis failed: ${err.message}`, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generate Knowledge Card';
      }
    });
  }

  // Academic Goal Input Form
  const goalForm = document.getElementById('goalForm');
  if (goalForm) {
    goalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('goalTextInput');
      const text = (input.value || '').trim();
      if (!text) {
        alert('Please enter an academic aim, task, or research goal.');
        return;
      }

      const btn = document.getElementById('addGoalBtn');
      btn.disabled = true;
      btn.textContent = 'Evaluating Connections...';

      try {
        const res = await fetch('/api/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalText: text })
        });
        const data = await res.json();
        if (res.ok && data.graph) {
          input.value = '';
          updateKnowledgeGraph(data.graph);
          if (state.activeMainView !== 'graph') {
            switchMainView('graph');
          }
        } else {
          alert('Could not add goal: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        alert('Failed to connect: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add Goal & Map Graph';
      }
    });
  }

  // Load Initial Graph State
  loadInitialGraph();
  loadInitialReports();
});

// ==========================================
// 6. MAIN VIEW SWITCHER (DECK vs GRAPH)
// ==========================================
function switchMainView(view) {
  state.activeMainView = view;
  const isGraph = view === 'graph';

  document.getElementById('viewDeckBtn').classList.toggle('active', !isGraph);
  document.getElementById('viewGraphBtn').classList.toggle('active', isGraph);

  document.getElementById('deckView').style.display = isGraph ? 'none' : 'block';
  document.getElementById('graphView').style.display = isGraph ? 'block' : 'none';

  if (isGraph) {
    setTimeout(() => {
      initOrResizeGraph();
      if (state.forceGraphInstance) {
        state.forceGraphInstance.zoomToFit(500, 60);
      }
    }, 80);
  }
}

// ==========================================
// 7. KNOWLEDGE GRAPH ENGINE (Obsidian-Style)
// ==========================================

// Helper: Wraps text onto multiple lines without exceeding maxWidth
function wrapCanvasText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && i > 0) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines - 1) {
        break;
      }
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // If there are more words, append clean ellipsis to the last line
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last + '...').width <= maxWidth) {
      lines[maxLines - 1] = last + '...';
    }
  }

  return lines;
}

function initOrResizeGraph() {
  const container = document.getElementById('knowledgeGraphContainer');
  if (!container) return;

  const w = container.clientWidth || 800;
  const h = container.clientHeight || 640;

  if (!state.forceGraphInstance && window.ForceGraph) {
    state.forceGraphInstance = ForceGraph()(container)
      .width(w)
      .height(h)
      .backgroundColor('rgba(0, 0, 0, 0)')
      .nodeId('id')
      .nodeCanvasObject((node, ctx, globalScale) => {
        const isReport = node.type === 'report';

        if (isReport) {
          // ==========================================
          // 1. REPORT CARD (LEFT SIDE, BURNT COPPER GLASS)
          // ==========================================
          const cardW = 195;
          const cardH = 72;
          const x = node.x - cardW / 2;
          const y = node.y - cardH / 2;
          const radius = 8;

          // Glowing aura behind card
          ctx.shadowColor = 'rgba(234, 88, 12, 0.4)';
          ctx.shadowBlur = 14;

          // Transparent Obsidian Glass Card
          ctx.fillStyle = 'rgba(15, 10, 8, 0.82)';
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.55)';
          ctx.lineWidth = 1.2;

          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, y, cardW, cardH, radius);
          } else {
            ctx.rect(x, y, cardW, cardH);
          }
          ctx.fill();
          ctx.stroke();

          // Reset shadow for text rendering
          ctx.shadowBlur = 0;

          // Top Header Bar: Dot + "STUDY REPORT"
          ctx.fillStyle = '#ea580c';
          ctx.beginPath();
          ctx.arc(x + 12, y + 12, 3.5, 0, 2 * Math.PI);
          ctx.fill();

          ctx.font = '600 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fed7aa';
          ctx.fillText('STUDY REPORT', x + 20, y + 12);

          // Creator Handle on top right
          ctx.font = '500 8px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          const creatorTxt = '@' + (node.creator || 'reel');
          ctx.fillText(creatorTxt.slice(0, 14), x + cardW - 10, y + 12);

          // Wrapped Title Text (Clean, multi-line, no leaking)
          ctx.font = '600 11px Outfit, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const titleLines = wrapCanvasText(ctx, node.label, cardW - 22, 2);
          const startY = y + 24;
          titleLines.forEach((line, idx) => {
            ctx.fillText(line, x + 10, startY + (idx * 14));
          });

          // Bottom Tags
          if (node.tags && node.tags.length > 0) {
            ctx.font = '500 8px "JetBrains Mono", monospace';
            ctx.fillStyle = 'rgba(254, 215, 170, 0.65)';
            const tagPreview = '#' + node.tags.slice(0, 2).join(' #');
            ctx.fillText(tagPreview.slice(0, 28), x + 10, y + cardH - 12);
          }
        } else {
          // ==========================================
          // 2. ACADEMIC GOAL CARD (RIGHT SIDE, OBSIDIAN/AMBER FROSTED GLASS)
          // ==========================================
          const cardW = 230;
          const cardH = 76;
          const x = node.x - cardW / 2;
          const y = node.y - cardH / 2;
          const radius = 8;

          // Glowing aura matching website theme
          ctx.shadowColor = 'rgba(249, 115, 22, 0.28)';
          ctx.shadowBlur = 14;

          // Transparent Obsidian Glass Card
          ctx.fillStyle = 'rgba(8, 14, 18, 0.84)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1.2;

          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, y, cardW, cardH, radius);
          } else {
            ctx.rect(x, y, cardW, cardH);
          }
          ctx.fill();
          ctx.stroke();

          // Reset shadow for text
          ctx.shadowBlur = 0;

          // Header Badge: Emerald/Teal Diamond + "ACADEMIC AIM"
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(x + 12, y + 12, 3.5, 0, 2 * Math.PI);
          ctx.fill();

          ctx.font = '600 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#a7f3d0';
          ctx.fillText('ACADEMIC GOAL', x + 20, y + 12);

          // Wrapped Goal Text (Clean, multi-line, no leaking)
          ctx.font = '500 11px Outfit, sans-serif';
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const goalLines = wrapCanvasText(ctx, node.label, cardW - 20, 3);
          const startY = y + 23;
          goalLines.forEach((line, idx) => {
            ctx.fillText(line, x + 10, startY + (idx * 14));
          });
        }
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        const w = node.type === 'report' ? 195 : 230;
        const h = node.type === 'report' ? 72 : 76;
        ctx.fillStyle = color;
        ctx.fillRect(node.x - w / 2, node.y - h / 2, w, h);
      })
      .linkCurvature(0.18)
      .linkColor(link => (link.type === 'report_to_goal' ? 'rgba(234, 88, 12, 0.65)' : 'rgba(255, 255, 255, 0.22)'))
      .linkWidth(link => Math.max(1.5, (link.score || 0.6) * 3))
      .linkDirectionalParticles(link => (link.type === 'report_to_goal' ? 4 : 2))
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleWidth(3.2)
      .linkDirectionalParticleColor(() => '#fed7aa')
      .onNodeClick(node => handleNodeClick(node))
      .onLinkClick(link => handleLinkClick(link))
      .cooldownTicks(90);

    // Apply D3 Physics Force Separation: Reports Left, Goals Right, Zero Overlaps
    if (window.d3) {
      // 1. Separate Reports on the left and Goals on the right (like notebook schematic)
      state.forceGraphInstance.d3Force('x', d3.forceX(node => (node.type === 'report' ? -260 : 260)).strength(0.4));
      state.forceGraphInstance.d3Force('y', d3.forceY(0).strength(0.08));

      // 2. Large collision padding so cards NEVER touch or overlap
      state.forceGraphInstance.d3Force('collide', d3.forceCollide(node => (node.type === 'goal' ? 140 : 120)).strength(1));

      // 3. Strong repulsion charge
      state.forceGraphInstance.d3Force('charge', d3.forceManyBody().strength(-900));

      // 4. Generous link distance across the center
      const linkForce = state.forceGraphInstance.d3Force('link');
      if (linkForce) {
        linkForce.distance(300);
      }
    }

    state.forceGraphInstance.graphData(state.graphData);
  } else if (state.forceGraphInstance) {
    state.forceGraphInstance.width(w).height(h);
  }
}

function updateKnowledgeGraph(graphData) {
  if (!graphData) return;
  state.graphData = graphData;

  // Update counters
  const reportsCount = graphData.nodes.filter(n => n.type === 'report').length;
  const goalsCount = graphData.goals ? graphData.goals.length : 0;
  const linksCount = graphData.links ? graphData.links.length : 0;

  if (statReportsCount) statReportsCount.textContent = reportsCount;
  if (statGoalsCount) statGoalsCount.textContent = goalsCount;
  if (statLinksCount) statLinksCount.textContent = linksCount;
  if (graphNodesCountBadge) graphNodesCountBadge.textContent = reportsCount + goalsCount;

  // Render Goals List
  renderGoalsList(graphData.goals || []);

  // Update Visual Canvas
  if (state.forceGraphInstance) {
    state.forceGraphInstance.graphData(graphData);
    setTimeout(() => {
      state.forceGraphInstance.zoomToFit(500, 60);
    }, 200);
  }
}

async function loadInitialGraph() {
  try {
    const res = await fetch('/api/graph');
    if (res.ok) {
      const data = await res.json();
      if (data.graph) {
        updateKnowledgeGraph(data.graph);
      }
    }
  } catch (err) {
    console.warn('Initial graph load warning:', err.message);
  }
}

async function loadInitialReports() {
  try {
    const reports = [];
    let offset = 0;
    let total = 0;

    do {
      const response = await fetch(`/api/reports?limit=200&offset=${offset}`);
      if (!response.ok) {
        throw new Error(`Saved reports request failed (${response.status}).`);
      }
      const data = await response.json();
      reports.push(...(data.reports || []));
      total = data.total || 0;
      offset += data.limit || 200;
    } while (offset < total);

    reports.reverse().forEach(addCard);
  } catch (err) {
    console.warn('Saved reports could not be restored:', err.message);
    showStatus(`Saved reports could not be restored: ${err.message}`, true);
  }
}

function renderGoalsList(goals) {
  if (!goalsContainer) return;
  if (!goals.length) {
    goalsContainer.innerHTML = '<div class="no-goals-hint">No goals defined yet. Add an academic aim above to generate graph connections.</div>';
    return;
  }

  goalsContainer.innerHTML = goals.map(g => `
    <div class="goal-card-item">
      <div class="goal-card-text">${esc(g.text)}</div>
      <button class="btn-delete-goal" onclick="deleteGoal('${esc(g.id)}')" title="Remove Goal">×</button>
    </div>
  `).join('');
}

async function deleteGoal(goalId) {
  try {
    const res = await fetch(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.graph) {
      updateKnowledgeGraph(data.graph);
    }
  } catch (err) {
    alert('Failed to remove goal: ' + err.message);
  }
}

// ==========================================
// 8. GRAPH INTERACTION & INSPECTOR
// ==========================================
function handleNodeClick(node) {
  state.selectedGraphItem = node;
  if (state.forceGraphInstance) {
    state.forceGraphInstance.centerAt(node.x, node.y, 400);
    state.forceGraphInstance.zoom(1.8, 400);
  }

  const isReport = node.type === 'report';
  const badge = document.getElementById('inspectorBadge');
  const title = document.getElementById('inspectorTitle');
  const body = document.getElementById('inspectorBody');
  const meta = document.getElementById('inspectorMeta');

  badge.textContent = isReport ? 'Report Node (Amber)' : 'Academic Goal Node (Emerald)';
  badge.style.background = isReport ? 'rgba(234, 88, 12, 0.25)' : 'rgba(16, 185, 129, 0.25)';
  badge.style.color = isReport ? '#fed7aa' : '#a7f3d0';

  title.textContent = node.label;
  body.textContent = isReport ? (node.summary || 'Study notes from creator @' + (node.creator || 'unknown')) : 'Student learning objective & target aim.';

  const connectedLinks = state.graphData.links.filter(l => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    return s === node.id || t === node.id;
  });

  meta.innerHTML = `<span>Connected Bridges: ${connectedLinks.length}</span>`;
  connectionInspector.classList.add('active');
}

function handleLinkClick(link) {
  state.selectedGraphItem = link;
  const badge = document.getElementById('inspectorBadge');
  const title = document.getElementById('inspectorTitle');
  const body = document.getElementById('inspectorBody');
  const meta = document.getElementById('inspectorMeta');

  badge.textContent = 'AI Semantic Connection';
  badge.style.background = 'rgba(249, 115, 22, 0.25)';
  badge.style.color = '#fed7aa';

  const sId = typeof link.source === 'object' ? link.source.id : link.source;
  const tId = typeof link.target === 'object' ? link.target.id : link.target;
  const srcNode = state.graphData.nodes.find(n => n.id === sId);
  const tgtNode = state.graphData.nodes.find(n => n.id === tId);

  title.textContent = `${srcNode ? srcNode.label : 'Report'} ➔ ${tgtNode ? tgtNode.label : 'Goal'}`;
  body.textContent = link.reason || 'Semantic bridge identified as relevant to this academic aim.';
  meta.innerHTML = `<span>Relevance Score: ${Math.round((link.score || 0.7) * 100)}%</span>`;

  connectionInspector.classList.add('active');
}

function closeInspector() {
  if (connectionInspector) {
    connectionInspector.classList.remove('active');
  }
}

function resetGraphView() {
  if (state.forceGraphInstance) {
    state.forceGraphInstance.zoomToFit(400, 30);
  }
}

function zoomGraph(factor) {
  if (state.forceGraphInstance) {
    const current = state.forceGraphInstance.zoom();
    state.forceGraphInstance.zoom(current * factor, 300);
  }
}
