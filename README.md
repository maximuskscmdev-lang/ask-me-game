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

## Deployment

The game server (`server.js`) is a persistent Node process — **Vercel serverless
functions cannot host Socket.io** (no long-lived WebSocket upgrades). Recommended split:

1. **Frontend → Vercel** (this repo, static): `vercel.json` serves `public/`.
   No build step — it deploys as-is.
2. **Game server → Render / Railway / Fly.io** (any Node host): `npm start`.
3. Point the frontend at the server by setting one line in
   [`public/config.js`](public/config.js):

   ```js
   window.ASKME_SERVER_URL = 'https://your-server-host.example.com';
   ```

   Commit that change (or edit it in the Vercel dashboard via a deploy hook) and redeploy.
   Leave it empty when the Node server serves the app itself (single-host deploy).

## Project layout

| File | Purpose |
| --- | --- |
| `server.js` | Express static hosting + Socket.io room lifecycle |
| `rooms.js` | Room state machine (lobby → turn → asked → answer → rate → summary) |
| `questions.js` | Question banks: 30 general, 30 personal, 30 spicy, 22 adult |
| `public/` | Vanilla JS/CSS/HTML frontend (`app.js` routing, `room.js` game UI) |
| `test/e2e.js` | Socket-level simulation of two full players (`node test/e2e.js`, needs the server running) |
