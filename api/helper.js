// POST /api/helper  { messages: [{ role: "user" | "assistant", content: string }, ...] }
// The move-in / move-out helper chat for international students.
import { anthropic, requireUser, useQuota, textOf, apiErrorMessage, MODEL } from "./_lib.js";

const SYSTEM = `You are the MacMove move helper, a friendly guide for international university students moving to or away from Hamilton, Ontario, Canada.
Answer in plain, warm, simple English, since many readers are still learning English. Keep answers under 150 words. Use short numbered steps when there are steps.
For study permits, work rules, health insurance, taxes and leases, give general guidance and tell the student to confirm with their university's international student office, canada.ca, or Ontario's Landlord and Tenant Board.
Never invent phone numbers, street addresses, exact prices or office hours. If you are not sure, say so.
When furniture or textbooks are relevant, mention that students can buy, sell or rent them on MacMove in the Marketplace and Textbooks sections.
If a question is not about moving, settling in, or student life in Canada, politely bring the conversation back to that.`;

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = raw
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Ask a question first." });
    }
    if (!(await useQuota(user.id, "helper", 40))) {
      return res.status(429).json({ error: "You've asked a lot of questions this hour. Try again later, or talk to an agent." });
    }

    const message = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages,
    });

    if (message.stop_reason === "refusal") {
      return res.status(200).json({ text: "I can't help with that one. Try asking about moving in or out, or tap “Talk to an agent”." });
    }
    return res.status(200).json({ text: textOf(message) || "Sorry, I don't have an answer for that. Try asking another way." });
  } catch (err) {
    console.error("helper failed", err);
    const [status, msg] = apiErrorMessage(err);
    return res.status(status).json({ error: msg });
  }
}
