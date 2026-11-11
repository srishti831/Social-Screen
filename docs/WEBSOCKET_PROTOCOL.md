# WebSocket protocol

Every message is JSON: `{ "type": "event_name", "payload": { ... } }`.

Connect: `POST /api/auth/ws-ticket {roomId, password?}` (cookie auth) -> `ws://host?ticket=...` -> send `join_room`.
The ticket is single-use, valid 30 s, bound to one user + one room.

## Client -> server

| Event | Payload | Who | Notes |
|---|---|---|---|
| `join_room` | `{roomId}` | all | Must be first. Server replies `room_joined` + `sync_state` |
| `leave_room` | | all | |
| `play` `pause` | | control_playback | |
| `seek` | `{time}` | control_playback | seconds |
| `change_video` | `{url}` | control_playback | persisted |
| `request_play/pause/seek/change_video` | same as above | participants (and moderators without control_playback) | creates a request |
| `approve_request` `reject_request` | `{requestId}` | resolve_requests | |
| `assign_role` | `{userId, role}` | host | `moderator` / `participant` |
| `transfer_host` | `{userId}` | host | |
| `remove_participant` | `{userId}` | host, or moderator with remove_participant (participants only) | |
| `chat_message` | `{message}` | all | saved in MongoDB |
| `send_reaction` | `{emoji}` | all | whitelisted emojis, rate limited |
| `typing_start` `typing_stop` | | all | server auto-stops after 5 s |
| `queue_add` | `{url}` | all | starts immediately if nothing is loaded and sender can control playback |
| `queue_remove` | `{itemId}` | owner of item or manage_queue | |
| `queue_reorder` | `{itemId, toIndex}` | manage_queue | |
| `queue_play` | `{itemId}` | control_playback | play this item now |
| `queue_vote_skip` | | all | skips when MORE than half of the room voted |
| `video_ended` | `{videoId, version}` | all | `version` = `sync_state.updatedAt`. Host/permitted mod: immediate. Others: half the room must report |
| `poll_create` | `{question, options[2..6]}` | manage_polls | one open poll at a time |
| `poll_vote` | `{pollId, optionId}` | all | one vote per user |
| `poll_close` | `{pollId}` | poll owner or manage_polls | |
| `note_add` | `{text}` | all | time = server's current playback position |
| `note_delete` | `{noteId}` | owner or host | |
| `pomodoro_start` | `{focusMin, breakMin}` | control_pomodoro | |
| `pomodoro_stop` | | control_pomodoro | |
| `rtc_join` | `{audio, video}` | all | max 5 in a call. Reply: `rtc_peers` |
| `rtc_leave` | | all | |
| `rtc_media` | `{audio, video}` | in call | mute / camera state |
| `rtc_offer` `rtc_answer` | `{to, description}` | in call | relayed to `to` |
| `rtc_ice` | `{to, candidate}` | in call | relayed to `to` |
| `screen_share_start` | `{streamId}` | in call | only one sharer at a time (`SCREEN_BUSY`) |
| `screen_share_stop` | | sharer | |

## Server -> client

`room_joined` (full snapshot: participants, last 50 chat messages, notes, settings, queue, poll, pomodoro, call peers, screen share),
`sync_state`, `user_joined`, `user_left`, `participant_removed`, `removed_from_room`, `role_assigned`, `host_transferred`, `room_closed`,
`room_settings_updated`, `request_created`, `request_ack`, `request_resolved`, `request_list`, `chat_message`, `reaction`, `typing`,
`queue_updated`, `poll_updated`, `note_added`, `note_deleted`, `pomodoro_state`, `rtc_peers`, `rtc_peer_joined`, `rtc_peer_left`,
`rtc_media_state`, `rtc_offer`, `rtc_answer`, `rtc_ice`, `screen_share_state`, `error {code, message}`.

Close codes: `4001` removed, `4002` replaced by another tab, `4004` room not found, `4005` room closed, `4006` room full, `4008` join timeout.

## REST

| Route | Purpose |
|---|---|
| `POST /api/auth/register` `login` `google` `logout` `refresh` | session (httpOnly cookies) |
| `GET /api/auth/me` | current user |
| `POST /api/auth/verify-email` `resend-verification` `forgot-password` `reset-password` | email flows |
| `POST /api/auth/ws-ticket` | WebSocket ticket (checks kicked / full / password) |
| `POST /api/rooms` | create room `{name, isPublic, password, maxUsers}` |
| `GET /api/rooms/public` | active public rooms |
| `GET /api/rooms/mine` | rooms I host + recently visited |
| `GET /api/rooms/:id` / `PATCH` / `DELETE` | info / settings (host) / delete (host) |
| `GET /api/rooms/:id/messages?before=<messageId>&limit=30` | older chat messages |
| `GET /api/stats/me` | personal stats (MongoDB aggregation) |
