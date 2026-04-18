/**
 * js/pages/quiz-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All import paths use absolute /services/ and /js/ roots.
 */

import { quizService } from '/services/quizService.js';
import { startSync   } from '/js/sync.js';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await init();
  } catch (err) {
    console.error('[quiz-page] Fatal init error:', err);
    const t = document.getElementById('toast');
    if (t) { t.textContent = `⚠️ Quiz could not load: ${err.message}`; t.classList.add('show'); }
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────
const API_TIMEOUT_MS      = 25000;
const MAX_RETRIES         = 2;
const MAX_GEN_ATTEMPTS    = 3;
const MIN_QUESTION_COUNT  = 1;
const MAX_QUESTION_COUNT  = 50;
const DEFAULT_QUESTION_COUNT = 10;
const MAX_INPUT_CHARS     = 8000;

let quizzes      = [];
let activeQuizId = null;
let searchQuery  = '';
const quizSettings = { questionCount: DEFAULT_QUESTION_COUNT };

let activeQuizData        = null;
let currentQuestionIndex  = 0;
let userScore             = 0;
let hasAnsweredCurrent    = false;

// ─── Utilities ───────────────────────────────────────────────────────────────
function setOverlayStatus(msg) {
  const el = document.getElementById('overlayStatus');
  if (el) el.textContent = msg;
}

function clampQuestionCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_QUESTION_COUNT;
  return Math.min(MAX_QUESTION_COUNT, Math.max(MIN_QUESTION_COUNT, parsed));
}

function updateQuestionCount(value) {
  quizSettings.questionCount = clampQuestionCount(value);
  const input = document.getElementById('questionCountInput');
  if (input) input.value = quizSettings.questionCount;
  return quizSettings.questionCount;
}

function resetScrollPosition(elementId) {
  const element = document.getElementById(elementId);
  if (element) element.scrollTop = 0;
}

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('quizList');
  const q    = searchQuery.toLowerCase();
  const filtered = quizzes.filter((quiz) => !q || (quiz.title || '').toLowerCase().includes(q));

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <p>${q ? 'No results' : 'No quizzes yet'}</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map((quiz) => `
    <div class="quiz-item ${quiz.id === activeQuizId ? 'active' : ''}" onclick="window.__qzOpen('${quiz.id}')">
      <div class="quiz-item-content">
        <div class="quiz-title-preview">${quiz.title || 'Untitled Quiz'}</div>
        <div class="quiz-stats">${quiz.questions?.length || 0} Questions • Best: ${quiz.bestScore || 0}/${quiz.questions?.length || 0}</div>
      </div>
      <button class="delete-btn" title="Delete" onclick="event.stopPropagation(); window.__qzDelete('${quiz.id}')">×</button>
    </div>`).join('');
}

async function deleteQuiz(id) {
  if (!confirm('Delete this quiz?')) return;
  await quizService.delete(id);
  quizzes = await quizService.getAll();
  if (activeQuizId === id) createNewQuizUI();
  else renderSidebar();
}

// ─── View routing ─────────────────────────────────────────────────────────────
function showView(viewId) {
  document.getElementById('genView').style.display     = 'none';
  document.getElementById('playerView').style.display  = 'none';
  document.getElementById('resultsView').style.display = 'none';
  document.getElementById(viewId).style.display = 'flex';
}

function createNewQuizUI() {
  activeQuizId = null;
  document.getElementById('newQuizTitle').value = '';
  document.getElementById('sourceText').value   = '';
  updateQuestionCount(quizSettings.questionCount);
  renderSidebar();
  showView('genView');
  resetScrollPosition('genView');
}

function openQuiz(id) {
  activeQuizId = id;
  renderSidebar();
  startQuiz(quizzes.find((q) => q.id === id));
}

// ─── Quiz generation pipeline ─────────────────────────────────────────────────
function buildQuestionTypeInstruction(questionCount) {
  if (questionCount === 1) return 'Use the single strongest question type for the material.';
  if (questionCount === 2) return 'Use two different question types across the quiz.';
  const counts = {
    conceptual:   Math.floor(questionCount / 3),
    definition:   Math.floor(questionCount / 3),
    application:  Math.floor(questionCount / 3),
  };
  const types = ['conceptual', 'definition', 'application'];
  for (let i = 0; i < questionCount % types.length; i++) counts[types[i]] += 1;
  return `Use this question-type distribution across the quiz: ${counts.conceptual} conceptual, ${counts.definition} definition, and ${counts.application} application.`;
}

