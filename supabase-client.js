import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabaseUrl = window.SUPABASE_URL;
const supabaseAnonKey = window.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase URL or ANON KEY");
}

export const supabase = createClient(https://qyqvuukigsbjuhjygrxp.supabase.co, eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5cXZ1dWtpZ3NianVoanlncnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjEzMjAsImV4cCI6MjA5MTkzNzMyMH0.5ivvnQC5f-6Yp62ptBt7jZpK_4c-WIwfPnNkbfh9_4s);


window.supabase = supabase;
