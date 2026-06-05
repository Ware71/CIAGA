import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing ${name}`);
  return v.trim();
}

// Only select() is exposed — insert/update/upsert/delete are not callable on this type.
type SelectOnlyQueryBuilder = Pick<
  ReturnType<SupabaseClient["from"]>,
  "select"
>;
type ProductionReaderClient = Omit<SupabaseClient, "from"> & {
  from(relation: string): SelectOnlyQueryBuilder;
};

export function getProductionReaderClient(): ProductionReaderClient {
  const url = requireEnv("PROD_SUPABASE_URL");
  const key = requireEnv("PROD_SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ProductionReaderClient;
}
