// MacMove front end. Plain JavaScript, no build step.
// Data lives in Supabase (sign-in, tables, photo storage, live updates);
// the AI scanner and move helper run in Vercel functions under /api.
(() => {
"use strict";

// ---------------- small helpers ----------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };
const money = (n) => "$" + Number(n || 0).toLocaleString("en-CA");
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

const ICONS = {
  Sofa: '<svg viewBox="0 0 64 40" fill="currentColor"><rect x="8" y="4" width="48" height="16" rx="5"/><rect x="2" y="12" width="12" height="20" rx="5"/><rect x="50" y="12" width="12" height="20" rx="5"/><rect x="10" y="20" width="44" height="12" rx="3"/><rect x="6" y="32" width="4" height="6"/><rect x="54" y="32" width="4" height="6"/></svg>',
  Chair: '<svg viewBox="0 0 40 48" fill="currentColor"><rect x="8" y="2" width="24" height="22" rx="5"/><rect x="5" y="24" width="30" height="8" rx="3"/><rect x="7" y="32" width="4" height="14"/><rect x="29" y="32" width="4" height="14"/></svg>',
  Desk: '<svg viewBox="0 0 64 40" fill="currentColor"><rect x="2" y="6" width="60" height="6" rx="2"/><rect x="6" y="12" width="4" height="26"/><rect x="38" y="12" width="20" height="16" rx="2"/><rect x="54" y="28" width="4" height="10"/></svg>',
  Bed: '<svg viewBox="0 0 64 40" fill="currentColor"><rect x="2" y="4" width="8" height="34" rx="2"/><rect x="10" y="18" width="52" height="12" rx="3"/><rect x="12" y="12" width="14" height="7" rx="3"/><rect x="58" y="30" width="4" height="8"/></svg>',
  Table: '<svg viewBox="0 0 64 40" fill="currentColor"><rect x="2" y="8" width="60" height="6" rx="3"/><rect x="8" y="14" width="4" height="24"/><rect x="52" y="14" width="4" height="24"/></svg>',
  Shelf: '<svg viewBox="0 0 40 48" fill="currentColor"><path d="M4 2h32v44h-4V36H8v10H4z M8 6v8h24V6z M8 18v8h24v-8z" fill-rule="evenodd"/></svg>',
  Dresser: '<svg viewBox="0 0 48 44" fill="currentColor"><path d="M2 2h44v36H2z M6 6v8h36V6z M6 17v8h36v-8z M6 28v7h36v-7z" fill-rule="evenodd"/><rect x="4" y="38" width="4" height="5"/><rect x="40" y="38" width="4" height="5"/></svg>',
  Lamp: '<svg viewBox="0 0 40 48" fill="currentColor"><path d="M10 2h20l6 16H4z"/><rect x="18" y="18" width="4" height="22"/><rect x="10" y="40" width="20" height="5" rx="2"/></svg>',
};
ICONS.Other = ICONS.Table;

// ---------------- state ----------------
const S = {
  sb: null, session: null, uid: null, me: null, isAgent: false,
  listings: [], textbooks: [], threads: [], agentThreads: [],
  filter: "all", q: "", tbFilter: "all", tbQ: "", moveTab: "in",
  checks: store.get("mm.checks") || {}, helperTurns: [], agentTopic: null,
  scan: blankScan(), openThread: null, openAgentThread: null,
  seenAt: store.get("mm.seen") || {}, pendingEmail: null,
};
function blankScan() { return { photo: null, blob: null, smallBlob: null, photoPath: null, result: null, id: null, verified: false, agentThreadId: null, agentVerified: false }; }
const photoUrl = (path) => (path ? S.sb.storage.from("photos").getPublicUrl(path).data.publicUrl : null);

// ---------------- API calls to our serverless functions ----------------
async function api(path, body) {
  const { data } = await S.sb.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await r.json(); } catch {}
  if (!r.ok) throw new Error(json.error || "The server couldn't complete that (" + r.status + ").");
  return json;
}

// ---------------- routing ----------------
const VIEWS = ["start", "scan", "details", "market", "textbooks", "move", "messages", "agent-desk"];
function route() {
  let v = (location.hash || "").slice(1);
  $("#boot").hidden = true;
  if (!S.me) { showLogin(); return; }
  if (!VIEWS.includes(v)) v = "start";
  if (v === "details" && !S.scan.photo && !S.scan.result) v = "scan";
  if (v === "agent-desk" && !S.isAgent) v = "market";
  $("#v-login").hidden = true; $("#app").hidden = false;
  VIEWS.forEach((n) => ($("#v-" + n).hidden = n !== v));
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === v));
  $("#fab-agent").hidden = !(v === "scan" || v === "details");
  ({ start: renderStart, scan: renderScanPanel, details: renderPreview, market: renderMarket, messages: renderMessages, "agent-desk": renderAgentDesk, textbooks: renderTextbooks, move: renderMove })[v]?.();
  window.scrollTo(0, 0);
}
function go(v) { if (location.hash === "#" + v) route(); else location.hash = v; }
function showLogin() {
  $("#app").hidden = true; $("#v-login").hidden = false;
  const pending = store.get("mm.pending");
  if (pending?.email) { S.pendingEmail = pending.email; $("#sent-to").textContent = pending.email; $("#f-login").hidden = true; $("#f-code").hidden = false; }
  else { $("#f-login").hidden = false; $("#f-code").hidden = true; }
}

// ---------------- sign in ----------------
$("#f-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#in-name").value.trim(), mac = $("#in-mac").value.trim().toLowerCase(), email = $("#in-email").value.trim().toLowerCase();
  const err = $("#login-err"); err.hidden = true;
  const problems = [];
  if (name.split(/\s+/).length < 2) problems.push("Enter your first and last name.");
  if (!/^[a-z0-9]{2,12}$/.test(mac)) problems.push("Mac ID should be 2–12 letters or numbers, with no @ part.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push("Enter a valid email address.");
  if (problems.length) { err.textContent = problems.join(" "); err.hidden = false; return; }
  const btn = $("#btn-login"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Sending…';
  const { error } = await S.sb.auth.signInWithOtp({
    email,
    options: { data: { full_name: name, mac_id: mac }, emailRedirectTo: location.origin + "/" },
  });
  btn.disabled = false; btn.textContent = "Email me a sign-in link";
  if (error) {
    err.textContent = /rate|security purposes/i.test(error.message)
      ? "Too many sign-in emails were sent. Wait a few minutes and try again."
      : "We couldn't send the email: " + error.message;
    err.hidden = false; return;
  }
  store.set("mm.pending", { email, name, mac });
  S.pendingEmail = email; $("#sent-to").textContent = email;
  $("#f-login").hidden = true; $("#f-code").hidden = false;
});
$("#f-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("#in-code").value.replace(/\D/g, ""), err = $("#code-err"); err.hidden = true;
  if (code.length < 6) { err.textContent = "Enter the code from the email, or open the link in it."; err.hidden = false; return; }
  const btn = $("#btn-code"); btn.disabled = true;
  const { error } = await S.sb.auth.verifyOtp({ email: S.pendingEmail, token: code, type: "email" });
  btn.disabled = false;
  if (error) { err.textContent = "That code didn't work. It may have expired: send a new link and try again."; err.hidden = false; }
});
$("#btn-restart").onclick = () => { store.del("mm.pending"); $("#f-code").hidden = true; $("#f-login").hidden = false; };
$("#btn-logout").onclick = async () => { await S.sb.auth.signOut(); };

