// Cliente de Supabase para el portal de RRPP (/rp).
// Guarda la sesión aparte (otra clave) para no pisar la sesión del CRM si se usa el mismo navegador.
import { createClient } from "@supabase/supabase-js";

export const sbRRPP = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "tixfast-rrpp-auth", detectSessionInUrl: false },
});
