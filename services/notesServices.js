import { supabase } from '../js/supabase-client.js';
import { getLocalUserId } from '../js/local-user.js';

const CACHE_KEY = 'syllastudy_notes_cache_v1';
const LEGACY_KEY = 'syllastudy_notes';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const items = JSON.parse(legacy);
      const migrated = {
        items: Array.isArray(items) ? migrateItems(items) : [],
        pendingDeleteIds: [],
      };
      writeCache(migrated);
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
  } catch {}
  return { items: [], pendingDeleteIds: [] };
}

function migrateItems(oldNotes) {
  return oldNotes.map((n) => ({
    id: n.id,
    title: n.title || '',
    content: n.content || '',
    createdAt: n.createdAt || Date.now(),
    updatedAt: n.updatedAt || n.createdAt || Date.now(),
    pendingSync: false,
  }));
}

function writeCache(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {}
}

function rowToNote(row) {
  const created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return {
    id: row.id,
    title: row.title || '',
    content: row.content || '',
    createdAt: created,
    updatedAt: created,
    pendingSync: false,
  };
}

function noteToRow(note) {
  return {
    id: note.id,
    title: note.title || '',
    content: note.content || '',
    created_at: new Date(note.createdAt || Date.now()).toISOString(),
    user_id: getLocalUserId(),
  };
}

export const notesService = {
  async getAll() {
    const latest = () => {
      const c = readCache();
      return c.items.filter((n) => !c.pendingDeleteIds.includes(n.id));
    };

    if (!supabase) {
      return latest();
    }

    try {
      await this.syncPending();
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const serverItems = (data || []).map(rowToNote);
      const after = readCache();
      const pendingLocals = after.items.filter(
        (n) => n.pendingSync && !serverItems.some((s) => s.id === n.id)
      );
      const merged = [...pendingLocals, ...serverItems].sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      );
      writeCache({ items: merged, pendingDeleteIds: after.pendingDeleteIds });
      return latest();
    } catch {
      return latest();
    }
  },

  async create(payload = {}) {
    const id = payload.id || crypto.randomUUID();
    const now = Date.now();
    const note = {
      id,
      title: payload.title ?? '',
      content: payload.content ?? '',
      createdAt: payload.createdAt ?? now,
      updatedAt: payload.updatedAt ?? now,
      pendingSync: true,
    };

    if (!supabase) {
      const c = readCache();
      c.items.unshift(note);
      writeCache(c);
      return note;
    }

    try {
      const { data, error } = await supabase.from('notes').insert(noteToRow(note)).select().single();
      if (error) throw error;
      const saved = rowToNote(data);
      saved.updatedAt = note.updatedAt;
      const c = readCache();
      c.items = [saved, ...c.items.filter((n) => n.id !== id)];
      writeCache(c);
      return saved;
    } catch {
      const c = readCache();
      c.items.unshift(note);
      writeCache(c);
      return note;
    }
  },

  async update(id, patch = {}) {
    const c = readCache();
    const idx = c.items.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    const prev = c.items[idx];
    const next = {
      ...prev,
      ...patch,
      id,
      updatedAt: patch.updatedAt ?? Date.now(),
      pendingSync: true,
    };

    if (!supabase) {
      c.items[idx] = next;
      writeCache(c);
      return next;
    }

    try {
      const { data, error } = await supabase
        .from('notes')
        .update({ title: next.title, content: next.content })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const saved = rowToNote(data);
      saved.updatedAt = next.updatedAt;
      saved.pendingSync = false;
      c.items[idx] = saved;
      writeCache(c);
      return saved;
    } catch {
      c.items[idx] = next;
      writeCache(c);
      return next;
    }
  },

  async delete(id) {
    const c = readCache();
    if (!c.pendingDeleteIds.includes(id)) c.pendingDeleteIds.push(id);
    c.items = c.items.filter((n) => n.id !== id);
    writeCache(c);

    if (!supabase) return true;

    try {
      const { error } = await supabase.from('notes').delete().eq('id', id);
      if (error) throw error;
      c.pendingDeleteIds = c.pendingDeleteIds.filter((x) => x !== id);
      writeCache(c);
      return true;
    } catch {
      return true;
    }
  },

  async syncPending() {
    if (!supabase || (typeof navigator !== 'undefined' && !navigator.onLine)) return;

    let c = readCache();

    for (const id of [...c.pendingDeleteIds]) {
      try {
        const { error } = await supabase.from('notes').delete().eq('id', id);
        if (error) throw error;
        c.pendingDeleteIds = c.pendingDeleteIds.filter((x) => x !== id);
        writeCache(c);
      } catch {}
    }

    c = readCache();
    for (const note of c.items.filter((n) => n.pendingSync)) {
      try {
        const { data, error } = await supabase
          .from('notes')
          .upsert(noteToRow(note), { onConflict: 'id' })
          .select()
          .single();
        if (error) throw error;
        const saved = rowToNote(data);
        saved.updatedAt = note.updatedAt;
        saved.pendingSync = false;
        c.items = c.items.map((n) => (n.id === note.id ? saved : n));
        writeCache(c);
      } catch {}
    }
  },
};

