"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

loadEnvFile();

const port = Number(process.env.PORT || 3000);
const configuredKey = process.env.GEMINI_API_KEY;
const apiKey = configuredKey && !/^your_gemini_api_key_here$/i.test(configuredKey.trim()) ? configuredKey : "";
const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const pagePath = path.join(__dirname, "todo.html");
const feedbackPath = path.join(__dirname, "feedback.xlsx");
const MAX_MESSAGE_LENGTH = 2000;
const MAX_MESSAGES = 12;

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 50000) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch { reject(new Error("Invalid JSON request.")); }
    });
    req.on("error", reject);
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error("Send between 1 and 12 messages.");
  }
  return messages.map(message => {
    if (!message || !["user", "model"].includes(message.role) || typeof message.text !== "string") {
      throw new Error("Each message needs a role and text.");
    }
    const text = message.text.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) throw new Error("Messages must be 1-2000 characters.");
    return { role: message.role, parts: [{ text }] };
  });
}

async function askGemini(messages) {
  if (!apiKey) {
    const error = new Error("Gemini is not configured. Add GEMINI_API_KEY to .env, then restart the server.");
    error.status = 503;
    throw error;
  }
  const conversation = messages.map(message => `${message.role === "user" ? "User" : "Flow"}: ${message.parts[0].text}`).join("\n\n");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, "Api-Revision": "2026-05-20" },
    body: JSON.stringify({
      model,
      input: "You are Flow, TaskFlow's concise productivity assistant. Help users turn goals into practical next actions, prioritize work, and plan focus sessions. You may suggest tasks, but never claim to have created or changed them. Keep answers under 180 words. Return plain text only: do not use Markdown, asterisks, hashtags, bullets, emojis, or decorative symbols. Use short paragraphs; use a simple numbered list only when it genuinely improves clarity.\n\nConversation:\n" + conversation
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "Gemini could not complete that request.");
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const text = data?.steps?.flatMap(step => step.content || []).filter(part => part.type === "text").map(part => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response.");
  return text
    .replace(/[*`#]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function saveFeedback({ name, email, rating, comment }) {
  let workbook;
  const sheetName = "Feedback";
  if (fs.existsSync(feedbackPath)) {
    workbook = XLSX.readFile(feedbackPath);
  } else {
    workbook = XLSX.utils.book_new();
    const header = [["Name", "Email", "Rating", "Comment", "Timestamp"]];
    const sheet = XLSX.utils.aoa_to_sheet(header);
    sheet["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 8 }, { wch: 50 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  const sheet = workbook.Sheets[sheetName];
  const row = [name, email, rating, comment, new Date().toISOString()];
  XLSX.utils.sheet_add_aoa(sheet, [row], { origin: -1 });
  XLSX.writeFile(workbook, feedbackPath);
}

http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    return sendJson(res, 200, { configured: Boolean(apiKey) });
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/todo.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    fs.createReadStream(pagePath).pipe(res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/feedback") {
    try {
      const payload = await readJson(req);
      const name = (payload.name || "").trim();
      const email = (payload.email || "").trim();
      const rating = Number(payload.rating);
      const comment = (payload.comment || "").trim();
      if (!name || name.length > 100) return sendJson(res, 400, { error: "Name is required (max 100 chars)." });
      if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "A valid email is required." });
      if (!rating || rating < 1 || rating > 5) return sendJson(res, 400, { error: "Rating must be 1-5." });
      if (comment.length > 500) return sendJson(res, 400, { error: "Comment must be under 500 chars." });
      saveFeedback({ name, email, rating, comment });
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message || "Unable to save feedback." });
    }
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const payload = await readJson(req);
      const reply = await askGemini(normalizeMessages(payload.messages));
      return sendJson(res, 200, { reply });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message || "Unable to process your request." });
    }
  }
  sendJson(res, 404, { error: "Not found." });
}).listen(port, () => console.log(`TaskFlow is running at http://localhost:${port}`));