function buildQuizPrompt(sourceText, questionCount) {
  const safeText          = sourceText.slice(0, 6000).trim();
  const safeQuestionCount = clampQuestionCount(questionCount);
  const typeInstruction   = buildQuestionTypeInstruction(safeQuestionCount);

  return `You are an expert educator and quiz designer. Your task is to create a high-quality multiple-choice quiz from the provided study material.

STUDY MATERIAL:
"""
${safeText}
"""

INSTRUCTIONS:
- Generate EXACTLY ${safeQuestionCount} multiple-choice questions.
- The final JSON array must contain exactly ${safeQuestionCount} question objects.
- ${typeInstruction}
- Each question must test UNDERSTANDING, not surface-level recall.
- Wrong answer options must be plausible and drawn from related concepts — not obviously incorrect.
- Vary sentence structure and phrasing across questions; never repeat the same opening.
- Every question must include a clear explanation of why the correct answer is right.
- Assign a difficulty of "easy", "medium", or "hard" to each question.

OUTPUT FORMAT:
Return ONLY a raw JSON array. No markdown, no backticks, no preamble, no trailing text.
Each element must follow this exact schema:

[
  {
    "question": "string — the question text",
    "type": "conceptual" | "definition" | "application",
    "difficulty": "easy" | "medium" | "hard",
    "options": ["string", "string", "string", "string"],
    "correctIndex": 0,
    "explanation": "string — why this answer is correct and others are not"
  }
]

STRICT RULES:
- Return exactly ${safeQuestionCount} objects in the array. No more, no fewer.
- correctIndex must be an integer 0–3 matching the correct item in options[].
- options[] must contain exactly 4 strings.
- explanation must be 1–3 sentences.
- Do not number or label the options inside the string values.
- Return valid JSON only. Any deviation will break the system.`;
}

function safeParseJSON(raw) {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const arrayMatch = cleaned.match(/(\[[\s\S]*\])/);
  if (arrayMatch) { try { return JSON.parse(arrayMatch[1]); } catch (_) {} }
  const objMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[1]);
      const inner  = parsed.questions || parsed.quiz || parsed.data;
      if (Array.isArray(inner)) return inner;
    } catch (_) {}
  }
  return null;
}

function validateQuestion(q) {
  const issues = [];
  if (!q || typeof q !== 'object') return { valid: false, issues: ['Not an object'] };
  if (typeof q.question !== 'string' || q.question.trim().length < 5) issues.push('Missing or too-short question string');
  if (!Array.isArray(q.options) || q.options.length !== 4) issues.push(`options must be array of 4; got ${Array.isArray(q.options) ? q.options.length : typeof q.options}`);
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) issues.push(`correctIndex out of range: ${q.correctIndex}`);
  return { valid: issues.length === 0, issues };
}

function repairQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const r = { ...q };
  if (typeof r.question !== 'string') r.question = String(r.question || '').trim();
  if (r.question.length < 5) return null;
  if (!Array.isArray(r.options)) {
    if (r.options && typeof r.options === 'object') r.options = Object.values(r.options).slice(0, 4).map(String);
    else return null;
  }
  while (r.options.length < 4) r.options.push(`Option ${r.options.length + 1}`);
  r.options = r.options.slice(0, 4).map((o) => String(o));
  if (!Number.isInteger(r.correctIndex) || r.correctIndex < 0 || r.correctIndex > 3) {
    const parsed = parseInt(r.correctIndex, 10);
    r.correctIndex = (!isNaN(parsed) && parsed >= 0 && parsed <= 3) ? parsed : 0;
  }
  if (typeof r.explanation !== 'string' || r.explanation.trim().length === 0) {
    r.explanation = `The correct answer is option ${r.correctIndex + 1}: "${r.options[r.correctIndex]}".`;
  }
  const validTypes = ['conceptual', 'definition', 'application'];
  if (!validTypes.includes(r.type)) r.type = 'conceptual';
  const validDiff = ['easy', 'medium', 'hard'];
  if (!validDiff.includes(r.difficulty)) r.difficulty = 'medium';
  return r;
}

function validateAndRepairBatch(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  return rawArray.reduce((acc, q) => {
    const { valid } = validateQuestion(q);
    if (valid) { acc.push(q); }
    else {
      const repaired = repairQuestion(q);
      if (repaired) {
        const { valid: rv } = validateQuestion(repaired);
        if (rv) acc.push(repaired);
      }
    }
    return acc;
  }, []);
}

