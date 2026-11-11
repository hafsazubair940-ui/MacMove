// Shared helpers for the serverless functions. Files starting with "_" are not routes on Vercel.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const MODEL = "claude-opus-5-5";

let _admin;
export function admin() {
  if (!_admin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}

let _anthropic;
export function anthropic() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Server is missing ANTHROPIC_API_KEY.");
    _anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  }
  return _anthropic;
}

// Returns the signed-in Supabase user for this request, or sends a 401 and returns null.
export async function requireUser(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Please sign in first." });
    return null;
  }
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: "Your sign-in has expired. Please sign in again." });
    return null;
  }
  return data.user;
}

// Simple per-user hourly limit, stored in the api_usage table. Returns true if allowed.
export async function useQuota(userId, kind, maxPerHour) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await admin()
    .from("api_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since);
  if (error) throw error;
  if ((count ?? 0) >= maxPerHour) return false;
  await admin().from("api_usage").insert({ user_id: userId, kind });
  return true;
}

export function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function apiErrorMessage(err) {
  if (err instanceof Anthropic.RateLimitError) return [429, "The AI is busy right now. Try again in a minute."];
  if (err instanceof Anthropic.AuthenticationError) return [500, "The AI key on the server isn't valid. The site owner needs to check ANTHROPIC_API_KEY."];
  if (err instanceof Anthropic.BadRequestError) return [400, "The AI couldn't read that request. Try a different photo."];
  if (err instanceof Anthropic.APIError) return [502, "The AI service had a problem. Try again shortly."];
  return [500, err?.message || "Something went wrong on the server."];
}
