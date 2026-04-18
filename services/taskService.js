
import { supabase } from '../js/supabase-client.js';
import { getLocalUserId } from '../js/local-user.js';

const CACHE_KEY = 'syllastudy_tasks_cache_v1';
const LEGACY_KEY = 'syllastudy_tasks_v2';

function encodeTask(t) {
  return JSON.stringify({
    v: 1,
    text: t.text || '',
    completed: !!t.completed,
    time: typeof t.time === 'number' ? t.time : 25,
    energy: t.energy || 'medium',
  });
}

function decodeRow(row) {
  const id = row.id;
  const raw = row.title || '';
  try {
    const o = JSON.parse(raw);
    if (o && o.v === 1) {
      return {
        id,
        text: o.text,
        completed: o.completed,
        time: o.time,
        energy: o.energy,
        pendingSync: false,
      };
    }
  } catch {}
  return {
    id,
    text: raw,
    completed: false,
    time: 25,
    energy: 'medium',
    pendingSync: false,
  };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      const items = Array.isArray(arr)
        ? arr.map((t) => ({
            id: t.id,
            text: t.text || '',
            completed: !!t.completed,
            time: t.time ?? 25,
            energy: t.energy || 'medium',
            pendingSync: false,
          }))
        : [];
      writeCache({ items, pendingDeleteIds: [] });
      localStorage.removeItem(LEGACY_KEY);
      return { items, pendingDeleteIds: [] };
    }
  } catch {}
  return { items: [], pendingDeleteIds: [] };
}

function writeCache(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {}
}

function rowToInsert(task) {
  return {
    id: task.id,
    title: encodeTask(task),
    created_at: new Date().toISOString(),
    user_id: getLocalUserId(),
  };
}

export const tasksService = {
  async getAll() {
    const latest = () => {
      const c = readCache();
      return c.items.filter((t) => !c.pendingDeleteIds.includes(t.id));
    };

    if (!supabase) {
      return latest();
    }

    try {
      await this.syncPending();
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const serverItems = (data || []).map(decodeRow);
      const after = readCache();
      const pendingLocals = after.items.filter(
        (n) => n.pendingSync && !serverItems.some((s) => s.id === n.id)
      );
      const merged = [...pendingLocals, ...serverItems];
      writeCache({ items: merged, pendingDeleteIds: after.pendingDeleteIds });
      return latest();
    } catch {
      return latest();
    }
  },

  async create(payload = {}) {
    const id = payload.id || crypto.randomUUID();
    const task = {
      id,
      text: payload.text ?? '',
      completed: !!payload.completed,
      time: typeof payload.time === 'number' ? payload.time : 25,
      energy: payload.energy || 'medium',
      pendingSync: true,
    };

    if (!supabase) {
      const c = readCache();
      c.items.unshift(task);
      writeCache(c);
      return task;
    }

    try {
      const { data, error } = await supabase.from('tasks').insert(rowToInsert(task)).select().single();
      if (error) throw error;
      const saved = decodeRow(data);
      const c = readCache();
      c.items = [saved, ...c.items.filter((t) => t.id !== id)];
      writeCache(c);
      return saved;
    } catch {
      const c = readCache();
      c.items.unshift(task);
      writeCache(c);
      return task;
    }
  },

  async update(id, patch = {}) {
    const c = readCache();
    const idx = c.items.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const prev = c.items[idx];
    const next = {
      ...prev,
      ...patch,
      id,
      pendingSync: true,
    };

    if (!supabase) {
      c.items[idx] = next;
      writeCache(c);
      return next;
    }

    try {
      const { data, error } = await supabase
        .from('tasks')
        .update({ title: encodeTask(next) })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const saved = decodeRow(data);
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
    c.items = c.items.filter((t) => t.id !== id);
    writeCache(c);

    if (!supabase) return true;

    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
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
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) throw error;
        c.pendingDeleteIds = c.pendingDeleteIds.filter((x) => x !== id);
        writeCache(c);
      } catch {}
    }

    c = readCache();
    for (const task of c.items.filter((t) => t.pendingSync)) {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .upsert(rowToInsert(task), { onConflict: 'id' })
          .select()
          .single();
        if (error) throw error;
        const saved = decodeRow(data);
        saved.pendingSync = false;
        c.items = c.items.map((t) => (t.id === task.id ? saved : t));
        writeCache(c);
      } catch {}
    }
  },
};
