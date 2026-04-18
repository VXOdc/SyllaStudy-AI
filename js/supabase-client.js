import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const url = typeof window !== 'undefined' ? window.SUPABASE_URL : '';
const key = typeof window !== 'undefined' ? window.SUPABASE_ANON_KEY : '';

export const supabase =
  url && key ? createClient(url, key, { auth: { persistSession: true } }) : null;

