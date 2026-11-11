import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRoomSocket } from '../hooks/useRoomSocket.js';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { useToasts } from '../hooks/useToasts.js';
import { notify } from '../services/notify.js';
import { can } from '../utils/permissions.js';
import PlayerPanel from '../components/PlayerPanel.jsx';
import ParticipantList from '../components/ParticipantList.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import Chat from '../components/Chat.jsx';
import QueuePanel from '../components/QueuePanel.jsx';
import PollPanel from '../components/PollPanel.jsx';
import NotesPanel from '../components/NotesPanel.jsx';
import PomodoroPanel from '../components/PomodoroPanel.jsx';
import CallPanel from '../components/CallPanel.jsx';
import RoomSettingsModal from '../components/RoomSettingsModal.jsx';
import RoomTicket from '../components/RoomTicket.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import Toasts from '../components/Toasts.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import NotifyButton from '../components/NotifyButton.jsx';

const STATUS_TEXT = { connected: 'Connected', connecting: 'Connecting', reconnecting: 'Reconnecting' };
const NOTICE_TITLES = {
  removed: 'You were removed from this room',
  replaced: 'Room open in another tab',
  closed: 'This room was closed',
  full: 'This room is full',
  error: "Can't open this room",
};

export default function Watch() {
  const roomId = useParams().roomId.toUpperCase();
  const navigate = useNavigate();
  const { toasts, push } = useToasts();
  const [tab, setTab] = useState('people');
  const [password, setPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const { state, send, leave, subscribe, loadOlder } = useRoomSocket(roomId, { onToast: push, onNotify: notify, password });
  const { status, me, participants, sync, settings, chat, hasMoreChat, typing, notes, requests, myRequests } = state;
  const { queue, skipVotes, skipNeeded, poll, myVote, pomodoro, callPeers, screenShare } = state;

  const rtc = useWebRTC({ send, subscribe, me, screenShare, onToast: push });

  const canControl = can(me, settings, 'control_playback');
  const canResolve = can(me, settings, 'resolve_requests');
  const canPomodoro = can(me, settings, 'control_pomodoro');

  function handleLeave() {
    rtc.leaveCall(false);
    leave();
    navigate('/');
  }

  if (status === 'password') {
    return (
      <main className="notice-page">
        <h1>This room is password protected</h1>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setPassword(passwordInput); }}>
          <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="Room password" aria-label="Room password" autoFocus />
          <button type="submit" className="btn btn-primary" disabled={!passwordInput}>Join</button>
        </form>
        {state.errorText && <p className="form-error" role="alert">{state.errorText}</p>}
        <Link className="btn" to="/">Back</Link>
      </main>
    );
  }

  if (NOTICE_TITLES[status]) {
    return (
      <main className="notice-page">
        <h1>{NOTICE_TITLES[status]}</h1>
        <p>{state.errorText}</p>
        <Link className="btn btn-primary" to="/">Back to your rooms</Link>
      </main>
    );
  }

  const tabs = [
    ['people', `People (${participants.length})`],
    ['chat', 'Chat'],
    ['queue', `Queue${queue.length ? ` (${queue.length})` : ''}`],
    ['requests', `Requests${canResolve && requests.length > 0 ? ` (${requests.length})` : ''}`],
    ['poll', poll && !poll.closed ? 'Poll •' : 'Poll'],
    ['notes', `Notes${notes.length ? ` (${notes.length})` : ''}`],
    ['timer', pomodoro?.phase && pomodoro.phase !== 'idle' ? 'Timer •' : 'Timer'],
  ];

  return (
    <div className="watch">
      <header className="watch-header">
        <Link to="/" className="brand" onClick={leave}>Social - Screen</Link>
        <RoomTicket roomId={roomId} roomName={settings?.name} hasPassword={settings?.hasPassword} onCopied={push} />
        <div className="watch-header-right">
          {settings?.name && <span className="muted hide-sm">{settings.name}</span>}
          <span className={`status status-${status}`}>{STATUS_TEXT[status] || status}</span>
          {me && <RoleBadge role={me.role} />}
          {me?.role === 'host' && settings && (
            <button type="button" className="btn btn-small btn-icon" onClick={() => setShowSettings(true)} title="Room settings" aria-label="Room settings">⚙️</button>
          )}
          <NotifyButton onToast={push} />
          <ThemeToggle />
          <button type="button" className="btn btn-small" onClick={handleLeave}>Leave room</button>
        </div>
      </header>

      {!me ? (
        <p className="joining">Joining room...</p>
      ) : (
        <div className="watch-body">
          <div className="stage">
            <PlayerPanel sync={sync} canControl={canControl} send={send} subscribe={subscribe} />
            <CallPanel rtc={rtc} callPeers={callPeers} me={me} screenShare={screenShare} />
          </div>

          <aside className="sidebar">
            <div className="tabs" role="tablist">
              {tabs.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="tab-body">
              {tab === 'people' && <ParticipantList participants={participants} me={me} settings={settings} send={send} callPeers={callPeers} />}
              {tab === 'chat' && <Chat messages={chat} me={me} send={send} typing={typing} hasMore={hasMoreChat} onLoadOlder={loadOlder} />}
              {tab === 'queue' && <QueuePanel queue={queue} skipVotes={skipVotes} skipNeeded={skipNeeded} me={me} settings={settings} send={send} hasVideo={Boolean(sync?.videoId)} />}
              {tab === 'requests' && <RequestsPanel canResolve={canResolve} requests={requests} myRequests={myRequests} send={send} />}
              {tab === 'poll' && <PollPanel poll={poll} myVote={myVote} me={me} settings={settings} send={send} />}
              {tab === 'notes' && <NotesPanel notes={notes} me={me} sync={sync} canControl={canControl} send={send} onToast={push} />}
              {tab === 'timer' && <PomodoroPanel pomodoro={pomodoro} canControl={canPomodoro} send={send} />}
            </div>
          </aside>
        </div>
      )}
      {showSettings && settings && <RoomSettingsModal roomId={roomId} settings={settings} onClose={() => setShowSettings(false)} />}
      <Toasts toasts={toasts} />
    </div>
  );
}
