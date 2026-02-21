import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let browserClient: SupabaseClient | null = null;

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return browserClient;
}

export const supabase = getBrowserClient();
