/**
 * js/pages/chat-page.js
 * Enhancements: working archive, projects sidebar section, attachment button removed.
 *
 * Storage keys (localStorage):
 *   syllastudy_chats_cache_v1  – existing chat messages (unchanged)
 *   syllastudy_chat_meta_v1    – { [chatId]: { archived, projectId, name } }
 *   syllastudy_projects_v1     – { [projectId]: { name } }
 */

import { chatService } from '/services/chatService.js';
import { startSync   } from '/js/sync.js';

// ─── Meta / Projects storage ──────────────────────────────────────────────────
const META_KEY     = 'syllastudy_chat_meta_v1';
const PROJECTS_KEY = 'syllastudy_projects_v1';

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function writeMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {} }
function readProjects() {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '{}'); } catch { return {}; }
}
function writeProjects(p) { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(p)); } catch {} }

function getMeta(chatId) {
  return readMeta()[chatId] || { archived: false, projectId: null, name: null };
}
function setMeta(chatId, patch) {
  const m = readMeta();
  m[chatId] = { ...getMeta(chatId), ...patch };
  writeMeta(m);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  try { await main(); }
  catch (err) {
    console.error('[chat-page] Fatal init error:', err);
    const m = document.getElementById('messages');
    if (m) m.innerHTML = `<div class="empty-state" style="color:#f87171;">
        <p>⚠️ Chat could not load: ${err.message}</p>
        <p style="font-size:13px;opacity:.7">Check the console for details.</p></div>`;
  }
}

async function main() {

/* ── STATE ── */
function refreshFromService() {
  const s = chatService.getState();
  chats = s.chats;
  currentChat = s.currentChatId;
}

let chats = {};
let currentChat = Date.now().toString();
let archiveSectionOpen = false;

refreshFromService();
if (!chats[currentChat]) { chats[currentChat] = []; chatService.syncFromUi(chats, currentChat); }

const messagesEl  = document.getElementById('messages');
const wrapperEl   = document.getElementById('messagesWrapper');
const input       = document.getElementById('input');
const sendBtn     = document.getElementById('sendBtn');
const historyList = document.getElementById('historyList');
const contextMenu = document.getElementById('contextMenu');
let currentContextId = null;

function save() { chatService.syncFromUi(chats, currentChat); }

/* ── UTILITY ── */
function showToast(msg, color) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (color) t.style.background = color;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation='slideIn 0.3s ease reverse'; setTimeout(()=>t.remove(),300); }, 2200);
}
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied'); showToast('Copied!');
    setTimeout(() => btn.classList.remove('copied'), 2000);
  }).catch(() => showToast('Failed to copy'));
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getChatPreview(msgs, chatId) {
  const meta = getMeta(chatId);
  if (meta.name) return meta.name;
  const first = (msgs||[]).find(m=>m.role==='user');
  return first ? first.content.replace(/\[📎 Attached:.*?\]/g,'').trim() : 'New Chat';
}

/* ── UI INTERACTIONS ── */
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); }
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  sendBtn.disabled = textarea.value.trim() === '';
}
function handleEnter(e) {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) send(); }
}
function showContextMenu(e, id) {
  e.preventDefault(); e.stopImmediatePropagation();
  currentContextId = id;
  const meta = getMeta(id);
  const lbl = document.getElementById('archiveMenuLabel');
  if (lbl) lbl.textContent = meta.archived ? 'Unarchive' : 'Archive';
  contextMenu.classList.add('show');
  let x = e.pageX+10, y = e.pageY+10;
  setTimeout(() => {
    const r = contextMenu.getBoundingClientRect();
    if (x+r.width  > window.innerWidth)  x = window.innerWidth  - r.width  - 10;
    if (y+r.height > window.innerHeight) y = window.innerHeight - r.height - 10;
    contextMenu.style.left = x+'px';
    contextMenu.style.top  = y+'px';
  }, 0);
}
function hideContextMenu() { contextMenu.classList.remove('show'); }
document.addEventListener('click',  hideContextMenu);
document.addEventListener('scroll', hideContextMenu, true);

/* ── SIDEBAR RENDER ── */
async function newChat() {
  await chatService.create({});
  refreshFromService(); loadChat();
  if (window.innerWidth < 768) closeSidebarMobile();
}
function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
}

function loadChat() {
  messagesEl.innerHTML = '';
  const msgs = chats[currentChat] || [];
  if (msgs.length === 0) {
    messagesEl.innerHTML = `<div class="empty-state">
      <h1>What do you want to learn?</h1>
      <p style="color:var(--text-secondary);font-size:18px;">Type a prompt below to get started.</p></div>`;
  } else {
    msgs.forEach(m => appendMessageHTML(m.content, m.role));
  }
  renderHistory(); scrollToBottom();
}

