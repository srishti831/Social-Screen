# Social - Screen

Watch YouTube together in perfect sync. React + Vite client, Node/Express + `ws` + MongoDB server.
Same architecture as `youtube-watch-party-v2` (server is the source of truth, ticket-based WebSockets),
plus a lot of new features.

```
social-screen-pro/
  server/   Express 5, ws, Mongoose, Nodemailer      (deploy on Render)
  client/   React 19, Vite, PWA, Recharts            (deploy on Vercel)
  docs/     WEBSOCKET_PROTOCOL.md
```

## Run it locally

You need Node 18+ and a MongoDB (local `mongod` or a free MongoDB Atlas cluster).

```bash
# 1) server
cd server
cp .env.example .env        # fill MONGODB_URI and JWT_SECRET
npm install
npm run dev                 # http://localhost:5000

# 2) client (new terminal)
cd client
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Open two different browsers (or one normal + one incognito window), register two users, create a room in one and join it from the other.
Without SMTP settings, verification / reset emails are printed in the **server console**.

`cd server && npm test` runs a no-database smoke test of the whole WebSocket layer.

## Features and where they live

| Feature | Server | Client |
|---|---|---|
| Emoji reactions | `send_reaction` -> `Room.react` (whitelist + rate limit) | `ReactionLayer`, `ReactionBar`, CSS `floatUp` |
| Chat history | `models/Message.js`, `messageService`, `GET /rooms/:id/messages` | `Chat.jsx` ("Load older"), last 50 on join |
| Typing indicator | `typing_start/stop`, auto-stop after 5 s | throttled in `Chat.jsx`, 3 s idle stop |
| Emoji picker | - | `emoji-picker-react` (lazy loaded) |
| Invite share | - | `RoomTicket.jsx` (clipboard + WhatsApp) |
| Dark / light theme | - | CSS variables, `ThemeContext`, saved in localStorage |
| Room settings (public/private, password, max users) | `models/Room.js`, bcrypt, checked in `ws-ticket` and `join_room` | Dashboard options, `RoomSettingsModal` |
| Public rooms page | `GET /rooms/public` | `PublicRooms.jsx` |
| My rooms + history | `models/RoomJoin.js`, `GET /rooms/mine` | `Dashboard.jsx` |
| Shared queue + vote skip | `Room.queue`, `queue_*`, `video_ended` | `QueuePanel.jsx` |
| Moderator permissions per room | `modPermissions` in Room, `constants.can()` | settings modal, `utils/permissions.js` |
| Voice / video / screen share | `rtc_*` signalling in `Room.js` | `useWebRTC.js`, `CallPanel.jsx` |
| Live polls | `poll_*` | `PollPanel.jsx` |
| Timestamp notes | `models/Note.js`, `note_*` | `NotesPanel.jsx` |
| Shared Pomodoro | `Room.pomodoro` (phase, startedAt, duration) | `PomodoroPanel.jsx` |
| Browser notifications | - | `services/notify.js`, bell button |
| PWA | - | `vite-plugin-pwa` in `vite.config.js` |
| httpOnly cookies | `utils/cookies.js`, `middleware/auth.js`, CORS `credentials: true` | axios `withCredentials` |
| Refresh tokens | `RefreshToken` model, hashed, rotated on every refresh, deleted on logout | auto-refresh in `services/api.js` |
| Email verify + forgot password | `authController`, `mailService` (Nodemailer) | `VerifyEmail`, `ForgotPassword`, `ResetPassword` |
| Google login | `google-auth-library` verifies the ID token | `GoogleButton.jsx` (Google Identity Services) |
| Personal stats | `historyService.getUserStats` (aggregation) | `Stats.jsx` (Recharts) |

## Things to set up

**Google login (optional).** Google Cloud Console -> APIs & Services -> Credentials -> OAuth client ID (Web).
Add `http://localhost:5173` (and your Vercel URL) to *Authorized JavaScript origins*.
Put the Client ID in `server/.env` (`GOOGLE_CLIENT_ID`) and `client/.env` (`VITE_GOOGLE_CLIENT_ID`).

**Email (optional locally, needed in production).** Fill `SMTP_*` in `server/.env` (Gmail app password, Brevo, Resend SMTP...). Set `REQUIRE_EMAIL_VERIFICATION=true` if unverified users must not log in.

**Video calls.** Need HTTPS (localhost is fine for testing). STUN works on most networks; for strict networks add a TURN server (`VITE_TURN_*`). Mesh calls are limited to 5 people.

## Deploying (Vercel + Render)

1. Server on Render: root `server`, build `npm install`, start `npm start`. Env: everything from `.env.example`, with `NODE_ENV=production`, `CLIENT_URL=https://your-app.vercel.app`.
2. Client on Vercel: root `client`, env `VITE_API_URL=https://your-api.onrender.com/api`, `VITE_WS_URL=wss://your-api.onrender.com`.
3. **Cookies across two domains:** set `COOKIE_SAMESITE=none` on the server (needs HTTPS, already true on both). Some browsers (Safari, Brave, Chrome with strict settings) block third-party cookies, which would break login. The robust fix is to put the client and API on the same site, e.g. `app.yourdomain.com` and `api.yourdomain.com`, then use `COOKIE_SAMESITE=lax`.
4. Render's free plan sleeps when idle; the first request after a pause is slow.

## Security notes

- JWT lives only in httpOnly cookies (JavaScript cannot read it). Access token 15 min, refresh token 30 days, stored hashed, rotated on every use, deleted on logout and on password reset.
- CORS allows only listed origins; JSON-only body parsing means a plain cross-site HTML form cannot act as the user.
- Room passwords, user passwords: bcrypt. Email/reset tokens: only a SHA-256 hash is stored.
- Every WebSocket event is validated, permission-checked and rate-limited on the server. The client only hides buttons.
