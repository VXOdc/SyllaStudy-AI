/**
 * js/pages/chat-page.js  ·  SyllaStudy AI  ·  v3
 * Features: auto-name chats, project folder management (rename/delete),
 * custom modal system (no native dialogs), archive/unarchive, assign to project.
 */

import { chatService } from '/services/chatService.js';
import { startSync   } from '/js/sync.js';
import { Modal       } from '/js/modal.js';

const META_KEY     = 'syllastudy_chat_meta_v1';
const PROJECTS_KEY = 'syllastudy_projects_v1';

const readMeta      = () => { try { return JSON.parse(localStorage.getItem(META_KEY)     || '{}'); } catch { return {}; } };
const writeMeta     = (v) => { try { localStorage.setItem(META_KEY,     JSON.stringify(v)); } catch {} };
const readProjects  = () => { try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '{}'); } catch { return {}; } };
const writeProjects = (v) => { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(v)); } catch {} };
const getMeta = (id)        => readMeta()[id] || { archived: false, projectId: null, name: null, named: false };
const setMeta = (id, patch) => { const m = readMeta(); m[id] = { ...getMeta(id), ...patch }; writeMeta(m); };

async function bootstrap() {
  try { await main(); }
  catch (err) {
    console.error('[chat-page] Fatal:', err);
    const el = document.getElementById('messages');
    if (el) el.innerHTML = `<div class="empty-state" style="color:#f87171;"><p>Chat could not load: ${err.message}</p></div>`;
  }
}

