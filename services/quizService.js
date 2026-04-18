import { supabase } from '../js/supabase-client.js';
import { getLocalUserId } from '../js/local-user.js';

const CACHE_KEY = 'syllastudy_quizzes_cache_v1';
const LEGACY_KEY = 'syllastudy_quizzes';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const items = JSON.parse(legacy);
      const normalized = Array.isArray(items)
        ? items.map((q) => ({
            ...q,
            pendingSync: false,
          }))
        : [];
      writeCache({ items: normalized, pendingDeleteIds: [] });
      localStorage.removeItem(LEGACY_KEY);
      return { items: normalized, pendingDeleteIds: [] };
    }
  } catch {}
  return { items: [], pendingDeleteIds: [] };
}

function writeCache(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {}
}

function packData(quiz) {
  return {
    title: quiz.title,
    questions: quiz.questions,
    requestedQuestionCount: quiz.requestedQuestionCount,
    bestScore: quiz.bestScore ?? 0,
    createdAt: quiz.createdAt,
  };
}

function rowToQuiz(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return {
    id: row.id,
    title: data.title ?? 'Untitled Quiz',
    questions: data.questions ?? [],
    requestedQuestionCount: data.requestedQuestionCount,
    bestScore: data.bestScore ?? 0,
    createdAt: data.createdAt ?? created,
    pendingSync: false,
  };
}

function quizToRow(quiz) {
  const payload = packData(quiz);
  return {
    id: quiz.id,
    data: payload,
    created_at: new Date(quiz.createdAt || Date.now()).toISOString(),
    user_id: getLocalUserId(),
  };
}

export const quizService = {
  async getAll() {
    const latest = () => {
      const c = readCache();
      return c.items.filter((q) => !c.pendingDeleteIds.includes(q.id));
    };

    if (!supabase) {
      return latest();
    }

    try {
      await this.syncPending();
      const { data, error } = await supabase
        .from('quiz')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const serverItems = (data || []).map(rowToQuiz);
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
    const now = Date.now();
    const quiz = {
      id,
      title: payload.title ?? 'Untitled Quiz',
      questions: payload.questions ?? [],
      requestedQuestionCount: payload.requestedQuestionCount,
      bestScore: payload.bestScore ?? 0,
      createdAt: payload.createdAt ?? now,
      pendingSync: true,
    };

    if (!supabase) {
      const c = readCache();
      c.items.unshift(quiz);
      writeCache(c);
      return quiz;
    }

    try {
      const { data, error } = await supabase.from('quiz').insert(quizToRow(quiz)).select().single();
      if (error) throw error;
      const saved = rowToQuiz(data);
      const c = readCache();
      c.items = [saved, ...c.items.filter((q) => q.id !== id)];
      writeCache(c);
      return saved;
    } catch {
      const c = readCache();
      c.items.unshift(quiz);
      writeCache(c);
      return quiz;
    }
  },

  async update(id, patch = {}) {
    const c = readCache();
    const idx = c.items.findIndex((q) => q.id === id);
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
        .from('quiz')
        .update({ data: packData(next) })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const saved = rowToQuiz(data);
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
    c.items = c.items.filter((q) => q.id !== id);
    writeCache(c);

    if (!supabase) return true;

    try {
      const { error } = await supabase.from('quiz').delete().eq('id', id);
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
        const { error } = await supabase.from('quiz').delete().eq('id', id);
        if (error) throw error;
        c.pendingDeleteIds = c.pendingDeleteIds.filter((x) => x !== id);
        writeCache(c);
      } catch {}
    }

    c = readCache();
    for (const quiz of c.items.filter((q) => q.pendingSync)) {
      try {
        const { data, error } = await supabase
          .from('quiz')
          .upsert(quizToRow(quiz), { onConflict: 'id' })
          .select()
          .single();
        if (error) throw error;
        const saved = rowToQuiz(data);
        saved.pendingSync = false;
        c.items = c.items.map((q) => (q.id === quiz.id ? saved : q));
        writeCache(c);
      } catch {}
    }
  },
};