async function loadMe() {
  const [{ data: p }, { data: pv }] = await Promise.all([
    S.sb.from("profiles").select("full_name,is_agent").eq("id", S.uid).maybeSingle(),
    S.sb.from("profile_private").select("mac_id,email").eq("id", S.uid).maybeSingle(),
  ]);
  const pending = store.get("mm.pending") || {};
  const email = (pv?.email || S.session.user.email || "").toLowerCase();
  let name = p?.full_name || "", macId = pv?.mac_id || "";
  // Returning students who signed in with new details: keep their profile up to date.
  if (pending.email === email) {
    if (pending.name && pending.name !== name) { await S.sb.from("profiles").update({ full_name: pending.name }).eq("id", S.uid); name = pending.name; }
    if (pending.mac && pending.mac !== macId) { await S.sb.from("profile_private").update({ mac_id: pending.mac }).eq("id", S.uid); macId = pending.mac; }
    store.del("mm.pending");
  }
  S.isAgent = !!p?.is_agent;
  S.me = { name: name || email.split("@")[0], macId, email, macEmail: email.endsWith("@mcmaster.ca"), idMatch: !!macId && email.split("@")[0] === macId };
  $("#me-av").textContent = initials(S.me.name);
  $("#me-name").textContent = S.me.name.split(" ")[0];
  $("#nav-agent").hidden = !S.isAgent;
}

// ---------------- start / verify ----------------
function renderStart() {
  $("#start-hi").textContent = "Hi " + S.me.name.split(" ")[0] + ", you're checked in.";
  const c = [`<span class="chip ok">✓ Email verified</span>`, `<span class="chip ok">✓ Name: ${esc(S.me.name)}</span>`];
  if (S.me.macId) c.push(`<span class="chip ok">✓ Mac ID: ${esc(S.me.macId)}</span>`);
  c.push(S.me.macEmail ? `<span class="chip ok">✓ McMaster email</span>` : `<span class="chip warn">! Not a @mcmaster.ca email</span>`);
  if (S.me.macEmail) c.push(S.me.idMatch ? `<span class="chip ok">✓ Email matches Mac ID</span>` : `<span class="chip warn">! Email doesn't match Mac ID</span>`);
  $("#checks").innerHTML = c.join("");
}
$("#go-buy").onclick = () => go("market");
$("#go-sell").onclick = () => { resetScan(); S.agentTopic = null; go("scan"); };

// ---------------- scanner ----------------
function resetScan() {
  S.scan = blankScan();
  $("#vf-img").hidden = true; $("#vf-empty").hidden = false; $("#btn-scan").disabled = true; $("#btn-scan").textContent = "Scan condition";
  $("#vf-tag").textContent = "CONDITION SCANNER · READY";
  renderScanPanelIntro();
}
async function shrink(file, max, q) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
    return { dataUrl: c.toDataURL("image/jpeg", q), blob };
  } finally { URL.revokeObjectURL(url); }
}
async function onPhoto(e) {
  const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
  try {
    const small = await shrink(f, 900, 0.75);   // stored with the listing
    const big = await shrink(f, 1400, 0.82);    // sent to the scanner
    S.scan = { ...blankScan(), photo: small.dataUrl, smallBlob: small.blob, blob: big.dataUrl.split(",")[1] };
    $("#vf-img").src = small.dataUrl; $("#vf-img").hidden = false; $("#vf-empty").hidden = true;
    $("#btn-scan").disabled = false; $("#btn-scan").textContent = "Scan condition"; $("#vf-tag").textContent = "PHOTO CAPTURED · TAP SCAN";
    renderScanPanel();
  } catch { toast("That file couldn't be opened as a photo. Try a JPG or PNG."); }
}
$("#cam-in").addEventListener("change", onPhoto);
$("#file-in").addEventListener("change", onPhoto);

async function uploadPhoto(blob) {
  const path = S.uid + "/" + uuid() + ".jpg";
  const { error } = await S.sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error("Photo upload failed: " + error.message);
  return path;
}

