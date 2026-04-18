import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Get values from HTML
const supabaseUrl = window.SUPABASE_URL;
const supabaseAnonKey = window.SUPABASE_ANON_KEY;

// Safety check
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase URL or ANON KEY");
}

// Create client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Export (for other JS files later)
export { supabase };

// Expose globally (so YOU can test in console)
window.supabase = supabase;

// Debug (so you KNOW it's loading)
console.log("Supabase loaded:", supabase);
