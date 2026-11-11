// POST /api/scan  { image: base64 JPEG, photoPath: "<user id>/<file>.jpg" }
// Asks Claude to judge the furniture's condition, saves the result as a scan record,
// and returns it. A score of 7/10 or more marks the scan as verified.
import { admin, anthropic, requireUser, useQuota, textOf, apiErrorMessage, MODEL } from "./_lib.js";

const CATEGORIES = ["Sofa", "Chair", "Desk", "Bed", "Table", "Shelf", "Dresser", "Lamp", "Other"];
const AGES = ["Under 1 year", "1–2 years", "2–4 years", "4–7 years", "7+ years"];

const SCAN_SCHEMA = {
  type: "object",
  properties: {
    isFurniture: { type: "boolean" },
    item: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    estimatedAge: { type: "string", enum: AGES },
    score: { type: "integer" },
    condition: { type: "string", enum: ["Excellent", "Good", "Fair", "Poor"] },
    issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["isFurniture", "item", "category", "estimatedAge", "score", "condition", "issues", "summary"],
  additionalProperties: false,
};

const PROMPT = `You are the condition scanner for MacMove, a marketplace where university students buy, sell and rent used furniture.
The image is a photo a seller took of an item they want to list.

Judge only what is visible in the photo:
- isFurniture: false if the photo does not show furniture, or is too dark or blurry to judge.
- item: a short, plain description buyers would search for, like "Grey 3-seat fabric sofa".
- category and estimatedAge: your best estimate from the allowed values.
- score: an integer from 0 to 10 for physical condition, where 10 is like new, 7 is clean and sturdy with light normal wear, 4 is clearly worn or has a noticeable flaw, and 0-2 is broken or unsafe. Use 0 if isFurniture is false.
- condition: Excellent (9-10), Good (7-8), Fair (4-6) or Poor (0-3), matching the score.
- issues: up to 4 short visible problems such as stains, tears, scratches, missing parts or wobbly legs. Empty if none.
- summary: one plain, friendly sentence for the seller explaining the score. If isFurniture is false, say what to retake.`;

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { image, photoPath } = req.body || {};
    if (typeof image !== "string" || image.length < 100 || image.length > 4_000_000) {
      return res.status(400).json({ error: "Send a JPEG photo under about 3 MB." });
    }
    if (photoPath != null && (typeof photoPath !== "string" || !photoPath.startsWith(user.id + "/"))) {
      return res.status(400).json({ error: "That photo doesn't belong to your account." });
    }
    if (!(await useQuota(user.id, "scan", 20))) {
      return res.status(429).json({ error: "You've run 20 scans in the last hour. Try again later." });
    }

    const message = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCAN_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ error: "The scanner couldn't assess this photo. Try another photo or ask an agent." });
    }
    let r;
    try {
      r = JSON.parse(textOf(message));
    } catch {
      return res.status(502).json({ error: "The scanner gave an unreadable answer. Please scan again." });
    }

    const score = r.isFurniture ? Math.max(0, Math.min(10, Math.round(Number(r.score) || 0))) : 0;
    const verified = !!r.isFurniture && score >= 7;
    const row = {
      user_id: user.id,
      photo_path: photoPath || null,
      is_furniture: !!r.isFurniture,
      item: String(r.item || "").slice(0, 120),
      category: CATEGORIES.includes(r.category) ? r.category : "Other",
      estimated_age: AGES.includes(r.estimatedAge) ? r.estimatedAge : null,
      condition: r.condition || null,
      score,
      issues: Array.isArray(r.issues) ? r.issues.slice(0, 4).map((s) => String(s).slice(0, 120)) : [],
      summary: String(r.summary || "").slice(0, 400),
      verified,
      verified_by: verified ? "scan" : null,
    };
    const { data, error } = await admin().from("scans").insert(row).select().single();
    if (error) throw error;
    return res.status(200).json({ scan: data });
  } catch (err) {
    console.error("scan failed", err);
    const [status, msg] = apiErrorMessage(err);
    return res.status(status).json({ error: msg });
  }
}
