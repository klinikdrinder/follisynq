import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Publishable (anon-level) key only. Every table is protected by Row Level Security.
// The service-role key is never shipped to the browser.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wyxclgtiwrqyecfwgobf.supabase.co';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_qKZmPg859MzBlQNdaQiNXg_bsOfYEtH';

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fs-auth', detectSessionInUrl: false },
    });
  }
  return client;
}

export const APP_VERSION = '1.0.0';
export const METADATA_SCHEMA_VERSION = 1;
export const DEFAULT_ORG = '6b1f0c7e-0d5a-4b5e-9a51-6c1f1d9e0001';