function renderHistory() {
  historyList.innerHTML = '';
  const meta     = readMeta();
  const projects = readProjects();
  const active   = [], archived = [], byProject = {};

  Object.entries(chats).sort((a,b)=>Number(b[0])-Number(a[0])).forEach(([id,msgs]) => {
    if (msgs.length===0 && id!==currentChat) return;
    const m = meta[id] || {};
    if (m.archived) { archived.push({id,msgs}); return; }
    if (m.projectId && projects[m.projectId]) {
      (byProject[m.projectId] = byProject[m.projectId]||[]).push({id,msgs});
    } else { active.push({id,msgs}); }
  });

  /* Projects section */
  if (Object.keys(projects).length > 0) {
    const ph = document.createElement('div');
    ph.className = 'history-label';
    ph.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding-right:10px;';
    ph.innerHTML = `<span>Projects</span><button onclick="createProject()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:19px;line-height:1;">+</button>`;
    historyList.appendChild(ph);

    Object.entries(projects).forEach(([projId, proj]) => {
      const chatsIn = byProject[projId] || [];
      const folder  = document.createElement('div');
      folder.style.marginBottom = '4px';
      const fh = document.createElement('div');
      fh.className = 'project-folder chat-item';
      fh.style.cssText = 'padding:9px 12px;cursor:pointer;';
      fh.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <div class="chat-item-text">${escHtml(proj.name)}</div>
        <span style="font-size:11px;opacity:.45;margin-left:4px;">${chatsIn.length}</span>`;
      const inner = document.createElement('div');
      inner.style.cssText = 'display:none;padding-left:12px;';
      chatsIn.forEach(({id,msgs}) => inner.appendChild(makeChatItem(id,msgs)));
      fh.onclick = (e) => { e.stopPropagation(); inner.style.display = inner.style.display==='none' ? 'block' : 'none'; };
      folder.appendChild(fh); folder.appendChild(inner);
      historyList.appendChild(folder);
    });
  }

  /* Recent chats label */
  const rh = document.createElement('div');
  rh.className = 'history-label';
  rh.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding-right:10px;';
  rh.innerHTML = Object.keys(projects).length === 0
    ? `<span>Recent Chats</span><button onclick="createProject()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:11px;opacity:.65;">+ Project</button>`
    : `<span>Recent Chats</span>`;
  historyList.appendChild(rh);

  active.slice(0,25).forEach(({id,msgs}) => historyList.appendChild(makeChatItem(id,msgs)));

  /* Archived section */
  if (archived.length > 0) {
    const ah = document.createElement('div');
    ah.className = 'history-label';
    ah.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;padding-right:10px;user-select:none;margin-top:8px;';
    ah.innerHTML = `<svg id="archChevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        style="transition:transform .2s;transform:${archiveSectionOpen?'rotate(90deg)':'rotate(0deg)'}">
        <polyline points="9 18 15 12 9 6"/></svg>Archived (${archived.length})`;
    const al = document.createElement('div');
    al.id = 'archiveInner';
    al.style.display = archiveSectionOpen ? 'block' : 'none';
    archived.forEach(({id,msgs}) => {
      const item = makeChatItem(id,msgs);
      item.style.opacity = '0.6';
      al.appendChild(item);
    });
    ah.onclick = () => {
      archiveSectionOpen = !archiveSectionOpen;
      document.getElementById('archChevron').style.transform = archiveSectionOpen?'rotate(90deg)':'rotate(0deg)';
      al.style.display = archiveSectionOpen ? 'block' : 'none';
    };
    historyList.appendChild(ah);
    historyList.appendChild(al);
  }
}

function makeChatItem(id, msgs) {
  const div = document.createElement('div');
  div.className = `chat-item ${id===currentChat?'active':''}`;
  const preview = getChatPreview(msgs,id);
  div.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <div class="chat-item-text">${escHtml(preview.length>38?preview.slice(0,38)+'…':preview)}</div>
    <div class="menu-btn" onclick="showContextMenu(event,'${id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </div>`;
  div.onclick = (e) => {
    if (!e.target.closest('.menu-btn')) {
      currentChat = id; save(); loadChat();
      if (window.innerWidth < 768) closeSidebarMobile();
    }
  };
  return div;
}

/* ── MESSAGE RENDERING ── */
function appendMessageHTML(text, role) {
  const emptyState = messagesEl.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const row = document.createElement('div');
  row.className = `msg-row ${role==='assistant'?'ai':role}`;
  const container = document.createElement('div');
  container.className = 'msg-container';
  const bubble = document.createElement('div');
  bubble.className = `msg ${role==='assistant'?'ai':role}`;
  bubble.innerHTML = text
    .replace(/\[📎 Attached: (.*?)\]/g,'<br><br><span style="font-size:12px;opacity:.7;background:rgba(150,150,150,.2);padding:4px 8px;border-radius:8px;">📎 $1</span>')
    .replace(/\n/g,'<br>');
  const plainText = text.replace(/\[📎 Attached:.*?\]/g,'').trim();
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.title = 'Copy message';
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
  copyBtn.onclick = () => copyToClipboard(plainText, copyBtn);
  container.appendChild(bubble); container.appendChild(copyBtn);
  row.appendChild(container); messagesEl.appendChild(row);
}
function scrollToBottom() { setTimeout(()=>{ wrapperEl.scrollTop = wrapperEl.scrollHeight; }, 0); }

/* ── CHAT ACTIONS ── */
async function deleteChat() {
  if (confirm('Permanently delete this chat?')) {
    await chatService.delete(currentContextId);
    const m = readMeta(); delete m[currentContextId]; writeMeta(m);
    refreshFromService(); loadChat();
  }
  hideContextMenu();
}
function renameChat() {
  const newName = prompt('Rename chat:', getChatPreview(chats[currentContextId]||[], currentContextId));
  if (newName && newName.trim()) { setMeta(currentContextId, {name: newName.trim()}); renderHistory(); }
  hideContextMenu();
}
function archiveChat() {
  const meta = getMeta(currentContextId);
  const willArchive = !meta.archived;
  setMeta(currentContextId, { archived: willArchive });
  showToast(willArchive ? '📦 Chat archived' : '📬 Chat unarchived');
  if (willArchive && currentContextId === currentChat) {
    const next = Object.keys(chats).find(id => !getMeta(id).archived && id !== currentContextId);
    if (next) { currentChat = next; save(); }
  }
  renderHistory();
  hideContextMenu();
}

/* ── PROJECTS ── */
function createProject() {
  const name = prompt('Project name:');
  if (!name || !name.trim()) return;
  const projects = readProjects();
  projects['proj_'+Date.now()] = { name: name.trim() };
  writeProjects(projects);
  showToast('📁 Project created!');
  renderHistory();
}
function assignToProject() {
  const projects = readProjects();
  const projIds  = Object.keys(projects);
  if (projIds.length === 0) {
    if (confirm('No projects yet. Create one now?')) { hideContextMenu(); createProject(); return; }
    hideContextMenu(); return;
  }
  const list = projIds.map((id,i)=>`${i+1}. ${projects[id].name}`).join('\n');
  const choice = prompt(`Assign to project:\n${list}\n\nEnter number (0 = remove from project):`);
  if (choice === null) { hideContextMenu(); return; }
  const idx = parseInt(choice) - 1;
  if (choice === '0') { setMeta(currentContextId, {projectId:null}); showToast('Removed from project'); }
  else if (idx >= 0 && idx < projIds.length) { setMeta(currentContextId, {projectId:projIds[idx]}); showToast(`Moved to "${projects[projIds[idx]].name}"`); }
  renderHistory(); hideContextMenu();
}

/* ── CORE API ── */
async function send() {
  const text = input.value.trim();
  if (!text) return;
  appendMessageHTML(text, 'user');
  await chatService.appendMessage(currentChat, {role:'user', content:text});
  refreshFromService(); renderHistory(); scrollToBottom();
  input.value = ''; input.style.height = 'auto'; sendBtn.disabled = true;

  const typingRow = document.createElement('div');
  typingRow.className = 'msg-row ai typing-row';
  typingRow.innerHTML = `<div class="msg ai typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  messagesEl.appendChild(typingRow); scrollToBottom();

  try {
    const reply = await chatService.sendChatMessage({ message: text, history: chats[currentChat].slice(0,-1) });
    typingRow.remove();
    appendMessageHTML(reply, 'assistant');
    await chatService.appendMessage(currentChat, {role:'assistant', content:reply});
    refreshFromService();
  } catch (e) {
    typingRow.remove();
    appendMessageHTML('Error: Could not reach the AI. Check your Vercel logs.', 'ai');
    console.error('Fetch error:', e);
  }
  renderHistory(); scrollToBottom();
}

/* ── EXPOSE TO HTML ── */
window.newChat         = newChat;
window.toggleSidebar   = toggleSidebar;
window.autoResize      = autoResize;
window.handleEnter     = handleEnter;
window.send            = send;
window.showContextMenu = showContextMenu;
window.renameChat      = renameChat;
window.archiveChat     = archiveChat;
window.deleteChat      = deleteChat;
window.createProject   = createProject;
window.assignToProject = assignToProject;

startSync();
loadChat();

} // end main()

bootstrap();
