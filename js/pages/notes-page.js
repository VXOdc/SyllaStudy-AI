/**
 * js/pages/notes-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All import paths use absolute /services/ and /js/ roots.
 */

import { notesService } from '/services/notesService.js';
import { startSync    } from '/js/sync.js';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await init();
  } catch (err) {
    console.error('[notes-page] Fatal init error:', err);
    const c = document.getElementById('editorContainer');
    if (c) {
      c.innerHTML = `<div class="no-note-placeholder" style="color:#f87171;">
        <p>⚠️ Notes could not load: ${err.message}</p>
        <p style="font-size:13px;opacity:.7">Check the console for details.</p>
      </div>`;
    }
  }
}

const ACTIVE_KEY = 'syllastudy_active_note';

let notes         = [];
let activeId      = null;
let saveTimer     = null;
let searchQuery   = '';
let currentAction = null;
let selectedOption= null;
let isProcessing  = false;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(ts) {
  const d    = new Date(ts), now = new Date();
  const mins = Math.floor((now - d) / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24)  return `${hrs}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function stripHtml(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || el.innerText || '';
}

function wordCount(html) {
  const text = stripHtml(html || '').trim();
  return text ? text.split(/\s+/).length : 0;
}

function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textToHtml(text) {
  if (!text) return '';
  return text
    .split(/\n\n+/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function persistActiveId() {
  try {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (_) {}
}

let toastTimer = null;
function showToast(msg, duration = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

async function createNote() {
  const note = await notesService.create({ title: '', content: '' });
  notes    = await notesService.getAll();
  activeId = note.id;
  persistActiveId();
  renderSidebar();
  renderEditor();
  setTimeout(() => { document.getElementById('docTitle')?.focus(); }, 60);
}

async function deleteNote(id) {
  await notesService.delete(id);
  notes = await notesService.getAll();
  if (activeId === id) {
    activeId = notes[0]?.id || null;
    persistActiveId();
  }
  renderSidebar();
  renderEditor();
}

function selectNote(id) {
  flushSave();
  activeId = id;
  persistActiveId();
  renderSidebar();
  renderEditor();
}

function updateActiveNote(field, value) {
  const note = notes.find((n) => n.id === activeId);
  if (!note) return;
  note[field]     = value;
  note.updatedAt  = Date.now();
  clearTimeout(saveTimer);
  showAutosave(true);
  saveTimer = setTimeout(async () => {
    const updated = await notesService.update(activeId, {
      title:     note.title,
      content:   note.content,
      updatedAt: note.updatedAt,
    });
    if (updated) {
      const i = notes.findIndex((n) => n.id === activeId);
      if (i !== -1) notes[i] = { ...notes[i], ...updated };
    }
    renderSidebar();
    showAutosave(false);
  }, 700);
}

async function flushSave() {
  clearTimeout(saveTimer);
  const note = notes.find((n) => n.id === activeId);
  if (note) {
    const rt = document.getElementById('richText');
    const dt = document.getElementById('docTitle');
    if (rt) note.content  = rt.innerHTML;
    if (dt) note.title    = dt.value;
    note.updatedAt = Date.now();
    const updated = await notesService.update(activeId, {
      title: note.title, content: note.content, updatedAt: note.updatedAt,
    });
    if (updated) {
      const i = notes.findIndex((n) => n.id === activeId);
      if (i !== -1) notes[i] = { ...notes[i], ...updated };
    }
  }
}

function showAutosave(saving) {
  const el = document.getElementById('autosaveIndicator');
  if (!el) return;
  if (saving) {
    el.innerHTML = '<span class="autosave-dot"></span> Saving…';
    el.classList.add('show');
  } else {
    el.innerHTML = '<span style="color:#4ade80">✓</span> Saved';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1600);
  }
}

function renderSidebar() {
  const list = document.getElementById('noteList');
  const q    = searchQuery.toLowerCase();
  const filtered = notes.filter(
    (n) => !q || (n.title || '').toLowerCase().includes(q) || stripHtml(n.content || '').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <p>${q ? 'No results' : 'No notes yet'}</p>
      ${!q ? '<p style="font-size:12px;opacity:.6">Click + to create one</p>' : ''}
    </div>`;
    return;
  }

  list.innerHTML = filtered.map((n) => `
    <div class="note-item ${n.id === activeId ? 'active' : ''}" onclick="window.__notesSelect('${n.id}')">
      <div class="note-item-content">
        <div class="note-title-preview">${esc(n.title) || 'Untitled'}</div>
        <div class="note-snippet">${esc(stripHtml(n.content || '').slice(0, 60)) || 'No content'}</div>
        <div class="note-date">${formatDate(n.updatedAt)}</div>
      </div>
      <button class="delete-btn" title="Delete" onclick="event.stopPropagation(); window.__notesConfirmDelete('${n.id}')">×</button>
    </div>`).join('');
}

