/**
 * js/pages/taskflow-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All import paths use absolute /services/ and /js/ roots.
 */

import { tasksService } from '/services/tasksService.js';
import { startSync    } from '/js/sync.js';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await init();
  } catch (err) {
    console.error('[taskflow-page] Fatal init error:', err);
    const t = document.getElementById('toast');
    if (t) { t.textContent = `⚠️ Tasks could not load: ${err.message}`; t.classList.add('show'); }
  }
}

const MODES = {
  focus:  { label: 'Focus Session',  minutes: 25 },
  deep:   { label: 'Deep Work',      minutes: 45 },
  review: { label: 'Review Sprint',  minutes: 15 },
  break:  { label: 'Beach Break 🌊', minutes: 5  },
  custom: { label: 'Custom Timer',   minutes: 0  },
};

let timerState = {
  mode: 'focus', totalSeconds: 25 * 60, timeLeft: 25 * 60,
  running: false, timerId: null,
};

let activeTaskId   = null;
let activeTaskText = null;

const timerSection  = document.getElementById('timerSection');
const displayEl     = document.getElementById('timerDisplay');
const sessionLabel  = document.getElementById('sessionLabel');
const statusBadge   = document.getElementById('statusBadge');
const statusText    = document.getElementById('statusText');
const startBtn      = document.getElementById('startBtn');
const resetBtn      = document.getElementById('resetBtn');
const ringProgress  = document.getElementById('ringProgress');
const completionOver= document.getElementById('completionOverlay');
const completionSub = document.getElementById('completionSub');
const activeTaskBanner = document.getElementById('activeTaskBanner');
const customModal   = document.getElementById('customModal');
const customHours   = document.getElementById('customHours');
const customMinutes = document.getElementById('customMinutes');
const customSeconds = document.getElementById('customSeconds');
const customPillTime= document.getElementById('customPillTime');

const R    = 118;
const CIRC = 2 * Math.PI * R;
ringProgress.style.strokeDasharray = CIRC;

function updateRing() {
  const progress = timerState.totalSeconds > 0 ? timerState.timeLeft / timerState.totalSeconds : 0;
  ringProgress.style.strokeDashoffset = CIRC * (1 - progress);
  if (progress < 0.2)      ringProgress.style.stroke = 'rgba(255,130,100,0.9)';
  else if (progress < 0.4) ringProgress.style.stroke = 'rgba(255,200,80,0.9)';
  else                      ringProgress.style.stroke = 'rgba(255,255,255,0.9)';
}

function formatTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderTimer() {
  displayEl.textContent = formatTime(timerState.timeLeft);
  updateRing();
  sessionLabel.textContent = MODES[timerState.mode].label;
  statusBadge.className    = 'status-badge';
  timerSection.className   = 'timer-section';

  if (timerState.running) {
    statusBadge.classList.add('running');
    statusText.textContent = 'Focusing';
    timerSection.classList.add('running');
    startBtn.textContent   = 'Pause';
  } else if (timerState.timeLeft < timerState.totalSeconds && timerState.timeLeft > 0) {
    statusBadge.classList.add('paused');
    statusText.textContent = 'Paused';
    timerSection.classList.add('paused');
    startBtn.textContent   = 'Resume';
  } else {
    statusText.textContent = 'Ready';
    startBtn.textContent   = 'Start Session';
  }
}

function tick() {
  timerState.timeLeft--;
  if (timerState.timeLeft <= 0) {
    timerState.timeLeft = 0;
    clearInterval(timerState.timerId);
    timerState.timerId  = null;
    timerState.running  = false;
    onTimerComplete();
  }
  renderTimer();
}

function startPause() {
  if (timerState.running) {
    clearInterval(timerState.timerId);
    timerState.timerId = null;
    timerState.running = false;
  } else {
    if (timerState.timeLeft === 0) return;
    timerState.running = true;
    timerState.timerId = setInterval(tick, 1000);
  }
  renderTimer();
}

