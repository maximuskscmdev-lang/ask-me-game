# Ask Me — two-player question game

Join a room with a 4-character code, then take turns asking and answering questions.
The answerer can **like**, **dislike**, or **reject** each question; the asker then likes or
dislikes the answer. Every like scores a point. 10 rounds, then the winner is crowned.

Categories: **General** (fun & light), **Personal** (deeper), **Spicy** (flirty, SFW),
and **Adult 18+** (explicit — both players must confirm they are 18+ to enable it).
Players pick their own categories; at least one must be shared for the game to start.
You can also add **custom questions** — they go into a shared pool that the asker can
pick from (as the "Custom" category) and they survive rematches.

## Run

```sh
npm install
npm start          # http://localhost:3000  (override with PORT)
```

Open the app in two tabs/devices (or share the invite link with `?code=XXXX`),
create a room in one, join with the code in the other.

## Deployment (Vercel UI + external game server)

The game server (`server.js`) is a persistent Node process — **Vercel serverless
functions cannot host Socket.io** (no long-lived WebSocket upgrades). Run it as two pieces:

1. **Game server → Render** (or Railway/Fly): push this repo, then
   [render.com](https://render.com) → New → **Blueprint**, pick `render.yaml`.
   It runs `npm start` and exposes a `PORT`. Note the assigned URL, e.g.
   `https://ask-me-game-server.onrender.com`.
2. **Frontend → Vercel**: import the same repo — `vercel.json` serves `public/`
   statically, no build step.
3. **Connect them**: edit one line in [`public/config.js`](public/config.js):

   ```js
   window.ASKME_SERVER_URL = 'https://ask-me-game-server.onrender.com';
   ```

   `git push` — Vercel auto-redeploys from GitHub. Leave the value empty only when
   the Node server also serves the UI itself (single-host deploy).

Notes:
- The server URL must be **https** (browsers block mixed content).
- Render's free plan sleeps when idle — the first connection after a nap may take
  ~30s, and a sleeping server surfaces the "Could not reach the game server" message.
- CORS is already enabled on the server for the cross-origin frontend.
- Invite links (`?code=ABCD`) always point at the Vercel origin, which is correct.

## Project layout

| File | Purpose |
| --- | --- |
| `server.js` | Express static hosting + Socket.io room lifecycle |
| `rooms.js` | Room state machine (lobby → turn → asked → answer → rate → summary) |
| `questions.js` | Question banks: 30 general, 30 personal, 30 spicy, 22 adult |
| `public/` | Vanilla JS/CSS/HTML frontend (`app.js` routing, `room.js` game UI) |
| `test/e2e.js` | Socket-level simulation of two full players (`node test/e2e.js`, needs the server running) |
