// Gives the browser the public Supabase settings. These two values are safe to share:
// the publishable/anon key only allows what the database's security rules allow.
export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "The site isn't set up yet: SUPABASE_URL and SUPABASE_ANON_KEY are missing in Vercel." });
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ supabaseUrl, supabaseAnonKey });
}
