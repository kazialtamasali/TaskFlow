# TaskFlow

A polished, lightweight to-do list with dark mode, filtering, drag-to-reorder, and a Gemini-powered productivity assistant.

## Gemini setup

1. Install [Node.js 18 or later](https://nodejs.org/).
2. Copy `.env.example` to a new `.env` file.
3. Set `GEMINI_API_KEY` in `.env` to your Gemini API key.
4. Run `npm.cmd start` (or `npm start` if PowerShell permits npm scripts) and open `http://localhost:3000`.

The key is read only by `server.js` and is never delivered to the browser. Do not open `todo.html` directly or through VS Code Live Server when using chat; use `http://localhost:3000` from the local server instead.

## Environment variables

```env
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.6-flash
PORT=3000
```

The task list itself remains stored locally in the browser. Gemini chat is intentionally optional: task management keeps working if Gemini is not configured or its API is unavailable.
