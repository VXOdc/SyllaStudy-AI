/**
 * js/pages/chat-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All import paths use absolute /services/ and /js/ roots so this works
 * whether served from /js/pages/ locally or from the Vercel CDN.
 */

import { chatService } from '/services/chatService.js';
import { startSync   } from '/js/sync.js';

// ─── Bootstrap: safe wrapper so a service error never freezes the page ────────
async function bootstrap() {
  try {
    await main();
  } catch (err) {
    console.error('[chat-page] Fatal init error:', err);
    const m = document.getElementById('messages');
    if (m) {
      m.innerHTML = `<div class="empty-state" style="color:#f87171;">
        <p>⚠️ Chat could not load: ${err.message}</p>
        <p style="font-size:13px; opacity:.7">Check the console for details.</p>
      </div>`;
    }
  }
}

async function main() {

/* ==========================================================================
   STATE MANAGEMENT & INITIALIZATION
   ========================================================================== */
function refreshFromService() {
  const s = chatService.getState();
  chats = s.chats;
  currentChat = s.currentChatId;
}

let chats = {};
let currentChat = Date.now().toString();

refreshFromService();
if (!chats[currentChat]) {
  chats[currentChat] = [];
  chatService.syncFromUi(chats, currentChat);
}

const messagesEl  = document.getElementById('messages');
const wrapperEl   = document.getElementById('messagesWrapper');
const input       = document.getElementById('input');
const sendBtn     = document.getElementById('sendBtn');
const historyList = document.getElementById('historyList');
const contextMenu = document.getElementById('contextMenu');

let currentContextId   = null;
let currentAttachments = [];

function save() {
  chatService.syncFromUi(chats, currentChat);
}

/* ==========================================================================
   UTILITY FUNCTIONS
   ========================================================================== */
function showToast(message) {
  const toast = document.createElement('div');
  toast.className   = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    button.classList.add('copied');
    showToast('Copied to clipboard!');
    setTimeout(() => button.classList.remove('copied'), 2000);
  }).catch(() => {
    showToast('Failed to copy');
  });
}

function extractPlainText(html) {
  return html.replace(/\[📎 Attached: (.*?)\]/g, '').trim();
}

/* ==========================================================================
   UI INTERACTIONS
   ========================================================================== */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  sendBtn.disabled = textarea.value.trim() === '' && currentAttachments.length === 0;
}

function handleEnter(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) send();
  }
}

function showContextMenu(e, id) {
  e.preventDefault();
  e.stopImmediatePropagation();
  currentContextId = id;
  contextMenu.classList.add('show');
  let x = e.pageX + 10;
  let y = e.pageY + 10;
  const rect = contextMenu.getBoundingClientRect();
  if (x + rect.width  > window.innerWidth)  x = window.innerWidth  - rect.width  - 10;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 10;
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top  = `${y}px`;
}

function hideContextMenu() {
  contextMenu.classList.remove('show');
}

document.addEventListener('click',  hideContextMenu);
document.addEventListener('scroll', hideContextMenu, true);

/* ==========================================================================
   CHAT RENDERING
   ========================================================================== */
async function newChat() {
  await chatService.create({});
  refreshFromService();
  loadChat();
  if (window.innerWidth < 768) toggleSidebar();
}

function loadChat() {
  messagesEl.innerHTML = '';
  const msgs = chats[currentChat] || [];
  if (msgs.length === 0) {
    messagesEl.innerHTML = `
      <div class="empty-state">
        <h1>What do you want to learn?</h1>
        <p style="color: var(--text-secondary); font-size: 18px;">Type a prompt below to get started.</p>
      </div>`;
  } else {
    msgs.forEach((msg) => appendMessageHTML(msg.content, msg.role));
  }
  renderHistory();
  scrollToBottom();
}

function renderHistory() {
  historyList.innerHTML = '';
  const sorted = Object.entries(chats).sort((a, b) => Number(b[0]) - Number(a[0]));
  sorted.slice(0, 20).forEach(([id, msgs]) => {
    if (msgs.length === 0 && id !== currentChat) return;
    const div = document.createElement('div');
    div.className = `chat-item ${id === currentChat ? 'active' : ''}`;
    let preview = 'New Chat';
    if (msgs.length > 0) {
      const firstUserMsg = msgs.find((m) => m.role === 'user');
      if (firstUserMsg) preview = firstUserMsg.content.replace(/\[📎 Attached:.*?\]/g, '').trim();
    }
    div.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <div class="chat-item-text">${preview}</div>
      <div class="menu-btn" onclick="showContextMenu(event, '${id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </div>`;
    div.onclick = (e) => {
      if (!e.target.closest('.menu-btn')) {
        currentChat = id;
        save();
        loadChat();
      }
    };
    historyList.appendChild(div);
  });
}