function confirmDelete(id) {
  const note = notes.find((n) => n.id === id);
  if (confirm(`Delete "${note?.title || 'Untitled'}"?\nThis cannot be undone.`)) {
    deleteNote(id);
    showToast('🗑 Note deleted');
  }
}

function renderEditor() {
  const container = document.getElementById('editorContainer');
  const note      = notes.find((n) => n.id === activeId);

  if (!note) {
    container.innerHTML = `<div class="no-note-placeholder">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <p>Select a note or create a new one</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="toolbar">
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('bold')"><b>B</b></button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('italic')"><i style="font-family:serif">I</i></button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('underline')" style="text-decoration:underline">U</button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('strikeThrough')" style="text-decoration:line-through">S</button>
      <div class="tool-sep"></div>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('formatBlock','h1')">H1</button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('formatBlock','h2')">H2</button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('formatBlock','p')">¶</button>
      <div class="tool-sep"></div>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('insertUnorderedList')">• List</button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('insertOrderedList')">1. List</button>
      <div class="tool-sep"></div>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('undo')">↩</button>
      <button class="tool-btn" onmousedown="window.__notesPD(event)" onclick="window.__notesExec('redo')">↪</button>
      <div class="tool-sep"></div>
      <button class="tool-btn" onclick="window.__notesOpenTransform('summarize')">📝 Sum</button>
      <button class="tool-btn" onclick="window.__notesOpenTransform('rewrite')">✏️ Rewrite</button>
      <button class="tool-btn" onclick="window.__notesOpenTransform('extract')">🔍 Extract</button>
      <button class="tool-btn" onclick="window.__notesOpenTransform('generate')">✨ Gen</button>
      <button class="tool-btn" onclick="window.__notesOpenTransform('explain')">💡 Explain</button>
      <button class="tool-btn" onclick="window.__notesOpenTransform('expand')">📖 Expand</button>
      <button class="tool-btn" onclick="window.__notesOpenTransform('translate')">🌐 Translate</button>
      <div class="autosave-indicator" id="autosaveIndicator"></div>
    </div>
    <div class="editor-wrapper">
      <div class="editor-body">
        <input type="text" class="document-title" id="docTitle"
          placeholder="Untitled Document"
          value="${esc(note.title)}"
          oninput="window.__notesUpdateField('title', this.value)">
        <div class="rich-text" id="richText" contenteditable="true" spellcheck="true">${note.content || ''}</div>
      </div>
      <div class="ai-processing-overlay" id="aiOverlay">
        <div class="ai-spinner"></div>
        <p id="aiOverlayMsg">Processing with AI…</p>
      </div>
    </div>
    <div class="editor-footer">
      <span id="wordCountEl">0 words</span>
      <span>·</span>
      <span id="lastEditedEl">Last edited ${formatDate(note.updatedAt)}</span>
    </div>`;

  const richText = document.getElementById('richText');
  richText.addEventListener('input', () => {
    updateActiveNote('content', richText.innerHTML);
    updateWordCount();
  });
  richText.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  updateWordCount();
}

function updateWordCount() {
  const el = document.getElementById('wordCountEl');
  const rt = document.getElementById('richText');
  if (!el || !rt) return;
  const n = wordCount(rt.innerHTML);
  el.textContent = `${n} word${n !== 1 ? 's' : ''}`;
}

function preventDefault(e) { e.preventDefault(); }

function execCmd(cmd, value = null) {
  document.execCommand(cmd, false, value);
  const rt = document.getElementById('richText');
  if (rt) {
    rt.focus();
    updateActiveNote('content', rt.innerHTML);
    updateWordCount();
  }
}

const TRANSFORM_CONFIGS = {
  summarize: { title: '📝 Summarize', options: [{ label: 'Quick summary', value: 'brief' }, { label: 'Detailed summary', value: 'detailed' }, { label: 'Bullet points', value: 'bullets' }] },
  rewrite:   { title: '✏️ Rewrite',   options: [{ label: 'More concise', value: 'concise' }, { label: 'More academic', value: 'academic' }, { label: 'More casual', value: 'casual' }, { label: 'More structured', value: 'structured' }] },
  extract:   { title: '🔍 Extract',   options: [{ label: 'Key points', value: 'key_points' }, { label: 'Definitions', value: 'definitions' }, { label: 'Concepts', value: 'concepts' }, { label: 'Action items', value: 'action_items' }] },
  generate:  { title: '✨ Generate',  options: [{ label: 'Flashcards', value: 'flashcards' }, { label: 'Study questions', value: 'study_questions' }, { label: 'Outline', value: 'outline' }, { label: 'Mind map (text)', value: 'mindmap' }, { label: 'Study plan', value: 'study_plan' }] },
  explain:   { title: '💡 Explain',   options: [{ label: "Like I'm 5", value: 'simple' }, { label: "Like I'm 12", value: 'intermediate' }, { label: 'Like a professor', value: 'advanced' }] },
  expand:    { title: '📖 Expand',    options: [{ label: 'Expand all points', value: 'full' }, { label: 'Add examples', value: 'examples' }, { label: 'Add explanations', value: 'explanations' }] },
  translate: { title: '🌐 Translate', options: [{ label: 'Spanish', value: 'es' }, { label: 'French', value: 'fr' }, { label: 'German', value: 'de' }, { label: 'Chinese', value: 'zh' }, { label: 'Japanese', value: 'ja' }] },
};

function openTransformModal(action) {
  const note = notes.find((n) => n.id === activeId);
  if (!note) { showToast('No note selected'); return; }
  const plainText = stripHtml(note.content || '').trim();
  if (!plainText) { showToast('✍️ Write something first'); return; }

  currentAction  = action;
  selectedOption = null;

  const config = TRANSFORM_CONFIGS[action];
  document.getElementById('modalTitle').textContent = config.title;
  const optionsEl = document.getElementById('modalOptions');
  optionsEl.innerHTML = config.options.map((opt) =>
    `<div class="modal-option" data-value="${opt.value}" onclick="window.__notesSelOpt(this, '${opt.value}')">${opt.label}</div>`
  ).join('');

  const applyBtn = document.getElementById('applyBtn');
  applyBtn.textContent = 'Apply';
  applyBtn.disabled    = false;
  applyBtn.classList.remove('loading');
  document.getElementById('transformModal').classList.add('show');
}

function closeTransformModal() {
  document.getElementById('transformModal').classList.remove('show');
}

function selectTransformOption(el, value) {
  selectedOption = value;
  document.querySelectorAll('.modal-option').forEach((o) => o.classList.remove('selected'));
  el.classList.add('selected');
}

async function applyTransform() {
  if (!selectedOption) { showToast('Please select an option first'); return; }
  if (!currentAction)  { showToast('Something went wrong — reopen the menu'); return; }
  if (isProcessing) return;

  const note = notes.find((n) => n.id === activeId);
  if (!note) { showToast('No active note'); return; }
  const plainText = stripHtml(note.content || '').trim();
  if (!plainText) { showToast('✍️ Write something first'); return; }

  const action = currentAction;
  const option = selectedOption;
  isProcessing = true;

  const applyBtn = document.getElementById('applyBtn');
  applyBtn.disabled = true;
  applyBtn.classList.add('loading');
  applyBtn.textContent = 'Working';
  closeTransformModal();

  const overlay    = document.getElementById('aiOverlay');
  const overlayMsg = document.getElementById('aiOverlayMsg');
  if (overlay) { overlayMsg.textContent = `${TRANSFORM_CONFIGS[action]?.title || 'Processing'}…`; overlay.classList.add('show'); }

  try {
    const result = await callMistralBackend(action, option, plainText);
    if (!result || !result.trim()) throw new Error('AI returned an empty response');

    const newHTML   = textToHtml(result);
    const richText  = document.getElementById('richText');
    if (richText) richText.innerHTML = newHTML;
    note.content   = newHTML;
    note.updatedAt = Date.now();

    const updated = await notesService.update(activeId, {
      title: note.title, content: note.content, updatedAt: note.updatedAt,
    });
    if (updated) {
      const i = notes.findIndex((n) => n.id === activeId);
      if (i !== -1) notes[i] = { ...notes[i], ...updated };
    }
    renderSidebar();
    updateWordCount();
    showToast(`✨ ${TRANSFORM_CONFIGS[action]?.title?.replace(/^[^\s]+\s/, '') || action} applied!`);
  } catch (err) {
    console.error('AI transform error:', err);
    showToast(`⚠️ ${err.message || 'Something went wrong'}`);
  } finally {
    isProcessing = false;
    if (overlay) overlay.classList.remove('show');
    if (applyBtn) { applyBtn.disabled = false; applyBtn.classList.remove('loading'); applyBtn.textContent = 'Apply'; }
    currentAction  = null;
    selectedOption = null;
  }
}

async function callMistralBackend(action, option, content) {
  const response = await fetch('/api/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type: 'transform', action, option, content }),
  });
  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try { const e = await response.json(); errMsg = e?.error || errMsg; } catch (_) {}
    throw new Error(errMsg);
  }
  const data = await response.json();
  if (!data.result) throw new Error('No valid result in AI response');
  return data.result;
}