async function callChatAPI(promptText) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'chat', message: promptText }),
      signal:  controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, reply: null, errorType: response.status >= 500 ? 'server' : 'client', status: response.status };
    }
    const data  = await response.json();
    const reply = data.reply || data.result || null;
    return { ok: true, reply, errorType: null };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') return { ok: false, reply: null, errorType: 'timeout' };
    return { ok: false, reply: null, errorType: 'network' };
  }
}

async function fetchWithRetry(promptText, maxRetries = MAX_RETRIES) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      setOverlayStatus(`Retrying (attempt ${attempt + 1} of ${maxRetries + 1})…`);
      await new Promise((r) => setTimeout(r, delay));
    }
    const result = await callChatAPI(promptText);
    if (result.ok) return result;
    if (result.errorType === 'client') throw new Error('Invalid request sent to API.');
    lastError = result.errorType;
  }
  const messages = {
    timeout: 'The AI took too long to respond. Please try again.',
    server:  'The AI service is unavailable. Please try again shortly.',
    network: 'Network error. Check your connection and try again.',
  };
  throw new Error(messages[lastError] || 'Unexpected error. Please try again.');
}

async function generateQuizQuestions(sourceText, questionCount, attemptNumber = 1) {
  const safeQuestionCount = clampQuestionCount(questionCount);
  if (attemptNumber > MAX_GEN_ATTEMPTS) {
    throw new Error(`Could not generate exactly ${safeQuestionCount} valid questions after multiple attempts. Try more source text or request fewer questions.`);
  }
  if (attemptNumber > 1) setOverlayStatus('Question count mismatch — regenerating…');
  else setOverlayStatus('');

  const prompt    = buildQuizPrompt(sourceText, safeQuestionCount);
  const { reply } = await fetchWithRetry(prompt);
  const parsed    = safeParseJSON(reply);
  if (!parsed) return generateQuizQuestions(sourceText, safeQuestionCount, attemptNumber + 1);

  const questions = validateAndRepairBatch(Array.isArray(parsed) ? parsed : [parsed]);
  if (questions.length < safeQuestionCount) return generateQuizQuestions(sourceText, safeQuestionCount, attemptNumber + 1);
  return questions.slice(0, safeQuestionCount);
}

// ─── Generate button ──────────────────────────────────────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  const title         = document.getElementById('newQuizTitle').value.trim() || 'Untitled Quiz';
  const text          = document.getElementById('sourceText').value.trim();
  const genBtn        = document.getElementById('generateBtn');
  const overlay       = document.getElementById('aiOverlay');
  const questionCount = updateQuestionCount(document.getElementById('questionCountInput').value);

  if (!text) { showToast('✍️ Please paste some text to generate a quiz'); return; }
  if (text.length < 50) { showToast('⚠️ Text is too short. Add more content for better questions.'); return; }
  if (text.length > MAX_INPUT_CHARS) { showToast(`⚠️ Text is too long. Please limit to ${MAX_INPUT_CHARS} characters.`); return; }

  overlay.classList.add('show');
  genBtn.disabled = true;
  setOverlayStatus('');

  try {
    const questions = await generateQuizQuestions(text, questionCount);
    const created   = await quizService.create({
      title, questions, requestedQuestionCount: questionCount,
      bestScore: 0, createdAt: Date.now(),
    });
    quizzes = await quizService.getAll();
    showToast(`✨ Quiz ready — ${questions.length} questions generated!`);
    openQuiz(created.id);
  } catch (err) {
    console.error('[QuizGen] Generation failed:', err);
    showToast(`⚠️ ${err.message || 'Failed to generate quiz. Please try again.'}`);
  } finally {
    overlay.classList.remove('show');
    genBtn.disabled = false;
    setOverlayStatus('');
  }
});

// ─── Quiz player ─────────────────────────────────────────────────────────────
function startQuiz(quiz) {
  if (!quiz) return;
  activeQuizData       = quiz;
  currentQuestionIndex = 0;
  userScore            = 0;
  showView('playerView');
  renderQuestion();
}

