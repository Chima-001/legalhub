// Fill these in with your actual Supabase Project URL + Publishable/anon key
// (from Supabase Settings > API). Safe to expose in frontend code - this is
// the public key, not the secret one.
const SUPABASE_URL = "https://iyeekpmutpugpmarddpa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_OscIJ7GMJ4O-5W-M5DglyQ_EsGarWxD";

const supabaseClient = window.supabase
	? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
	: null;