function resetTimer() {
  clearInterval(timerState.timerId);
  timerState.timerId = null;
  timerState.running = false;
  timerState.timeLeft= timerState.totalSeconds;
  completionOver.classList.remove('visible');
  renderTimer();
}

function onTimerComplete() {
  timerSection.classList.add('finished');
  statusBadge.classList.add('finished');
  statusText.textContent = 'Complete';
  const mins = Math.round(timerState.totalSeconds / 60);
  completionSub.textContent = activeTaskText
    ? `Finished: "${activeTaskText.substring(0, 40)}${activeTaskText.length > 40 ? '…' : ''}"`
    : `You focused for ${mins} minute${mins !== 1 ? 's' : ''}`;
  completionOver.classList.add('visible');
  if (activeTaskId && typeof confetti === 'function') {
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
  }
  renderTimer();
}

let tasks = [];

function focusTask(id, text, timeMinutes) {
  if (timerState.running) {
    if (!confirm(`Stop current session and focus on "${text}"?`)) return;
    clearInterval(timerState.timerId);
    timerState.timerId = null;
    timerState.running = false;
  }
  activeTaskId   = id;
  activeTaskText = text;
  const secs = (timeMinutes || 25) * 60;
  timerState.totalSeconds = secs;
  timerState.timeLeft     = secs;
  timerState.mode = 'custom';
  MODES.custom.minutes = timeMinutes || 25;
  MODES.custom.label   = 'Task Focus';
  customPillTime.textContent = `${timeMinutes || 25} min`;
  document.querySelectorAll('.mode-pill').forEach((p) => p.classList.remove('active'));
  document.querySelector('[data-mode="custom"]').classList.add('active');
  customModal.classList.remove('visible');
  completionOver.classList.remove('visible');
  activeTaskBanner.textContent = `Focusing: ${text.substring(0, 50)}${text.length > 50 ? '…' : ''}`;
  activeTaskBanner.classList.add('visible');
  renderTimer();
  renderTasks();
  showToast(`⏱ Timer set to ${timeMinutes || 25} min for this task`);
}

document.getElementById('nextSessionBtn').addEventListener('click', () => {
  completionOver.classList.remove('visible');
  if (activeTaskId) {
    toggleTask(activeTaskId, true);
    activeTaskId = null; activeTaskText = null;
    activeTaskBanner.classList.remove('visible');
  }
  resetTimer();
});
document.getElementById('doneBtn').addEventListener('click', () => {
  completionOver.classList.remove('visible');
  activeTaskId = null; activeTaskText = null;
  activeTaskBanner.classList.remove('visible');
  resetTimer();
});

document.querySelectorAll('.mode-pill').forEach((pill) => {
  pill.addEventListener('click', function () {
    if (timerState.running) return;
    const mode    = this.dataset.mode;
    const minutes = parseInt(this.dataset.minutes, 10);
    document.querySelectorAll('.mode-pill').forEach((p) => p.classList.remove('active'));
    this.classList.add('active');
    timerState.mode = mode;
    activeTaskId = null; activeTaskText = null;
    activeTaskBanner.classList.remove('visible');
    if (mode === 'custom') {
      customModal.classList.toggle('visible');
    } else {
      customModal.classList.remove('visible');
      timerState.totalSeconds = minutes * 60;
      timerState.timeLeft     = timerState.totalSeconds;
    }
    completionOver.classList.remove('visible');
    renderTimer();
  });
});

document.getElementById('applyCustomBtn').addEventListener('click', () => {
  const h = parseInt(customHours.value) || 0;
  const m = parseInt(customMinutes.value) || 0;
  const s = parseInt(customSeconds.value) || 0;
  const total = h * 3600 + m * 60 + s;
  if (total <= 0) { customMinutes.focus(); return; }
  timerState.totalSeconds = total;
  timerState.timeLeft     = total;
  MODES.custom.minutes    = Math.round(total / 60);
  customPillTime.textContent = h > 0 ? `${h}h ${m}m` : `${m} min`;
  customModal.classList.remove('visible');
  renderTimer();
});

