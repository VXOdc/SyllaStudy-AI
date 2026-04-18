import { notesService } from '../services/notesService.js';
import { tasksService } from '../services/tasksService.js';
import { quizService } from '../services/quizService.js';
import { chatService } from '../services/chatService.js';

let started = false;

async function runAllSync() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
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
    runAllSync();
  });
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    runAllSync();
  }
}

export { runAllSync };