function appendMessageHTML(text, role) {
  const emptyState = messagesEl.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const row       = document.createElement('div');
  row.className   = `msg-row ${role === 'assistant' ? 'ai' : role}`;
  const container = document.createElement('div');
  container.className = 'msg-container';
  const bubble    = document.createElement('div');
  bubble.className = `msg ${role === 'assistant' ? 'ai' : role}`;

  const plainText = extractPlainText(text);
  let formattedText = text
    .replace(/\[📎 Attached: (.*?)\]/g, '<br><br><span style="font-size:12px; opacity:0.7; background:rgba(150,150,150,0.2); padding: 4px 8px; border-radius:8px;">📎 $1</span>')
    .replace(/\n/g, '<br>');
  bubble.innerHTML = formattedText;

  const copyBtn   = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.title   = 'Copy message';
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
  copyBtn.onclick = () => copyToClipboard(plainText, copyBtn);

  container.appendChild(bubble);
  container.appendChild(copyBtn);
  row.appendChild(container);
  messagesEl.appendChild(row);
}

function scrollToBottom() {
  setTimeout(() => { wrapperEl.scrollTop = wrapperEl.scrollHeight; }, 0);
}

/* ==========================================================================
   CHAT ACTIONS
   ========================================================================== */
async function deleteChat() {
  if (confirm('Permanently delete this chat?')) {
    await chatService.delete(currentContextId);
    refreshFromService();
    loadChat();
  }
  hideContextMenu();
}

function renameChat() {
  const newName = prompt('Rename chat:', '');
  if (newName && newName.trim()) {
    let firstUser = chats[currentContextId] && chats[currentContextId].find((m) => m.role === 'user');
    if (firstUser) {
      firstUser.content = newName.trim() + '\n' + firstUser.content;
    } else {
      if (!chats[currentContextId]) chats[currentContextId] = [];
      chats[currentContextId].push({ role: 'user', content: newName.trim() });
    }
    save();
    renderHistory();
  }
  hideContextMenu();
}

function archiveChat() {
  alert('Archive feature coming in the next update!');
  hideContextMenu();
}

/* ==========================================================================
   ATTACHMENTS
   ========================================================================== */
function triggerFileUpload() {
  document.getElementById('fileInput').click();
}

function handleFiles(files) {
  Array.from(files).forEach((file) => currentAttachments.push(file));
  renderAttachments();
  sendBtn.disabled = false;
}

function renderAttachments() {
  const bar = document.getElementById('attachmentBar');
  bar.innerHTML = '';
  bar.style.display = currentAttachments.length === 0 ? 'none' : 'flex';
  currentAttachments.forEach((file, index) => {
    const div = document.createElement('div');
    div.className = 'attachment-preview';
    div.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
      ${file.name.length > 15 ? file.name.substring(0, 15) + '...' : file.name}
      <button onclick="removeAttachment(${index}); event.preventDefault();">×</button>`;
    bar.appendChild(div);
  });
}

function removeAttachment(index) {
  currentAttachments.splice(index, 1);
  renderAttachments();
  autoResize(input);
}

/* ==========================================================================
   CORE API LOGIC
   ========================================================================== */
async function send() {
  const text = input.value.trim();
  let messageText = text;

  if (currentAttachments.length > 0) {
    const names = currentAttachments.map((f) => f.name).join(', ');
    messageText += `\n\n[📎 Attached: ${names}]`;
  }

  if (!messageText) return;

  appendMessageHTML(messageText, 'user');
  await chatService.appendMessage(currentChat, { role: 'user', content: messageText });
  refreshFromService();
  renderHistory();
  scrollToBottom();

  input.value = '';
  input.style.height = 'auto';
  currentAttachments = [];
  renderAttachments();
  sendBtn.disabled = true;

  const typingRow = document.createElement('div');
  typingRow.className = 'msg-row ai typing-row';
  typingRow.innerHTML = `<div class="msg ai typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  messagesEl.appendChild(typingRow);
  scrollToBottom();

  try {
    const reply = await chatService.sendChatMessage({
      message: messageText,
      history: chats[currentChat].slice(0, -1),
    });
    typingRow.remove();
    appendMessageHTML(reply, 'assistant');
    await chatService.appendMessage(currentChat, { role: 'assistant', content: reply });
    refreshFromService();
  } catch (e) {
    typingRow.remove();
    appendMessageHTML('Error: Could not reach the AI. Check your Vercel logs.', 'ai');
    console.error('Fetch error:', e);
  }

  renderHistory();
  scrollToBottom();
}

// ─── Expose to HTML onclick attributes ──────────────────────────────────────
window.newChat          = newChat;
window.toggleSidebar    = toggleSidebar;
window.autoResize       = autoResize;
window.handleEnter      = handleEnter;
window.send             = send;
window.triggerFileUpload= triggerFileUpload;
window.handleFiles      = handleFiles;
window.removeAttachment = removeAttachment;
window.showContextMenu  = showContextMenu;
window.renameChat       = renameChat;
window.archiveChat      = archiveChat;
window.deleteChat       = deleteChat;

// ─── Start ───────────────────────────────────────────────────────────────────
startSync();
loadChat();

} // end main()

bootstrap();