function renderQuestion() {
  hasAnsweredCurrent = false;
  document.getElementById('nextBtn').style.display = 'none';
  document.getElementById('explanationArea').innerHTML = '';
  resetScrollPosition('playerScrollArea');

  const qCount   = activeQuizData.questions.length;
  const progress = (currentQuestionIndex / qCount) * 100;
  document.getElementById('progressBar').style.width = progress + '%';

  const qData = activeQuizData.questions[currentQuestionIndex];
  document.getElementById('qCounter').textContent = `Question ${currentQuestionIndex + 1} of ${qCount}`;
  document.getElementById('qText').textContent    = qData.question;

  const badge = document.getElementById('qTypeBadge');
  if (qData.type) {
    const labels = { conceptual: '💡 Conceptual', definition: '📖 Definition', application: '🔬 Application' };
    badge.innerHTML = `<span class="question-type-badge">${labels[qData.type] || qData.type}</span>`;
  } else {
    badge.innerHTML = '';
  }

  const grid = document.getElementById('optionsGrid');
  grid.innerHTML = qData.options.map((opt, idx) => `
    <button class="option-btn" onclick="window.__qzAnswer(${idx}, this)">
      <span>${opt}</span>
      <svg class="result-icon" style="display:none; width:18px; height:18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
    </button>`).join('');
}

function selectAnswer(selectedIndex, btnElement) {
  if (hasAnsweredCurrent) return;
  hasAnsweredCurrent = true;

  const qData        = activeQuizData.questions[currentQuestionIndex];
  const correctIndex = qData.correctIndex;
  const allBtns      = document.querySelectorAll('.option-btn');

  allBtns.forEach((b) => b.classList.add('disabled'));

  if (selectedIndex === correctIndex) {
    userScore++;
    btnElement.classList.add('correct');
    btnElement.querySelector('.result-icon').style.display = 'block';
  } else {
    btnElement.classList.add('wrong');
    const wrongIcon = btnElement.querySelector('.result-icon');
    wrongIcon.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
    wrongIcon.style.display = 'block';
    allBtns[correctIndex].classList.add('correct');
  }

  if (qData.explanation) {
    document.getElementById('explanationArea').innerHTML = `
      <div class="explanation-panel">
        <div class="explanation-label">Explanation</div>
        <div>${qData.explanation}</div>
      </div>`;
  }

  const nextBtn   = document.getElementById('nextBtn');
  nextBtn.textContent  = currentQuestionIndex < activeQuizData.questions.length - 1 ? 'Next Question ➔' : 'See Results ✨';
  nextBtn.style.display = 'block';
}

document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentQuestionIndex < activeQuizData.questions.length - 1) {
    currentQuestionIndex++;
    renderQuestion();
  } else {
    finishQuiz();
  }
});

async function finishQuiz() {
  const total = activeQuizData.questions.length;
  if (userScore > (activeQuizData.bestScore || 0)) {
    await quizService.update(activeQuizData.id, { bestScore: userScore });
    activeQuizData.bestScore = userScore;
    quizzes = await quizService.getAll();
    renderSidebar();
  }
  document.getElementById('resultsTitle').textContent = activeQuizData.title;
  document.getElementById('scoreCircle').textContent  = `${userScore}/${total}`;

  const pct = userScore / total;
  let msg   = "Keep studying, you'll get it!";
  if (pct === 1)       msg = 'Perfect score! Brilliant!';
  else if (pct >= 0.8) msg = 'Great job! Almost perfect.';
  else if (pct >= 0.5) msg = 'Good effort, keep reviewing!';
  document.getElementById('resultsMsg').textContent = msg;
  showView('resultsView');
}

function retakeQuiz() { startQuiz(activeQuizData); }

// ─── Event bindings ───────────────────────────────────────────────────────────
document.getElementById('newQuizBtn').addEventListener('click', createNewQuizUI);
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderSidebar();
});
document.getElementById('questionCountInput').addEventListener('change', (e) => { updateQuestionCount(e.target.value); });
document.getElementById('questionCountInput').addEventListener('blur',   (e) => { updateQuestionCount(e.target.value); });

// ─── Global window hooks ──────────────────────────────────────────────────────
window.__qzOpen     = openQuiz;
window.__qzDelete   = deleteQuiz;
window.__qzAnswer   = selectAnswer;
window.retakeQuiz   = retakeQuiz;
window.createNewQuizUI = createNewQuizUI;

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  startSync();
  quizzes = await quizService.getAll();
  renderSidebar();
  updateQuestionCount(quizSettings.questionCount);
  createNewQuizUI();
}

bootstrap();