// ─── Expose to HTML onclick attributes ──────────────────────────────────────
window.__notesSelect       = selectNote;
window.__notesConfirmDelete= confirmDelete;
window.__notesPD           = preventDefault;
window.__notesExec         = execCmd;
window.__notesOpenTransform= openTransformModal;
window.__notesSelOpt       = selectTransformOption;
window.__notesUpdateField  = updateActiveNote;

// ─── DOM event bindings ──────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderSidebar();
});
document.getElementById('newNoteBtn').addEventListener('click', createNote);
document.getElementById('modalCloseBtn').addEventListener('click', closeTransformModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeTransformModal);
document.getElementById('applyBtn').addEventListener('click', applyTransform);
document.getElementById('transformModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('transformModal')) closeTransformModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTransformModal();
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    flushSave().then(() => showToast('💾 Saved'));
  }
});
window.addEventListener('beforeunload', () => { flushSave(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  startSync();

  try { activeId = localStorage.getItem(ACTIVE_KEY) || null; } catch (_) { activeId = null; }

  notes = await notesService.getAll();

  if (!notes.length) {
    const demo1 = await notesService.create({
      title:   'Biology Chapter 4 Summary',
      content: `<p>Cell division includes both mitosis and meiosis. Mitosis produces two genetically identical daughter cells for growth and repair. Meiosis produces four genetically unique haploid cells for reproduction.</p><p>Key stages of mitosis: Prophase, Metaphase, Anaphase, Telophase (PMAT). Chromosomes condense in prophase, align in metaphase, separate in anaphase, and the cell divides in telophase.</p>`,
      createdAt: Date.now() - 172800000, updatedAt: Date.now() - 86400000,
    });
    await notesService.create({
      title:   'Project Brainstorming',
      content: `<h2>Ideas</h2><ul><li>Interactive study dashboard</li><li>Spaced repetition flashcards</li><li>AI-powered quiz generator</li><li>Pomodoro focus timer</li></ul>`,
      createdAt: Date.now() - 604800000, updatedAt: Date.now() - 604800000,
    });
    const demo3 = await notesService.create({
      title:   '2026 Hardware Notes',
      content: `<p>Next-gen productivity hardware is converging on haptic stylus input with piezoelectric pressure sensors. Variable resistance feedback simulates paper texture for natural writing.</p>`,
      createdAt: Date.now() - 86400000, updatedAt: Date.now() - 300000,
    });
    notes    = await notesService.getAll();
    activeId = demo3?.id || demo1?.id || notes[0]?.id || null;
    persistActiveId();
  } else {
    if (!activeId || !notes.find((n) => n.id === activeId)) {
      activeId = notes[0]?.id || null;
      persistActiveId();
    }
  }

  renderSidebar();
  renderEditor();
}

bootstrap();
