# Social ▸ Screen

Watch videos together with your friends, perfectly in sync. Make a room, share the link, and everyone's video plays, pauses and jumps at the same time. Chat, react, vote, take notes and even talk on a video call, all in one place.

## Features

**Watching together**
- Everyone sees the same video at the same time (play, pause, seek, change video).
- Late joiners and people who refresh land at the right moment.
- Roles: **Host**, **Moderator** and **Participant**. Participants can ask for control and the Host or a Moderator can approve it.
- The Host can choose what Moderators are allowed to do in each room.

**Chat and fun**
- Live chat with saved history (older messages load on request).
- Emoji picker and "someone is typing..." indicator.
- Emoji reactions that float over the video.
- Live polls where everyone gets one vote.
- Notes saved at an exact time of the video. Click a note to jump there.
- Shared Pomodoro timer for study or work sessions.

**Rooms**
- Public or private rooms, optional password, and a limit on how many people can join.
- Public rooms page to find and join open rooms.
- Your own rooms and recently joined rooms on the dashboard.
- Shared queue: add videos, reorder them, and vote to skip. The next video starts by itself.
- Invite friends with a copy link button or WhatsApp.

**Voice, video and screen share**
- Voice and video calls right inside the room (up to 5 people).
- Mute, camera on/off and screen sharing (one person shares at a time).

**Account and security**
- Sign up with email or Google.
- Email verification and forgot password.
- Safe login using httpOnly cookies and refresh tokens.
- Personal stats page with charts (watch time, messages, rooms).

**App feel**
- Dark and light theme.
- Browser notifications.
- Install it like an app on phone or laptop (PWA).

## Tech used

- **Frontend:** React, Vite
- **Backend:** Node.js, Express, WebSocket (`ws`)
- **Database:** MongoDB (Mongoose)
- **Calls:** WebRTC

## Folder structure

```
social-screen-pro/
  client/   the website (deploy on Vercel)
  server/   the API and real-time server (deploy on Render)
```

## Run it on your computer

You need Node.js 18+ and a MongoDB database (local or free MongoDB Atlas).

```bash
# 1) Server
cd server
cp .env.example .env     # fill MONGODB_URI and JWT_SECRET
npm install
npm run dev              # runs on http://localhost:5000

# 2) Client (open a new terminal)
cd client
cp .env.example .env
npm install
npm run dev              # runs on http://localhost:5173
```

To try it, open the site in two different browsers (or one normal and one incognito window), create two accounts, make a room in one and join it from the other.

## Optional setup

- **Email:** fill the `SMTP_*` values in `server/.env`. If you skip this, verification and reset links are printed in the server terminal.
- **Google login:** create a Web OAuth client in Google Cloud Console, add your site URL under "Authorized JavaScript origins", and put the Client ID in `GOOGLE_CLIENT_ID` (server) and `VITE_GOOGLE_CLIENT_ID` (client).
- **Video calls:** work on `localhost` and on HTTPS sites. On some strict networks a TURN server is needed (see `.env.example`).

## Deploy

1. **Server on Render:** root folder `server`, build command `npm install`, start command `npm start`. Add all values from `.env.example`, set `NODE_ENV=production` and `CLIENT_URL` to your website link.
2. **Client on Vercel:** root folder `client`. Set `VITE_API_URL` (your server link + `/api`) and `VITE_WS_URL` (your server link starting with `wss://`).
3. **Login cookies:** if the website and server are on different domains, set `COOKIE_SAMESITE=none` on the server. Some browsers (Safari, Brave) can block this, so the best way is to use one domain for both, like `app.yourdomain.com` and `api.yourdomain.com`, with `COOKIE_SAMESITE=lax`.

## License

All rights reserved. This is a private project.