document.addEventListener('click', (e) => {
  if (!customModal.contains(e.target) && !e.target.closest('[data-mode="custom"]')) {
    customModal.classList.remove('visible');
  }
});

startBtn.addEventListener('click', startPause);
resetBtn.addEventListener('click', resetTimer);
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); startPause(); }
  if (e.code === 'KeyR')  resetTimer();
});

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTasks() {
  const todoList      = document.getElementById('todoList');
  const completedList = document.getElementById('completedList');
  todoList.innerHTML      = '';
  completedList.innerHTML = '';
  let todoCount = 0;

  tasks.forEach((task) => {
    const el = document.createElement('div');
    el.className = `task-card ${task.completed ? 'completed' : ''}`;

    let energyBadge = '';
    if (task.energy) {
      const e     = task.energy.toLowerCase();
      const label = e === 'high' ? '🔥 High' : e === 'medium' ? '⚡ Medium' : '🌱 Low';
      energyBadge = `<span class="tag energy-${e}">${label}</span>`;
    }

    const isActive       = task.id === activeTaskId;
    const focusBtnClass  = isActive ? 'btn-focus-task active-focus' : 'btn-focus-task';
    const focusBtnText   = isActive ? '▶ Active' : '▶ Focus';

    el.innerHTML = `
      <div class="check-circle" onclick="window.__tfToggle('${task.id}', false)"></div>
      <div class="task-info">
        <div class="task-text" title="${escHtml(task.text)}">${escHtml(task.text)}</div>
        <div class="task-tags">
          ${task.time ? `<span class="tag tag-time">~${task.time}m</span>` : ''}
          ${energyBadge}
        </div>
      </div>
      ${!task.completed ? `<button class="${focusBtnClass}" onclick="window.__tfFocus('${task.id}', ${JSON.stringify(task.text)}, ${task.time || 25})">${focusBtnText}</button>` : ''}
      <button class="btn-delete-task" onclick="window.__tfDelete('${task.id}')" title="Delete">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>`;

    if (task.completed) completedList.appendChild(el);
    else { todoList.appendChild(el); todoCount++; }
  });

  document.getElementById('taskCount').textContent = `${todoCount} task${todoCount !== 1 ? 's' : ''}`;
  if (tasks.filter((t) => !t.completed).length === 0) {
    todoList.innerHTML = '<div class="empty-state">Enter a goal above and let AI break it into micro-tasks 🌊</div>';
  }
}

async function toggleTask(id, silent) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const wasCompleted = task.completed;
  await tasksService.update(id, { completed: !task.completed });
  tasks = await tasksService.getAll();
  renderTasks();
  const now = tasks.find((t) => t.id === id);
  if (now?.completed && !wasCompleted && !silent && typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }
}

async function deleteTask(id) {
  if (id === activeTaskId) {
    activeTaskId = null; activeTaskText = null;
    activeTaskBanner.classList.remove('visible');
  }
  await tasksService.delete(id);
  tasks = await tasksService.getAll();
  renderTasks();
}

window.__tfToggle = toggleTask;
window.__tfFocus  = focusTask;
window.__tfDelete = deleteTask;

document.getElementById('goalInput').addEventListener('keypress', async function (e) {
  if (e.key === 'Enter') {
    const val = this.value.trim();
    if (val) {
      await tasksService.create({ text: val, completed: false, time: 25, energy: 'medium' });
      tasks = await tasksService.getAll();
      this.value = '';
      renderTasks();
    }
  }
});

document.getElementById('explodeBtn').addEventListener('click', explodeTask);

