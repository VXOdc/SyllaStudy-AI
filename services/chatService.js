
import { supabase } from '../js/supabase-client.js';

const CACHE_KEY = 'syllastudy_chats_cache_v1';
const LEGACY_CHATS = 'vxoChats';
const LEGACY_CURRENT = 'vxoCurrentChat';

function readState() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const legacyChats = localStorage.getItem(LEGACY_CHATS);
    const legacyCurrent = localStorage.getItem(LEGACY_CURRENT);
    if (legacyChats) {
      const chats = JSON.parse(legacyChats);
      const currentChatId = legacyCurrent || Object.keys(chats)[0] || Date.now().toString();
      const state = {
        chats: typeof chats === 'object' && chats ? chats : {},
        currentChatId,
        messageSyncQueue: [],
      };
      if (!state.chats[currentChatId]) state.chats[currentChatId] = [];
      writeState(state);
      localStorage.removeItem(LEGACY_CHATS);
      localStorage.removeItem(LEGACY_CURRENT);
      return state;
    }
  } catch {}
  const id = Date.now().toString();
  return { chats: { [id]: [] }, currentChatId: id, messageSyncQueue: [] };
}

function writeState(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    localStorage.setItem('vxoChats', JSON.stringify(state.chats));
    localStorage.setItem('vxoCurrentChat', state.currentChatId);
  } catch {}
}

async function insertMessageRemote(role, content) {
  if (!supabase || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;
  try {
    const { error } = await supabase.from('messages').insert({
      role,
      content,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  } catch {
    return false;
  }
}

export const chatService = {
  getState() {
    return readState();
  },

  syncFromUi(chats, currentChatId) {
    const prev = readState();
    writeState({
      chats,
      currentChatId,
      messageSyncQueue: prev.messageSyncQueue || [],
    });
  },

  getCurrentChatId() {
    return readState().currentChatId;
  },

  setCurrentChatId(id) {
    const s = readState();
    s.currentChatId = id;
    if (!s.chats[id]) s.chats[id] = [];
    writeState(s);
  },

  async getAll() {
    const s = readState();
    return Object.entries(s.chats).map(([id, messages]) => ({
      id,
      messages: messages || [],
      updatedAt: Number(id) || 0,
    }));
  },

  async create(payload = {}) {
    const id = payload.id || Date.now().toString();
    const s = readState();
    s.chats[id] = payload.messages || [];
    s.currentChatId = id;
    writeState(s);
    return { id, messages: s.chats[id] };
  },

  async update(id, patch = {}) {
    const s = readState();
    if (!s.chats[id]) s.chats[id] = [];
    if (patch.messages) s.chats[id] = patch.messages;
    writeState(s);
    return { id, messages: s.chats[id] };
  },

  async delete(id) {
    const s = readState();
    delete s.chats[id];
    if (s.currentChatId === id) {
      s.currentChatId = Object.keys(s.chats)[0] || Date.now().toString();
      if (!s.chats[s.currentChatId]) s.chats[s.currentChatId] = [];
    }
    writeState(s);
    return true;
  },

  async appendMessage(chatId, msg) {
    const s = readState();
    if (!s.chats[chatId]) s.chats[chatId] = [];
    s.chats[chatId].push(msg);
    writeState(s);

    const ok = await insertMessageRemote(msg.role, msg.content);
    if (!ok) {
      const latest = readState();
      latest.messageSyncQueue = latest.messageSyncQueue || [];
      latest.messageSyncQueue.push({ role: msg.role, content: msg.content });
      writeState(latest);
    }
    return msg;
  },

  async sendChatMessage({ message, history }) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        errMsg = err?.error || errMsg;
      } catch {}
      throw new Error(errMsg);
    }
    const data = await res.json();
    return data.reply || data.result || '';
  },

  async syncPending() {
    if (!supabase || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    const s = readState();
    s.messageSyncQueue = s.messageSyncQueue || [];
    const remaining = [];
    for (const m of s.messageSyncQueue) {
      const ok = await insertMessageRemote(m.role, m.content);
      if (!ok) remaining.push(m);
    }
    s.messageSyncQueue = remaining;
    writeState(s);
  },
};