async function main() {
  let chats = {}, currentChat = Date.now().toString(), archiveOpen = false;

  function refreshFromService() { const s = chatService.getState(); chats = s.chats; currentChat = s.currentChatId; }
  refreshFromService();
  if (!chats[currentChat]) { chats[currentChat] = []; chatService.syncFromUi(chats, currentChat); }

  const messagesEl  = document.getElementById('messages');
  const wrapperEl   = document.getElementById('messagesWrapper');
  const inputEl     = document.getElementById('input');
  const sendBtn     = document.getElementById('sendBtn');
  const historyList = document.getElementById('historyList');
  const contextMenu = document.getElementById('contextMenu');
  const projMenu    = document.getElementById('projectContextMenu');
  let contextId = null, projectContextId = null;

  const save = () => chatService.syncFromUi(chats, currentChat);

  /* ── utilities ── */
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => { t.style.animation = 'slideIn .3s ease reverse'; setTimeout(() => t.remove(), 300); }, 2400);
  }
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => { btn.classList.add('copied'); showToast('Copied!'); setTimeout(() => btn.classList.remove('copied'), 2000); }).catch(() => showToast('Copy failed'));
  }
  function chatPreview(id) {
    const meta = getMeta(id);
    if (meta.name) return meta.name;
    const msgs = chats[id] || [];
    const first = msgs.find(m => m.role === 'user');
    return first ? first.content.replace(/\[📎 Attached:.*?\]/g, '').trim() : 'New Chat';
  }

  /* ── FEATURE 1: auto-name ── */
  async function tryAutoName(chatId) {
    const meta = getMeta(chatId);
    if (meta.named || meta.name) return;
    const msgs   = chats[chatId] || [];
    const uMsg   = msgs.find(m => m.role === 'user');
    const aMsg   = msgs.find(m => m.role === 'assistant');
    if (!uMsg || !aMsg) return;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'chat', message:
          `Generate a chat title (3-6 words, no punctuation at end, specific not generic).\nUser: "${uMsg.content.slice(0,200)}"\nAI: "${aMsg.content.slice(0,200)}"\nReply with ONLY the title.`
        }),
      });
      if (!res.ok) return;
      const data  = await res.json();
      const title = (data.reply || '').trim().replace(/^["']|["']$/g,'').slice(0,60);
      if (title && title.length > 2) { setMeta(chatId, { name: title, named: true }); renderHistory(); }
    } catch (_) {}
  }

  /* ── sidebar / input helpers ── */
  function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); }
  function closeMobileSidebar() {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
  }
  function autoResize(el) {
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    sendBtn.disabled = el.value.trim() === '';
  }
  function handleEnter(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) send(); } }

  /* ── context menus ── */
  function showContextMenu(e, id) {
    e.preventDefault(); e.stopImmediatePropagation();
    projMenu?.classList.remove('show');
    contextId = id;
    const lbl = document.getElementById('archiveMenuLabel');
    if (lbl) lbl.textContent = getMeta(id).archived ? 'Unarchive' : 'Archive';
    contextMenu.classList.add('show');
    positionMenu(contextMenu, e.pageX, e.pageY);
  }
  function showProjectMenu(e, pid) {
    e.preventDefault(); e.stopImmediatePropagation();
    contextMenu.classList.remove('show');
    projectContextId = pid;
    projMenu?.classList.add('show');
    positionMenu(projMenu, e.pageX, e.pageY);
  }
  function positionMenu(menu, x, y) {
    menu.style.left = (x+10)+'px'; menu.style.top = (y+10)+'px';
    setTimeout(() => {
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - r.width  - 10) + 'px';
      if (r.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - r.height - 10) + 'px';
    }, 0);
  }
  function hideContextMenu() { contextMenu.classList.remove('show'); projMenu?.classList.remove('show'); }
  document.addEventListener('click',  hideContextMenu);
  document.addEventListener('scroll', hideContextMenu, true);

  /* ── FEATURE 2: project folder management ── */
  async function renameProject() {
    hideContextMenu();
    const projects = readProjects();
    const proj     = projects[projectContextId];
    if (!proj) return;
    const name = await Modal.prompt({ title: 'Rename Project', placeholder: 'Project name', defaultValue: proj.name, confirmText: 'Rename' });
    if (!name) return;
    projects[projectContextId].name = name;
    writeProjects(projects);
    showToast('✏️ Project renamed');
    renderHistory();
  }

  async function deleteProject() {
    hideContextMenu();
    const projects = readProjects();
    const proj     = projects[projectContextId];
    if (!proj) return;
    const meta    = readMeta();
    const hasMsgs = Object.values(meta).some(m => m.projectId === projectContextId);
    const ok = await Modal.confirm({
      title: `Delete "${proj.name}"?`,
      description: hasMsgs
        ? 'Chats inside this project will be moved back to Recent Chats. This cannot be undone.'
        : 'This project folder will be permanently removed.',
      confirmText: 'Delete Project',
      destructive: true,
    });
    if (!ok) return;
    Object.keys(meta).forEach(cid => { if (meta[cid].projectId === projectContextId) meta[cid].projectId = null; });
    writeMeta(meta);
    delete projects[projectContextId];
    writeProjects(projects);
    showToast('🗑️ Project deleted');
    renderHistory();
  }

  /* ── sidebar render ── */
  async function newChat() {
    await chatService.create({});
    refreshFromService(); loadChat();
    if (window.innerWidth < 768) closeMobileSidebar();
  }

  function loadChat() {
    messagesEl.innerHTML = '';
    const msgs = chats[currentChat] || [];
    if (msgs.length === 0) {
      messagesEl.innerHTML = `<div class="empty-state">
        <h1>What do you want to learn?</h1>
        <p style="color:var(--text-secondary);font-size:18px;">Type a prompt below to get started.</p></div>`;
    } else {
      msgs.forEach(m => appendMsg(m.content, m.role));
    }
    renderHistory(); scrollBottom();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    const meta = readMeta(), projects = readProjects();
    const active = [], archived = [], byProject = {};

    Object.entries(chats).sort(([a],[b])=>Number(b)-Number(a)).forEach(([id,msgs]) => {
      if (msgs.length === 0 && id !== currentChat) return;
      const m = meta[id] || {};
      if (m.archived) { archived.push(id); return; }
      if (m.projectId && projects[m.projectId]) (byProject[m.projectId] = byProject[m.projectId]||[]).push(id);
      else active.push(id);
    });

    const projKeys = Object.keys(projects);

    /* projects header */
    if (projKeys.length > 0) {
      const ph = document.createElement('div');
      ph.className = 'history-label';
      ph.style.cssText = 'display:flex;align-items:center;padding-right:6px;';
      ph.innerHTML = `<span>Projects</span><button onclick="createProject()" title="New project" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:20px;line-height:1;padding:0 2px;margin-left:auto;">+</button>`;
      historyList.appendChild(ph);

      projKeys.forEach(pid => {
        const proj    = projects[pid];
        const chatIds = byProject[pid] || [];
        const folder  = document.createElement('div');
        folder.style.marginBottom = '2px';

        const fRow = document.createElement('div');
        fRow.className = 'chat-item';
        fRow.style.cssText = 'padding:9px 12px;';
        fRow.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;flex-shrink:0;">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <div class="chat-item-text" style="font-weight:500;">${escHtml(proj.name)}</div>
          <span style="font-size:11px;opacity:.4;margin-left:4px;flex-shrink:0;">${chatIds.length}</span>
          <div class="menu-btn" onclick="showProjectMenu(event,'${pid}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </div>`;

        const inner = document.createElement('div');
        inner.style.cssText = 'display:none;padding-left:10px;';
        chatIds.forEach(id => inner.appendChild(mkChatRow(id)));
        fRow.onclick = (e) => { if (!e.target.closest('.menu-btn')) inner.style.display = inner.style.display==='none'?'block':'none'; };
        folder.appendChild(fRow); folder.appendChild(inner);
        historyList.appendChild(folder);
      });
    }

    /* recent chats */
    const rh = document.createElement('div');
    rh.className = 'history-label';
    rh.style.cssText = 'display:flex;align-items:center;padding-right:6px;';
    rh.innerHTML = `<span>Recent Chats</span>${projKeys.length===0?`<button onclick="createProject()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:11px;opacity:.6;margin-left:auto;">+ Project</button>`:''}`;
    historyList.appendChild(rh);
    active.slice(0,30).forEach(id => historyList.appendChild(mkChatRow(id)));

    /* archived */
    if (archived.length > 0) {
      const ah = document.createElement('div');
      ah.className = 'history-label';
      ah.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;padding-right:10px;user-select:none;margin-top:6px;';
      const ch = document.createElementNS('http://www.w3.org/2000/svg','svg');
      ch.setAttribute('viewBox','0 0 24 24'); ch.setAttribute('width','10'); ch.setAttribute('height','10');
      ch.setAttribute('fill','none'); ch.setAttribute('stroke','currentColor'); ch.setAttribute('stroke-width','2.5');
      ch.style.cssText=`transition:transform .2s;transform:${archiveOpen?'rotate(90deg)':'rotate(0)'}`;
      ch.innerHTML='<polyline points="9 18 15 12 9 6"/>';
      ah.appendChild(ch); ah.appendChild(document.createTextNode(`Archived (${archived.length})`));
      const ai2 = document.createElement('div');
      ai2.style.display = archiveOpen ? 'block' : 'none';
      archived.forEach(id => { const r=mkChatRow(id); r.style.opacity='.55'; ai2.appendChild(r); });
      ah.onclick = () => { archiveOpen=!archiveOpen; ch.style.transform=archiveOpen?'rotate(90deg)':'rotate(0)'; ai2.style.display=archiveOpen?'block':'none'; };
      historyList.appendChild(ah); historyList.appendChild(ai2);
    }
  }

  function mkChatRow(id) {
    const div = document.createElement('div');
    div.className = `chat-item ${id===currentChat?'active':''}`;
    const preview = chatPreview(id);
    div.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <div class="chat-item-text">${escHtml(preview.length>36?preview.slice(0,36)+'…':preview)}</div>
      <div class="menu-btn" onclick="showContextMenu(event,'${id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </div>`;
    div.onclick = (e) => {
      if (!e.target.closest('.menu-btn')) { currentChat=id; save(); loadChat(); if(window.innerWidth<768)closeMobileSidebar(); }
    };
    return div;
  }

  /* ── message rendering ── */
  function appendMsg(text, role) {
    messagesEl.querySelector('.empty-state')?.remove();
    const row=document.createElement('div'); row.className=`msg-row ${role==='assistant'?'ai':role}`;
    const wrap=document.createElement('div'); wrap.className='msg-container';
    const bubble=document.createElement('div'); bubble.className=`msg ${role==='assistant'?'ai':role}`;
    bubble.innerHTML=text.replace(/\[📎 Attached: (.*?)\]/g,'<br><br><span style="font-size:12px;opacity:.7;background:rgba(150,150,150,.2);padding:4px 8px;border-radius:8px;">📎 $1</span>').replace(/\n/g,'<br>');
    const cb=document.createElement('button'); cb.className='copy-btn'; cb.title='Copy';
    cb.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
    cb.onclick=()=>copyText(text.replace(/\[📎 Attached:.*?\]/g,'').trim(),cb);
    wrap.appendChild(bubble); wrap.appendChild(cb); row.appendChild(wrap); messagesEl.appendChild(row);
  }
  function scrollBottom() { setTimeout(()=>{wrapperEl.scrollTop=wrapperEl.scrollHeight;},0); }

  /* ── FEATURE 3: chat actions with custom modals ── */
  async function deleteChat() {
    hideContextMenu();
    const ok = await Modal.confirm({ title:'Delete Chat?', description:'This chat will be permanently removed and cannot be recovered.', confirmText:'Delete', destructive:true });
    if (!ok) return;
    await chatService.delete(contextId);
    const m=readMeta(); delete m[contextId]; writeMeta(m);
    refreshFromService(); loadChat(); showToast('🗑️ Chat deleted');
  }

  async function renameChat() {
    hideContextMenu();
    const cur  = chatPreview(contextId);
    const name = await Modal.prompt({ title:'Rename Chat', placeholder:'Chat title', defaultValue:cur==='New Chat'?'':cur, confirmText:'Rename' });
    if (name) { setMeta(contextId,{name,named:true}); renderHistory(); showToast('✏️ Chat renamed'); }
  }

  function archiveChat() {
    hideContextMenu();
    const was = getMeta(contextId).archived;
    setMeta(contextId,{archived:!was});
    showToast(was?'📬 Chat unarchived':'📦 Chat archived');
    if (!was && contextId===currentChat) { const n=Object.keys(chats).find(id=>!getMeta(id).archived&&id!==contextId); if(n){currentChat=n;save();} }
    renderHistory();
  }

  async function createProject() {
    const name = await Modal.prompt({ title:'New Project', description:'Create a folder to organise related chats.', placeholder:'e.g. Calculus, Thesis Research…', confirmText:'Create' });
    if (!name) return;
    const p=readProjects(); p['proj_'+Date.now()]={name}; writeProjects(p);
    showToast('📁 Project created!'); renderHistory();
  }

  async function assignToProject() {
    hideContextMenu();
    const projects=readProjects(), keys=Object.keys(projects);
    if (keys.length===0) {
      const make=await Modal.confirm({ title:'No Projects Yet', description:"You haven't created any project folders. Create one now?", confirmText:'Create Project' });
      if (make) createProject(); return;
    }
    const named=Object.fromEntries(keys.map(k=>[k,projects[k].name]));
    const cur=getMeta(contextId).projectId;
    const result=await Modal.pickProject({projects:named,currentProjectId:cur});
    if (result===null) return;
    if (result==='remove') { setMeta(contextId,{projectId:null}); showToast('Removed from project'); }
    else { setMeta(contextId,{projectId:result}); showToast(`Moved to "${projects[result].name}"`); }
    renderHistory();
  }

  /* ── send ── */
  async function send() {
    const text=inputEl.value.trim(); if(!text) return;
    appendMsg(text,'user');
    await chatService.appendMessage(currentChat,{role:'user',content:text});
    refreshFromService(); renderHistory(); scrollBottom();
    inputEl.value=''; inputEl.style.height='auto'; sendBtn.disabled=true;

    const typing=document.createElement('div');
    typing.className='msg-row ai';
    typing.innerHTML=`<div class="msg ai typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
    messagesEl.appendChild(typing); scrollBottom();

    try {
      const reply=await chatService.sendChatMessage({message:text,history:chats[currentChat].slice(0,-1)});
      typing.remove(); appendMsg(reply,'assistant');
      await chatService.appendMessage(currentChat,{role:'assistant',content:reply});
      refreshFromService();
      tryAutoName(currentChat);  // non-blocking auto-naming
    } catch(e) {
      typing.remove(); appendMsg('Error: Could not reach the AI. Check your Vercel logs.','ai'); console.error(e);
    }
    renderHistory(); scrollBottom();
  }

  /* ── expose to HTML ── */
  window.newChat          = newChat;
  window.toggleSidebar    = toggleSidebar;
  window.autoResize       = autoResize;
  window.handleEnter      = handleEnter;
  window.send             = send;
  window.showContextMenu  = showContextMenu;
  window.showProjectMenu  = showProjectMenu;
  window.renameChat       = renameChat;
  window.archiveChat      = archiveChat;
  window.deleteChat       = deleteChat;
  window.createProject    = createProject;
  window.assignToProject  = assignToProject;
  window.renameProject    = renameProject;
  window.deleteProject    = deleteProject;

  startSync();
  loadChat();
} // end main()

bootstrap();
