/**
 * services/supabaseClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central Supabase client for SyllaStudy AI.
 *
 * Priority order for credentials:
 *   1. import.meta.env.VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (Vite build)
 *   2. window.SUPABASE_URL / window.SUPABASE_ANON_KEY              (script-injected)
 *   3. null → falls back to localStorage-only mode (no crash)
 *
 * To add your credentials, either:
 *   A) Set Vercel env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *   B) Add to your HTML before the module scripts:
 *      <script>
 *        window.SUPABASE_URL = 'https://xxxx.supabase.co';
 *        window.SUPABASE_ANON_KEY = 'eyJhbGci...';
 *      </script>
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

function resolveCredentials() {
  // 1. Vite environment variables (injected at build time)
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL;
    const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;
    if (url && key) return { url, key };
  } catch (_) {
    // import.meta.env not available in plain ES module contexts — that's fine
  }

  // 2. Runtime window globals (set via inline <script> in HTML)
  if (typeof window !== 'undefined') {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (url && key) return { url, key };
  }

  return null;
}

let supabase = null;

const creds = resolveCredentials();
if (creds) {
  try {
    supabase = createClient(creds.url, creds.key, {
      auth: { persistSession: true },
    });
    console.info('[SyllaStudy] Supabase client initialized.');
  } catch (err) {
    console.warn('[SyllaStudy] Supabase init failed — running in offline mode.', err);
  }
} else {
  console.info('[SyllaStudy] No Supabase credentials found — running in localStorage-only mode.');
}

export { supabase };
