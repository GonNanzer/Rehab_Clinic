// supabase-client.js — Cliente único de Supabase para toda la app
//
// Requiere que el script de supabase-js (CDN) y supabase-config.js se hayan
// cargado antes que este archivo.

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});
