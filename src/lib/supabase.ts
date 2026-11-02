import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const missingVariables = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
].filter((variable): variable is string => Boolean(variable));

if (missingVariables.length > 0) {
  throw new Error(
    `Missing Supabase environment variable(s): ${missingVariables.join(', ')}. Set them in .env.local. Do not use a service_role key in the frontend.`,
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function invokeShare(body: BodyInit): Promise<unknown> {
  const response = await fetch(`${supabaseUrl}/functions/v1/share`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  });

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null &&
      'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Share request failed';
    throw new Error(message);
  }
  return result;
}
