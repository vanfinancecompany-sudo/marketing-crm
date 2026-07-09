import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function createDisabledSupabaseClient() {
  const error = {
    message: "Missing Supabase environment variables.",
  };
  const query = {
    select: () => query,
    insert: () => query,
    update: () => query,
    delete: () => query,
    eq: () => query,
    in: () => query,
    gte: () => query,
    order: () => query,
    limit: () => query,
    single: () => Promise.resolve({ data: null, error }),
    then: (resolve) => resolve({ data: null, error }),
  };

  console.warn(error.message);

  return {
    from: () => query,
  };
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createDisabledSupabaseClient();
