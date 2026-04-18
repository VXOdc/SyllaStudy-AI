/**
 * js/sync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Background sync coordinator.
 * Runs pending Supabase upserts when the browser comes back online.
 * All imports use absolute /services/ paths — safe for Vercel static deploys.
 */

import { notesService } from '/services/notesService.js';
import { tasksService  } from '/services/tasksService.js';
import { quizService   } from '/services/quizService.js';
import { chatService   } from '/services/chatService.js';

let started = false;

async function runAllSync() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  // Use allSettled so one failing service never blocks the others
  await Promise.allSettled([
    notesService.syncPending?.(),
    tasksService.syncPending?.(),
    quizService.syncPending?.(),
    chatService.syncPending?.(),
  ]);
}

export function startSync() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    runAllSync().catch(() => {});
  });
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    runAllSync().catch(() => {});
  }
}

export { runAllSync };