$("#btn-scan").onclick = async () => {
  if (!S.scan.blob) return;
  const btn = $("#btn-scan"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Scanning…';
  $("#scanline").hidden = false; $("#vf-tag").textContent = "ANALYSING SURFACES · FRAME · FABRIC";
  $("#scan-panel").innerHTML = `<div class="eyebrow">Scanning</div><h2>Checking condition…</h2><p style="color:var(--muted)">Looking for tears, stains, scratches, wobbly legs and broken parts. This takes about 10–30 seconds.</p>`;
  let failed = null;
  try {
    if (!S.scan.photoPath) S.scan.photoPath = await uploadPhoto(S.scan.smallBlob);
    const { scan } = await api("/api/scan", { image: S.scan.blob, photoPath: S.scan.photoPath });
    S.scan.result = scan; S.scan.id = scan.id; S.scan.verified = !!scan.verified;
  } catch (err) { failed = err.message; }
  $("#scanline").hidden = true; btn.textContent = "Scan again"; btn.disabled = false;
  if (failed) {
    $("#vf-tag").textContent = "SCAN UNAVAILABLE";
    $("#scan-panel").innerHTML = `<div class="eyebrow">Scan didn't finish</div><h2>We couldn't run the automatic scan</h2>
      <p style="color:var(--muted)">${esc(failed)}</p><p style="color:var(--muted)">An agent can review your photo instead.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn gold" data-ask>Ask an agent</button>${S.scan.photoPath ? `<button class="btn ghost" data-unverified>List without verification</button>` : ""}</div>`;
    return;
  }
  $("#vf-tag").textContent = S.scan.verified ? "PASSED · VERIFIED SELLER" : "REVIEW NEEDED";
  renderScanPanel();
  if (!S.scan.verified) setTimeout(() => openAgent(true, null), 600);
};

function scoreColor(s) { return s >= 7 ? "var(--ok)" : s >= 4 ? "var(--warn)" : "var(--bad)"; }
function renderScanPanelIntro() {
  $("#scan-panel").innerHTML = `<div class="eyebrow">How the scan works</div><h2>Get your verified-seller badge</h2>
    <ol class="tips"><li>Take a clear photo of the whole item.</li><li>The scanner checks for tears, stains, scratches and broken parts.</li><li>A score of 7/10 or higher makes you a verified seller for this item.</li><li>Not sure? Tap <b>Ask an agent</b> and a real person will review it.</li></ol>`;
}
function renderScanPanel() {
  const p = $("#scan-panel"), r = S.scan.result;
  if (!r) {
    if (S.scan.photo) p.innerHTML = `<div class="eyebrow">Photo ready</div><h2>Looks good. Tap “Scan condition”.</h2><p style="color:var(--muted)">Want a different angle? Open the camera again to retake.</p>`;
    else renderScanPanelIntro();
    return;
  }
  const v = S.scan.verified || S.scan.agentVerified;
  const kind = v ? "ok" : r.is_furniture && r.score >= 4 ? "warn" : "bad";
  const head = S.scan.agentVerified ? "Verified by an agent" : v ? "You're a verified seller for this item" : !r.is_furniture ? "We couldn't recognise furniture" : "This item needs a closer look";
  const issues = Array.isArray(r.issues) ? r.issues : [];
  p.innerHTML = `
    <div class="eyebrow">Scan result</div>
    <div class="verdict ${kind}"><span style="font-size:26px">${v ? "✓" : kind === "warn" ? "!" : "×"}</span><div><b>${esc(head)}</b><span style="font-size:13px">${esc(r.summary || "")}</span></div></div>
    <div style="display:grid;gap:6px"><div style="display:flex;justify-content:space-between;font-weight:600"><span>Condition score</span><span style="font-variant-numeric:tabular-nums">${r.score}/10</span></div>
    <div class="meter"><i style="width:${r.score * 10}%;background:${scoreColor(r.score)}"></i></div></div>
    <dl class="kv"><dt>Item</dt><dd>${esc(r.item || "Unknown")}</dd><dt>Category</dt><dd>${esc(r.category || "Other")}</dd><dt>Estimated age</dt><dd>${esc(r.estimated_age || "—")}</dd><dt>Condition</dt><dd>${esc(r.condition || "—")}</dd></dl>
    ${issues.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Spotted</div><ul class="issues">${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${v ? `<button class="btn" data-continue>Continue to listing →</button>` : `<button class="btn gold" data-ask>Ask an agent</button>${r.is_furniture ? `<button class="btn ghost" data-unverified>List without verification</button>` : ""}`}
    </div>`;
}
$("#scan-panel").addEventListener("click", (e) => {
  if (e.target.closest("[data-continue]")) { prefillDetails(); go("details"); }
  if (e.target.closest("[data-unverified]")) { prefillDetails(); go("details"); }
  if (e.target.closest("[data-ask]")) openAgent(false, null);
});

// ---------------- agent help (student side) ----------------
$("#fab-agent").onclick = () => openAgent(false, null);
function openAgent(offer, topic) {
  const d = $("#dlg-agent");
  if (topic !== undefined && S.agentTopic !== topic) { S.scan.agentThreadId = null; S.agentTopic = topic; }
  $("#agent-intro").textContent = S.agentTopic
    ? "A MacMove agent (a real person) will answer your question about " + S.agentTopic.toLowerCase() + ". Replies also show up in Messages."
    : offer
      ? "Your item didn't pass the automatic scan. A MacMove agent (a real person) can look at your photo and verify it by hand, or tell you what to fix."
      : "A MacMove agent (a real person) will look at your photo and scan result, answer questions, and can verify your item by hand.";
  if (!d.open) d.showModal();
  renderAgentChat();
}
function agentThread() { return S.threads.find((t) => t.id === S.scan.agentThreadId); }
function renderAgentChat() {
  const box = $("#agent-chat"), t = agentThread();
  box.innerHTML = `<div class="chat-log" id="ag-log">${t && t.messages.length ? t.messages.map((m) => bubble(m, m.from === S.uid && m.role === "user")).join("") : `<div class="bubble sys">Say hi and describe what you need. ${S.agentTopic ? "" : "The agent sees your photo and scan result."}</div>`}</div>
    <form class="chat-input" id="ag-form"><input class="input" id="ag-text" placeholder="Message an agent…" autocomplete="off" maxlength="2000"><button class="btn">Send</button></form>`;
  const log = $("#ag-log"); log.scrollTop = log.scrollHeight;
  $("#ag-form").onsubmit = async (e) => { e.preventDefault(); const txt = $("#ag-text").value.trim(); if (!txt) return; $("#ag-text").value = ""; await sendAgentMsg(txt); };
}
async function sendAgentMsg(text) {
  try {
    if (!S.scan.agentThreadId) {
      const r = S.scan.result;
      const { data, error } = await S.sb.from("threads").insert({
        kind: "agent",
        title: (S.agentTopic ? S.agentTopic : r?.item ? "Review: " + r.item : "Seller needs help").slice(0, 200),
        scan_id: S.agentTopic ? null : S.scan.id,
      }).select("id").single();
      if (error) throw error;
      S.scan.agentThreadId = data.id;
    }
    const { error } = await S.sb.from("messages").insert({ thread_id: S.scan.agentThreadId, body: text, role: "user" });
    if (error) throw error;
    await loadThreads();
  } catch (err) { toast("Message not sent: " + (err.message || "try again")); }
}
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

// ---------------- listing details ----------------
function prefillDetails() {
  const r = S.scan.result;
  if (r) { $("#d-title").value = r.item || ""; if (r.category) $("#d-cat").value = r.category; if (r.estimated_age) $("#d-age").value = r.estimated_age; }
  renderPreview();
}
function mode() { return document.querySelector('input[name="d-mode"]:checked').value; }
function syncMode() { const m = mode(); $("#wrap-sale").hidden = m === "rent"; $("#wrap-rent").hidden = m === "sell"; renderPreview(); }
document.querySelectorAll('input[name="d-mode"]').forEach((r) => r.addEventListener("change", syncMode));
["#d-title", "#d-cat", "#d-age", "#d-price", "#d-rent", "#d-area", "#d-desc"].forEach((s) => $(s).addEventListener("input", renderPreview));
function draftListing() {
  const r = S.scan.result, m = mode();
  return {
    title: $("#d-title").value.trim() || "Your item", category: $("#d-cat").value, age: $("#d-age").value, mode: m,
    price: m !== "rent" ? Number($("#d-price").value) || 0 : null, rent: m !== "sell" ? Number($("#d-rent").value) || 0 : null,
    area: $("#d-area").value, description: $("#d-desc").value.trim(), photo: S.scan.photo || null,
    verified: !!(S.scan.verified || S.scan.agentVerified), verifiedBy: S.scan.agentVerified ? "agent" : S.scan.verified ? "scan" : null,
    score: r?.score ?? null, condition: r?.condition || null, sellerId: S.uid, sellerName: S.me.name, createdAt: Date.now(), status: "active",
  };
}
function renderPreview() { if ($("#v-details").hidden) return; $("#preview").innerHTML = cardHTML({ id: "preview", ...draftListing() }, true); }
$("#f-details").addEventListener("submit", async (e) => {
  e.preventDefault();
  const L = draftListing(), err = $("#details-err"); err.hidden = true;
  const p = []; if (!$("#d-title").value.trim()) p.push("Add a name for the item.");
  if (L.mode !== "rent" && !(L.price > 0)) p.push("Set a sale price."); if (L.mode !== "sell" && !(L.rent > 0)) p.push("Set a monthly rent.");
  if (p.length) { err.textContent = p.join(" "); err.hidden = false; return; }
  const btn = $("#btn-upload"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Uploading…';
  try {
    if (!S.scan.photoPath && S.scan.smallBlob) S.scan.photoPath = await uploadPhoto(S.scan.smallBlob);
    const { error } = await S.sb.from("listings").insert({
      title: L.title, category: L.category, age: L.age, mode: L.mode, price: L.price, rent: L.rent,
      area: L.area, description: L.description || null, photo_path: S.scan.photoPath, scan_id: S.scan.id,
    });
    if (error) throw error;
    toast(L.verified ? "Listed with a verified badge" : "Listed. Buyers will see it as unverified");
    $("#f-details").reset(); syncMode(); resetScan(); S.filter = "all"; await loadListings(); go("market");
  } catch (ex) {
    err.textContent = "Upload failed: " + (ex.message || "check your connection and try again."); err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = "Upload listing"; }
});

// ---------------- marketplace ----------------
function priceHTML(l) {
  const a = []; if (l.price != null) a.push(money(l.price)); if (l.rent != null) a.push(money(l.rent) + "<small>/mo</small>");
  return a.join(" <small>or</small> ");
}
function typeChip(l) { return `<span class="chip plain">${l.mode === "sell" ? "For sale" : l.mode === "rent" ? "For rent" : "Sale or rent"}</span>`; }
function cardHTML(l, isPreview) {
  const tag = isPreview ? "div" : "button";
  return `<${tag} class="card" data-id="${esc(l.id)}">
    <div class="thumb">${l.photo ? `<img src="${esc(l.photo)}" alt="" loading="lazy">` : ICONS[l.category] || ICONS.Other}<span class="badge">${l.verified ? `<span class="chip ok">✓ Verified</span>` : `<span class="chip warn">Unverified</span>`}</span><span class="type">${typeChip(l)}</span></div>
    <div class="body"><div class="price">${priceHTML(l) || "—"}</div><h3>${esc(l.title)}</h3>
    <div class="meta"><span>${esc(l.age || "")}</span>${l.condition ? `<span>· ${esc(l.condition)}${l.score != null ? " " + l.score + "/10" : ""}</span>` : ""}<span>· ${esc(l.area || "")}</span></div>
    <div class="seller"><span class="avatar">${initials(l.sellerName)}</span><span>${esc(l.sellerId === S.uid ? "You" : l.sellerName)}</span><span style="margin-left:auto;color:var(--muted);font-size:12px">${l.status === "sold" ? "Sold" : ago(l.createdAt)}</span></div></div>
  </${tag}>`;
}
function mapListing(r) {
  return {
    id: r.id, title: r.title, category: r.category, age: r.age, mode: r.mode, price: r.price, rent: r.rent, area: r.area,
    description: r.description, photo: photoUrl(r.photo_path), verified: r.verified, verifiedBy: r.verified_by, score: r.score,
    condition: r.condition, sellerId: r.seller_id, sellerName: r.seller?.full_name || "A student", createdAt: Date.parse(r.created_at), status: r.status,
  };
}
async function loadListings() {
  const { data, error } = await S.sb.from("listings").select("*, seller:profiles(full_name)").order("created_at", { ascending: false }).limit(300);
  if (error) { toast("Couldn't load listings: " + error.message); return; }
  S.listings = data.map(mapListing);
  if (!$("#v-market").hidden) renderMarket();
}
function renderMarket() {
  const q = S.q.toLowerCase();
  const list = S.listings.filter((l) => {
    if (S.filter === "verified" && !l.verified) return false;
    if (S.filter === "sale" && l.mode === "rent") return false;
    if (S.filter === "rent" && l.mode === "sell") return false;
    if (S.filter === "mine" && l.sellerId !== S.uid) return false;
    if (q && !(l.title + " " + l.category + " " + l.area + " " + (l.description || "")).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (a.status === "sold") - (b.status === "sold") || b.createdAt - a.createdAt);
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === S.filter));
  $("#grid").innerHTML = list.length ? list.map((l) => cardHTML(l)).join("") :
    `<div class="emptybox" style="grid-column:1/-1"><svg width="70" height="70" viewBox="0 0 120 120"><use href="#logo"/></svg><b style="color:var(--fg);font-size:17px">${S.listings.length ? "Nothing matches that filter" : "No furniture listed yet"}</b><span>${S.listings.length ? "Try a different search or filter." : "Be the first: scan a piece of furniture and list it in about a minute."}</span><a class="btn" href="#scan">Sell an item</a></div>`;
}
$("#q").addEventListener("input", (e) => { S.q = e.target.value; renderMarket(); });
$("#filters").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.filter = b.dataset.f; renderMarket(); });
$("#grid").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) openListing(c.dataset.id); });
$("a[href='#scan'].btn")?.addEventListener("click", () => resetScan());