async function explodeTask() {
  const input = document.getElementById('goalInput');
  const goal  = input.value.trim();
  if (!goal) return showToast('Please enter a goal to break down.');

  const btn = document.getElementById('explodeBtn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Breaking…`;

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'task_explosion', goal }),
    });
    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();

    if (data.tasks && data.tasks.length > 0) {
      for (const t of [...data.tasks].reverse()) {
        await tasksService.create({ text: t.text, time: t.time || 25, energy: t.energy || 'medium', completed: false });
      }
      tasks = await tasksService.getAll();
      input.value = '';
      renderTasks();
      showToast(`⚡ Broken into ${data.tasks.length} tasks!`);
    }
  } catch (err) {
    console.error(err);
    showToast('⚠️ AI could not break down the goal. Try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚡ Break Down';
  }
}

document.getElementById('scheduleBtn').addEventListener('click', generateSchedule);

// ─── Helpers for real-time schedule building ──────────────────────────────────

/** Format a Date object as "2:15 PM" */
function formatTimeAmPm(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Given a start Date and an array of task durations (minutes),
 * returns an array of "HH:MM AM – HH:MM AM" strings with 5-min breaks between.
 * Tasks come back from the AI with an `estimatedMinutes` field;
 * we cascade from the real current time.
 */
function buildTimeBlocks(startDate, taskMinutesList, breakMinutes = 5) {
  const blocks = [];
  let cursor = new Date(startDate);
  taskMinutesList.forEach((mins) => {
    const from = new Date(cursor);
    cursor = new Date(cursor.getTime() + mins * 60_000);
    const to = new Date(cursor);
    blocks.push(`${formatTimeAmPm(from)} – ${formatTimeAmPm(to)}`);
    cursor = new Date(cursor.getTime() + breakMinutes * 60_000); // break
  });
  return blocks;
}

async function generateSchedule() {
  const pending = tasks.filter((t) => !t.completed);
  if (pending.length === 0) return showToast('Add some tasks first!');

  const btn = document.getElementById('scheduleBtn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner w" style="display:inline-block;vertical-align:middle;margin-right:8px;"></div> Scheduling…`;

  // Capture the real current time BEFORE the async call so blocks are accurate
  const sessionStart = new Date();

  const taskStr = pending.map((t) => `- ${t.text} (Est: ${t.time}m, Priority: ${t.energy})`).join('\n');
  const prompt  = `You are a strict productivity scheduler. The current time is ${formatTimeAmPm(sessionStart)}.\n\nHere are the tasks:\n${taskStr}\n\nSelect the top 3 most important tasks for today. For each task, return ONLY its name and its estimated duration in minutes (use the Est value provided, do not invent new durations).\n\nReturn ONLY a JSON array, no markdown, no extra text:\n[{"text": "Task description", "estimatedMinutes": 25}]`;

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'chat', message: prompt }),
    });
    if (!res.ok) throw new Error('API error');
    const data  = await res.json();
    const clean = data.reply.replace(/```json/g, '').replace(/```/g, '').trim();
    const aiTasks = JSON.parse(clean);

    // Build accurate time blocks starting from the real current time
    const durations  = aiTasks.map((t) => Number(t.estimatedMinutes) || 25);
    const timeBlocks = buildTimeBlocks(sessionStart, durations, 5);

    const list = document.getElementById('scheduleList');
    list.innerHTML = '';
    aiTasks.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'time-block';
      el.innerHTML = `<div class="time-label-block">${timeBlocks[i]}</div><div class="time-task-text">${escHtml(item.text)}</div>`;
      list.appendChild(el);
    });
    showToast('✨ Schedule ready!');
  } catch (err) {
    console.error(err);
    showToast('⚠️ Could not generate schedule.');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "✨ Generate Today's Plan";
  }
}

document.querySelectorAll('.panel-tab').forEach((tab) => {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
    this.classList.add('active');
    const target = this.dataset.tab;
    document.getElementById('tabTasks').style.display    = target === 'tasks'    ? 'flex' : 'none';
    document.getElementById('tabSchedule').style.display = target === 'schedule' ? 'flex' : 'none';
  });
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function init() {
  startSync();
  tasks = await tasksService.getAll();
  renderTimer();
  renderTasks();
}

bootstrap();