function openListing(id) {
  const l = S.listings.find((x) => x.id === id); if (!l) return;
  const mine = l.sellerId === S.uid;
  $("#listing-body").innerHTML = `
    <div class="dlg-head"><div style="display:grid;gap:6px"><div style="display:flex;gap:6px;flex-wrap:wrap">${l.verified ? `<span class="chip ok">✓ Verified ${l.verifiedBy === "agent" ? "by an agent" : "by scan"}</span>` : `<span class="chip warn">Unverified seller</span>`}${typeChip(l)}</div><h2 style="font-size:24px">${esc(l.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="thumb" style="border-radius:12px;overflow:hidden">${l.photo ? `<img src="${esc(l.photo)}" alt="">` : ICONS[l.category] || ICONS.Other}</div>
    <div class="price" style="font-size:24px">${priceHTML(l)}</div>
    <dl class="kv"><dt>Category</dt><dd>${esc(l.category)}</dd><dt>Age</dt><dd>${esc(l.age || "—")}</dd><dt>Condition</dt><dd>${esc(l.condition || "Not scanned")}${l.score != null ? ` · ${l.score}/10` : ""}</dd><dt>Pickup</dt><dd>${esc(l.area || "—")}</dd><dt>Seller</dt><dd>${esc(mine ? "You" : l.sellerName)}</dd><dt>Posted</dt><dd>${ago(l.createdAt)}</dd></dl>
    ${l.description ? `<p style="white-space:pre-wrap">${esc(l.description)}</p>` : ""}
    ${!l.verified ? `<p class="notice">This seller hasn't passed the condition scan. Inspect the item in person before you pay.</p>` : ""}
    ${mine ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-sold>${l.status === "sold" ? "Mark as available" : "Mark as sold"}</button><button class="btn ghost" data-del>Delete listing</button></div>`
      : `<form id="buy-form" style="display:grid;gap:8px"><label for="buy-msg" style="font-weight:600;font-size:13px">Message ${esc(l.sellerName.split(" ")[0])}</label><textarea class="input" id="buy-msg" maxlength="2000">Hi! Is the ${esc(l.title)} still available? I'm interested in ${l.mode === "rent" ? "renting" : l.mode === "sell" ? "buying" : "buying or renting"} it.</textarea><button class="btn">Send message</button></form>`}`;
  const d = $("#dlg-listing"); d.showModal();
  d.querySelector("[data-close]").onclick = () => d.close();
  d.querySelector("#buy-form")?.addEventListener("submit", async (e) => { e.preventDefault(); const t = $("#buy-msg").value.trim(); if (!t) return; if (await startThread("listing", l, t)) { d.close(); go("messages"); } });
  d.querySelector("[data-sold]")?.addEventListener("click", async () => { await S.sb.from("listings").update({ status: l.status === "sold" ? "active" : "sold" }).eq("id", l.id); d.close(); loadListings(); });
  d.querySelector("[data-del]")?.addEventListener("click", async (e) => {
    if (e.target.dataset.confirm !== "1") { e.target.dataset.confirm = "1"; e.target.textContent = "Tap again to delete"; return; }
    const { error } = await S.sb.from("listings").delete().eq("id", l.id);
    d.close(); toast(error ? "Couldn't delete: " + error.message : "Listing deleted"); loadListings();
  });
}

// ---------------- textbooks ----------------
function bookPrice(b) { const a = []; if (b.price != null) a.push(money(b.price)); if (b.rent != null) a.push(money(b.rent) + "<small>/term</small>"); return a.join(" <small>or</small> "); }
function bookCard(b) {
  return `<button class="card" data-book="${esc(b.id)}">
    <div class="cover">${b.photo ? `<img src="${esc(b.photo)}" alt="" loading="lazy">` : ""}<span class="badge">${typeChip(b)}</span>${b.photo ? "" : `<span class="code">${esc(b.course || "Course")}</span><span class="ed">${esc(b.edition || "")}</span>`}</div>
    <div class="body"><div class="price">${bookPrice(b) || "—"}</div><h3>${esc(b.title)}</h3>
    <div class="meta"><span>${esc(b.course || "")}</span><span>· ${esc(b.condition)}</span><span>· ${esc(b.area || "")}</span></div>
    <div class="seller"><span class="avatar">${initials(b.sellerName)}</span><span>${esc(b.sellerId === S.uid ? "You" : b.sellerName)}</span><span style="margin-left:auto;color:var(--muted);font-size:12px">${b.status === "sold" ? "Sold" : ago(b.createdAt)}</span></div></div></button>`;
}
function mapBook(r) {
  return { id: r.id, course: r.course, title: r.title, edition: r.edition, condition: r.condition, area: r.area, mode: r.mode, price: r.price, rent: r.rent,
    photo: photoUrl(r.photo_path), sellerId: r.seller_id, sellerName: r.seller?.full_name || "A student", createdAt: Date.parse(r.created_at), status: r.status };
}
async function loadTextbooks() {
  const { data, error } = await S.sb.from("textbooks").select("*, seller:profiles(full_name)").order("created_at", { ascending: false }).limit(300);
  if (error) { toast("Couldn't load textbooks: " + error.message); return; }
  S.textbooks = data.map(mapBook);
  if (!$("#v-textbooks").hidden) renderTextbooks();
}
function renderTextbooks() {
  const q = S.tbQ.toLowerCase().replace(/\s+/g, "");
  const list = S.textbooks.filter((b) => {
    if (S.tbFilter === "sale" && b.mode === "rent") return false;
    if (S.tbFilter === "rent" && b.mode === "sell") return false;
    if (S.tbFilter === "mine" && b.sellerId !== S.uid) return false;
    if (q && !((b.course || "") + (b.title || "") + (b.edition || "")).toLowerCase().replace(/\s+/g, "").includes(q)) return false;
    return true;
  }).sort((a, b) => (a.status === "sold") - (b.status === "sold") || b.createdAt - a.createdAt);
  document.querySelectorAll("#tb-filters button").forEach((x) => x.classList.toggle("on", x.dataset.f === S.tbFilter));
  $("#tb-grid").innerHTML = list.length ? list.map(bookCard).join("") :
    `<div class="emptybox" style="grid-column:1/-1"><b style="color:var(--fg);font-size:17px">${S.textbooks.length ? "No books match that search" : "No textbooks listed yet"}</b><span>${S.textbooks.length ? "Try just the course code, like MATH1ZA3." : "Post a book you've finished with. Renting it out for a term is a quick way to earn back some of what you paid."}</span><button class="btn" data-tbnew>+ Sell a textbook</button></div>`;
}
$("#tb-q").addEventListener("input", (e) => { S.tbQ = e.target.value; renderTextbooks(); });
$("#tb-filters").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.tbFilter = b.dataset.f; renderTextbooks(); });
$("#tb-grid").addEventListener("click", (e) => { if (e.target.closest("[data-tbnew]")) return openTbForm(); const c = e.target.closest("[data-book]"); if (c) openBook(c.dataset.book); });
function tbMode() { return document.querySelector('input[name="tb-mode"]:checked').value; }
document.querySelectorAll('input[name="tb-mode"]').forEach((r) => r.addEventListener("change", () => { const m = tbMode(); $("#tbw-sale").hidden = m === "rent"; $("#tbw-rent").hidden = m === "sell"; }));
function openTbForm() { $("#tb-err").hidden = true; $("#dlg-tb").showModal(); }
$("#tb-new").onclick = openTbForm;
$("#f-tb").addEventListener("submit", async (e) => {
  e.preventDefault();
  const m = tbMode(), err = $("#tb-err"); err.hidden = true;
  const b = {
    course: $("#tb-code").value.trim().toUpperCase().slice(0, 30), title: $("#tb-title").value.trim().slice(0, 160), edition: $("#tb-ed").value.trim() || null,
    condition: $("#tb-cond").value, area: $("#tb-area").value, mode: m,
    price: m !== "rent" ? Number($("#tb-price").value) || 0 : null, rent: m !== "sell" ? Number($("#tb-rent").value) || 0 : null,
  };
  const p = []; if (!b.course) p.push("Add the course code."); if (!b.title) p.push("Add the book title.");
  if (m !== "rent" && !(b.price > 0)) p.push("Set a sale price."); if (m !== "sell" && !(b.rent > 0)) p.push("Set a rent per term.");
  if (p.length) { err.textContent = p.join(" "); err.hidden = false; return; }
  const btn = $("#tb-submit"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Posting…';
  try {
    const f = $("#tb-photo").files?.[0];
    if (f) b.photo_path = await uploadPhoto((await shrink(f, 700, 0.75)).blob);
    const { error } = await S.sb.from("textbooks").insert(b);
    if (error) throw error;
    $("#f-tb").reset(); $("#tbw-sale").hidden = false; $("#tbw-rent").hidden = true; $("#dlg-tb").close(); toast("Textbook posted"); S.tbFilter = "all";
    await loadTextbooks(); go("textbooks");
  } catch (ex) { err.textContent = "Posting failed: " + (ex.message || "check your connection and try again."); err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = "Post textbook"; }
});
function openBook(id) {
  const b = S.textbooks.find((x) => x.id === id); if (!b) return; const mine = b.sellerId === S.uid;
  $("#listing-body").innerHTML = `
    <div class="dlg-head"><div style="display:grid;gap:6px"><div style="display:flex;gap:6px;flex-wrap:wrap">${typeChip(b)}</div><h2 style="font-size:24px">${esc(b.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    ${b.photo ? `<div class="thumb" style="border-radius:12px;overflow:hidden"><img src="${esc(b.photo)}" alt=""></div>` : ""}
    <div class="price" style="font-size:24px">${bookPrice(b)}</div>
    <dl class="kv"><dt>Course</dt><dd>${esc(b.course)}</dd><dt>Edition</dt><dd>${esc(b.edition || "Not given")}</dd><dt>Condition</dt><dd>${esc(b.condition)}</dd><dt>Pickup</dt><dd>${esc(b.area || "—")}</dd><dt>Seller</dt><dd>${esc(mine ? "You" : b.sellerName)}</dd><dt>Posted</dt><dd>${ago(b.createdAt)}</dd></dl>
    <p style="color:var(--muted);font-size:13px">Check the edition your course outline asks for before you pay.</p>
    ${mine ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-sold>${b.status === "sold" ? "Mark as available" : "Mark as sold"}</button><button class="btn ghost" data-del>Delete listing</button></div>`
      : `<form id="buy-form" style="display:grid;gap:8px"><label for="buy-msg" style="font-weight:600;font-size:13px">Message ${esc(b.sellerName.split(" ")[0])}</label><textarea class="input" id="buy-msg" maxlength="2000">Hi! Is your ${esc(b.course)} book (${esc(b.title)}) still available? I'd like to ${b.mode === "rent" ? "rent it for the term" : b.mode === "sell" ? "buy it" : "buy or rent it"}.</textarea><button class="btn">Send message</button></form>`}`;
  const d = $("#dlg-listing"); d.showModal();
  d.querySelector("[data-close]").onclick = () => d.close();
  d.querySelector("#buy-form")?.addEventListener("submit", async (e) => { e.preventDefault(); const t = $("#buy-msg").value.trim(); if (!t) return; if (await startThread("textbook", { ...b, title: b.course + ": " + b.title }, t)) { d.close(); go("messages"); } });
  d.querySelector("[data-sold]")?.addEventListener("click", async () => { await S.sb.from("textbooks").update({ status: b.status === "sold" ? "active" : "sold" }).eq("id", b.id); d.close(); loadTextbooks(); });
  d.querySelector("[data-del]")?.addEventListener("click", async (e) => {
    if (e.target.dataset.confirm !== "1") { e.target.dataset.confirm = "1"; e.target.textContent = "Tap again to delete"; return; }
    const { error } = await S.sb.from("textbooks").delete().eq("id", b.id);
    d.close(); toast(error ? "Couldn't delete: " + error.message : "Listing deleted"); loadTextbooks();
  });
}

// ---------------- move helper ----------------
const MOVE = {
  in: [
    { phase: "Before you fly", when: "1–2 months before", items: [
      ["docs", "Keep your documents in your carry-on", "Study permit approval letter, passport, letter of acceptance and proof of funds. Keep paper copies and photos on your phone."],
      ["housing", "Sort out your first place to stay", "Confirm your lease or book temporary housing before you land. Don't send a deposit for a place you can't verify. Ask to video-call a viewing."],
      ["cash", "Bring some Canadian dollars", "Enough for a few days of food, transit and a SIM card before your bank account is open."],
      ["winter", "Plan for winter", "Hamilton winters can drop below −15 °C. Buy your coat and boots here: second-hand is cheaper and suited to the weather."]] },
    { phase: "First week", when: "After you land", items: [
      ["sim", "Get a Canadian phone plan", "Prepaid SIMs work right away. Compare student plans before signing a 2-year contract."],
      ["sin", "Apply for your SIN", "A Social Insurance Number from Service Canada is needed to work on or off campus. Bring your passport and study permit."],
      ["bank", "Open a bank account", "Most banks have newcomer or student packages with no monthly fee. Bring your passport and study permit."],
      ["health", "Check your health insurance", "Make sure you're enrolled in your school's international student health plan (UHIP for Ontario universities) and save your card."],
      ["bus", "Set up your bus pass", "Find out how your student HSR bus pass works and load it onto your card."],
      ["intl", "Visit the international student office", "They run orientation, help with immigration questions and know the local tricks."]] },
    { phase: "Set up your home", when: "First 2 weeks", items: [
      ["furnish", "Furnish your room on MacMove", "Renting a bed, desk and chair for the term is cheaper than buying new, and you won't have to sell them when you leave.", "#market", "Browse furniture →"],
      ["tenant", "Get tenant insurance", "Covers your belongings and liability. Often around $15–25 a month, and some landlords require it."],
      ["utils", "Set up internet and hydro", "Check your lease: rent sometimes includes utilities. If not, set up electricity and internet in your name."],
      ["rights", "Know your rights as a tenant", "Ontario uses a Standard Lease. A landlord can ask for a last month's rent deposit, but not a damage deposit."]] },
    { phase: "Get ready for class", when: "Before term starts", items: [
      ["books", "Find your textbooks", "Search by course code. Renting for the term costs a lot less than buying new.", "#textbooks", "Find textbooks →"]] },
  ],
  out: [
    { phase: "2–3 months before", when: "Plan ahead", items: [
      ["notice", "Give notice to your landlord", "In Ontario a monthly tenant must give at least 60 days' written notice (usually Form N9), ending on the last day of a rental period. Check your lease if it's a fixed term."],
      ["permit", "Check your permit plans", "Staying to work after you graduate? Look up post-graduation work permit timing before you leave Canada."]] },
    { phase: "4–6 weeks before", when: "Start selling", items: [
      ["sellfurn", "List your furniture on MacMove", "Posting early gets more buyers. Scan it to get a verified badge, or rent it to an incoming student.", "#scan", "Scan & list furniture →"],
      ["sellbooks", "Sell or rent out your textbooks", "Incoming students search by course code.", "#textbooks", "Post a textbook →"],
      ["ship", "Book shipping or extra baggage", "Shipping boxes home by sea is slow but cheap. Airline extra bags are faster for a few boxes."]] },
    { phase: "Last 2 weeks", when: "Wrap up", items: [
      ["cancel", "Cancel or transfer utilities and internet", "Give your providers your move-out date so you're not billed after you leave."],
      ["mail", "Forward your mail", "Set up Canada Post mail forwarding or give a friend's address for tax slips and refunds."],
      ["bankout", "Decide what to do with your bank account", "Keeping it open for a while makes receiving your deposit and tax refunds easier."],
      ["returns", "Return library books and borrowed items", "Unpaid fines can hold up your transcript."]] },
    { phase: "Moving day", when: "", items: [
      ["clean", "Clean and do a walk-through", "Take dated photos of every room so you can show the condition you left it in."],
      ["keys", "Return your keys", "Confirm how your last month's rent deposit is being applied."],
      ["donate", "Donate what didn't sell", "Charity shops and student free-stores take clean furniture and kitchenware."]] },
    { phase: "After you leave", when: "Next spring", items: [
      ["tax", "File your Canadian tax return", "If you worked in Canada, file for the year you left. You may get a refund or benefit payments."]] },
  ],
};
function renderMove() {
  document.querySelectorAll("#mv-tabs button").forEach((b) => { const on = b.dataset.mt === S.moveTab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  let total = 0, done = 0;
  $("#mv-list").innerHTML = MOVE[S.moveTab].map((ph) => `<div class="phase"><h3>${esc(ph.phase)}${ph.when ? `<span>${esc(ph.when)}</span>` : ""}</h3>${ph.items.map(([id, title, detail, href, link]) => {
    const key = S.moveTab + "." + id, on = !!S.checks[key]; total++; if (on) done++;
    return `<label class="check ${on ? "done" : ""}"><input type="checkbox" data-ck="${key}" ${on ? "checked" : ""}><div><b>${esc(title)}</b><small>${esc(detail)}</small>${href ? `<a href="${href}">${esc(link)}</a>` : ""}</div></label>`;
  }).join("")}</div>`).join("");
  $("#mv-count").textContent = done + " of " + total + " done";
  $("#mv-bar").style.width = (total ? (done / total) * 100 : 0) + "%";
}
$("#mv-tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.moveTab = b.dataset.mt; renderMove(); });
const saveChecks = debounce(async () => {
  const { error } = await S.sb.from("move_progress").upsert({ user_id: S.uid, checks: S.checks, updated_at: new Date().toISOString() });
  $("#mv-saved").textContent = error ? "Saved in this browser only" : "Saved to your account";
}, 800);
$("#mv-list").addEventListener("change", (e) => {
  const k = e.target.dataset.ck; if (!k) return;
  if (e.target.checked) S.checks[k] = true; else delete S.checks[k];
  store.set("mm.checks", S.checks); renderMove(); saveChecks();
});
$("#mv-list").addEventListener("click", (e) => { const a = e.target.closest("a[href^='#']"); if (a && a.getAttribute("href") === "#scan") resetScan(); });
async function loadMoveProgress() {
  const { data } = await S.sb.from("move_progress").select("checks").eq("user_id", S.uid).maybeSingle();
  if (data?.checks) { S.checks = { ...S.checks, ...data.checks }; store.set("mm.checks", S.checks); }
}

function hpBubble(text, mine) { const d = document.createElement("div"); d.className = "bubble " + (mine ? "mine" : "them"); d.style.whiteSpace = "pre-wrap"; d.textContent = text; $("#hp-log").appendChild(d); $("#hp-log").scrollTop = 1e9; return d; }
async function askHelper(q) {
  q = q.trim(); if (!q) return;
  hpBubble(q, true); const out = hpBubble("Thinking…", false);
  const send = $("#hp-send"); send.disabled = true;
  S.helperTurns.push({ role: "user", content: q });
  try {
    const { text } = await api("/api/helper", { messages: S.helperTurns.slice(-12) });
    out.textContent = text; S.helperTurns.push({ role: "assistant", content: text });
  } catch (e) {
    S.helperTurns.pop();
    out.textContent = (e.message || "Something went wrong.") + " You can also tap “Talk to an agent”.";
  } finally { send.disabled = false; }
}
$("#hp-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#hp-text").value; $("#hp-text").value = ""; askHelper(v); });
$("#hp-sugg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) askHelper(b.textContent); });
$("#hp-agent").onclick = () => openAgent(false, "Moving help");

// ---------------- messages ----------------
async function startThread(itemType, item, text) {
  try {
    let t = S.threads.find((x) => x.kind === "listing" && x.itemId === item.id && x.starterId === S.uid);
    if (!t) {
      const { data, error } = await S.sb.from("threads").insert({
        kind: "listing", item_type: itemType, item_id: item.id, title: String(item.title).slice(0, 200), other_id: item.sellerId,
      }).select("id").single();
      if (error) throw error;
      t = { id: data.id };
    }
    const { error } = await S.sb.from("messages").insert({ thread_id: t.id, body: text, role: "user" });
    if (error) throw error;
    S.openThread = t.id; await loadThreads(); return true;
  } catch (err) { toast("Message not sent: " + (err.message || "try again")); return false; }
}
function mapThread(r, msgs, scans) {
  const names = { [r.starter_id]: r.starter?.full_name || "A student" };
  if (r.other_id) names[r.other_id] = r.other?.full_name || "A student";
  const sc = r.scan_id ? scans[r.scan_id] : null;
  return {
    id: r.id, kind: r.kind, itemId: r.item_id, title: r.title, starterId: r.starter_id, otherId: r.other_id, scanId: r.scan_id, verdict: r.verdict,
    updatedAt: Date.parse(r.updated_at), names, scan: sc, photo: sc ? photoUrl(sc.photo_path) : null,
    messages: (msgs[r.id] || []).map((m) => ({ from: m.sender_id, role: m.role, text: m.body, at: Date.parse(m.created_at) })),
  };
}
async function fetchThreads(query) {
  const { data: rows, error } = await query;
  if (error) { console.warn(error); return []; }
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { data: msgs } = await S.sb.from("messages").select("thread_id,sender_id,role,body,created_at").in("thread_id", ids).order("created_at").limit(2000);
  const byThread = {}; (msgs || []).forEach((m) => (byThread[m.thread_id] ||= []).push(m));
  const scanIds = rows.map((r) => r.scan_id).filter(Boolean);
  const scans = {};
  if (scanIds.length) { const { data } = await S.sb.from("scans").select("*").in("id", scanIds); (data || []).forEach((s) => (scans[s.id] = s)); }
  return rows.map((r) => mapThread(r, byThread, scans));
}
const THREAD_COLS = "*, starter:profiles!threads_starter_id_fkey(full_name), other:profiles!threads_other_id_fkey(full_name)";
async function loadThreads() {
  S.threads = await fetchThreads(S.sb.from("threads").select(THREAD_COLS).or(`starter_id.eq.${S.uid},other_id.eq.${S.uid}`).order("updated_at", { ascending: false }).limit(100));
  if (S.isAgent) S.agentThreads = await fetchThreads(S.sb.from("threads").select(THREAD_COLS).eq("kind", "agent").order("updated_at", { ascending: false }).limit(100));
  onThreadsChanged();
}
const reloadThreads = debounce(loadThreads, 300);

function bubble(m, mine) {
  if (m.role === "system") return `<div class="bubble sys">${esc(m.text)}</div>`;
  return `<div class="bubble ${mine ? "mine" : "them"}">${esc(m.text)}<small>${ago(m.at)}</small></div>`;
}
function otherName(t) { if (t.kind === "agent") return "MacMove agent"; const o = t.starterId === S.uid ? t.otherId : t.starterId; return t.names[o] || "A student"; }
function unread(t) { const last = t.messages[t.messages.length - 1]; return last && !(last.from === S.uid && last.role === "user") && (S.seenAt[t.id] || 0) < last.at; }
function renderMessages() {
  const ts = S.threads;
  if (!S.openThread && ts[0]) S.openThread = ts[0].id;
  $("#threads").innerHTML = ts.length ? ts.map((t) => { const last = t.messages[t.messages.length - 1];
    return `<button data-t="${esc(t.id)}" class="${t.id === S.openThread ? "on" : ""}"><span style="display:flex;justify-content:space-between;gap:8px"><b>${esc(otherName(t))}</b>${unread(t) ? `<span class="chip warn">New</span>` : ""}</span><small>${esc(t.title)}</small><small>${esc(last?.text || "")}</small></button>`; }).join("")
    : `<div style="padding:18px;color:var(--muted);font-size:14px">No conversations yet. Open a listing and message the seller to start one.</div>`;
  const t = ts.find((x) => x.id === S.openThread);
  if (!t) { $("#chat").innerHTML = `<div class="emptybox" style="margin:18px">Pick a conversation, or browse the <a href="#market" style="color:var(--maroon);font-weight:700">marketplace</a>.</div>`; return; }
  S.seenAt[t.id] = Date.now(); store.set("mm.seen", S.seenAt); paintDot();
  $("#chat").innerHTML = `<div class="chat-head"><div><b>${esc(otherName(t))}</b><div style="font-size:12.5px;color:var(--muted)">${esc(t.title)}</div></div>${t.kind === "agent" && t.verdict ? `<span class="chip ${t.verdict === "verified" ? "ok" : "bad"}">${t.verdict === "verified" ? "✓ Agent verified" : "Not verified"}</span>` : ""}</div>
    <div class="chat-log" id="log">${t.messages.map((m) => bubble(m, m.from === S.uid && m.role === "user")).join("")}</div>
    <form class="chat-input" id="send"><input class="input" id="send-text" placeholder="Write a message…" autocomplete="off" maxlength="2000"><button class="btn">Send</button></form>`;
  const log = $("#log"); log.scrollTop = log.scrollHeight;
  $("#send").onsubmit = async (e) => { e.preventDefault(); const txt = $("#send-text").value.trim(); if (!txt) return; $("#send-text").value = "";
    const { error } = await S.sb.from("messages").insert({ thread_id: t.id, body: txt, role: "user" });
    if (error) toast("Message not sent: " + error.message); else loadThreads(); };
}
$("#threads").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { S.openThread = b.dataset.t; renderMessages(); } });
function paintDot() { $("#msg-dot").hidden = !S.threads.some(unread); }

// ---------------- agent desk ----------------
function renderAgentDesk() {
  const ts = S.agentThreads;
  if (!S.openAgentThread && ts[0]) S.openAgentThread = ts[0].id;
  $("#a-threads").innerHTML = ts.length ? ts.map((t) => { const last = t.messages[t.messages.length - 1];
    return `<button data-t="${esc(t.id)}" class="${t.id === S.openAgentThread ? "on" : ""}"><span style="display:flex;justify-content:space-between;gap:8px"><b>${esc(t.names[t.starterId] || "Student")}</b>${t.verdict ? `<span class="chip ${t.verdict === "verified" ? "ok" : "bad"}">${t.verdict}</span>` : `<span class="chip warn">Waiting</span>`}</span><small>${esc(t.title)}</small><small>${esc(last?.text || "")}</small></button>`; }).join("")
    : `<div style="padding:18px;color:var(--muted);font-size:14px">No help requests yet. They appear here when a student taps “Ask an agent”.</div>`;
  const t = ts.find((x) => x.id === S.openAgentThread);
  if (!t) { $("#a-chat").innerHTML = `<div class="emptybox" style="margin:18px">Nothing to review right now.</div>`; return; }
  const sc = t.scan;
  $("#a-chat").innerHTML = `<div class="chat-head"><div><b>${esc(t.names[t.starterId] || "Student")}</b><div style="font-size:12.5px;color:var(--muted)">${esc(t.title)}${sc ? ` · scan ${sc.score}/10 ${esc(sc.condition || "")}` : ""}</div></div>
    ${t.scanId ? `<div style="display:flex;gap:6px"><button class="btn sm" data-v="verified">Verify item</button><button class="btn ghost sm" data-v="rejected">Not verified</button></div>` : ""}</div>
    <div class="chat-log" id="a-log">${t.photo ? `<div class="bubble them"><img src="${esc(t.photo)}" alt="Student's photo">Student's photo${sc?.issues?.length ? "<br>Scanner flagged: " + esc(sc.issues.join(", ")) : ""}</div>` : ""}${t.messages.map((m) => bubble(m, m.role === "agent")).join("")}</div>
    <form class="chat-input" id="a-send"><input class="input" id="a-text" placeholder="Reply as MacMove agent…" autocomplete="off" maxlength="2000"><button class="btn">Send</button></form>`;
  const log = $("#a-log"); log.scrollTop = log.scrollHeight;
  $("#a-send").onsubmit = async (e) => { e.preventDefault(); const txt = $("#a-text").value.trim(); if (!txt) return; $("#a-text").value = "";
    const { error } = await S.sb.from("messages").insert({ thread_id: t.id, body: txt, role: "agent" });
    if (error) toast("Reply not sent: " + error.message); else loadThreads(); };
  $("#a-chat").querySelectorAll("[data-v]").forEach((b) => (b.onclick = async () => {
    const { error } = await S.sb.rpc("agent_verdict", { p_thread: t.id, p_verdict: b.dataset.v });
    if (error) toast("Couldn't save: " + error.message); else { toast(b.dataset.v === "verified" ? "Item verified" : "Marked not verified"); loadThreads(); loadListings(); }
  }));
}
$("#a-threads").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { S.openAgentThread = b.dataset.t; renderAgentDesk(); } });

function onThreadsChanged() {
  paintDot();
  const at = agentThread();
  if (at && at.verdict === "verified" && !S.scan.agentVerified) { S.scan.agentVerified = true; toast("An agent verified your item"); if (!$("#v-scan").hidden) renderScanPanel(); }
  if ($("#dlg-agent").open) renderAgentChat();
  if (!$("#v-messages").hidden) renderMessages();
  if (!$("#v-agent-desk").hidden) renderAgentDesk();
}

// ---------------- live updates ----------------
let channel;
function subscribe() {
  channel?.unsubscribe();
  channel = S.sb.channel("macmove-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, debounce(loadListings, 400))
    .on("postgres_changes", { event: "*", schema: "public", table: "textbooks" }, debounce(loadTextbooks, 400))
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => reloadThreads())
    .on("postgres_changes", { event: "*", schema: "public", table: "threads" }, () => reloadThreads())
    .subscribe();
}

// ---------------- boot ----------------
async function onSignedIn(session) {
  S.session = session; S.uid = session.user.id;
  $("#boot-msg").textContent = "Signing you in…";
  await loadMe();
  route();
  await Promise.all([loadListings(), loadTextbooks(), loadThreads(), loadMoveProgress()]);
  subscribe();
  route();
}
async function boot() {
  let cfg;
  try {
    const r = await fetch("/api/config"); cfg = await r.json();
    if (!r.ok) throw new Error(cfg.error);
  } catch (e) {
    $("#boot-msg").textContent = "MacMove isn't set up yet: " + (e.message || "the server settings are missing.");
    return;
  }
  S.sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  window.addEventListener("hashchange", route);
  const { data } = await S.sb.auth.getSession();
  S.sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session && session.user.id !== S.uid) onSignedIn(session);
    if (event === "SIGNED_OUT") { S.me = null; S.uid = null; S.session = null; channel?.unsubscribe(); store.del("mm.checks"); location.hash = ""; showLogin(); }
  });
  if (data.session) await onSignedIn(data.session);
  else route();
}
boot();
})();
