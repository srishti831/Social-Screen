import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Topbar from '../components/Topbar.jsx';
import VerifyBanner from '../components/VerifyBanner.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { createRoom, deleteRoom, errorMessage, getRoom, listMyRooms } from '../services/api.js';
import { formatMinutes, thumbnail, timeAgo } from '../utils/format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [hosted, setHosted] = useState([]);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [options, setOptions] = useState({ name: '', isPublic: false, password: '', maxUsers: 10 });

  const load = useCallback(() => {
    listMyRooms()
      .then((r) => {
        setHosted(r.hosted);
        setRecent(r.recent);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function handleCreate(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { name: options.name, isPublic: options.isPublic, maxUsers: Number(options.maxUsers) };
      if (options.password) body.password = options.password;
      const room = await createRoom(body);
      navigate(`/watch/${room.roomId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function handleJoin(event) {
    event.preventDefault();
    setError('');
    const roomId = code.trim().toUpperCase();
    try {
      await getRoom(roomId); // quick check so a typo shows an error here instead of in the room
      navigate(`/watch/${roomId}`);
    } catch (err) {
      setError(err.response?.status === 404 ? 'No room with that code. Check it and try again.' : errorMessage(err));
    }
  }

  async function handleDelete(roomId) {
    if (!window.confirm(`Delete room ${roomId}?\n\nEveryone inside will be disconnected and its chat history is removed. This can't be undone.`)) return;
    setError('');
    try {
      await deleteRoom(roomId);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const set = (field) => (e) => setOptions((o) => ({ ...o, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <>
      <Topbar />
      <VerifyBanner />
      <main className="dashboard">
        <h1>Hi {user?.name}, what are we watching?</h1>
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="dash-grid">
          <form className="dash-card" onSubmit={handleCreate}>
            <h2>Start a room</h2>
            <p>You'll be the host. Share the link and friends can join.</p>
            {showOptions && (
              <div className="options">
                <label>Room name<input value={options.name} onChange={set('name')} maxLength={60} placeholder="Movie night" /></label>
                <label className="check"><input type="checkbox" checked={options.isPublic} onChange={set('isPublic')} /> Public (show on the Public rooms page)</label>
                <label>Password (optional)<input type="password" value={options.password} onChange={set('password')} minLength={4} maxLength={50} autoComplete="new-password" /></label>
                <label>Max people<input type="number" min="2" max="50" value={options.maxUsers} onChange={set('maxUsers')} /></label>
              </div>
            )}
            <div className="row-gap">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create room'}</button>
              <button type="button" className="btn btn-small" onClick={() => setShowOptions((v) => !v)}>{showOptions ? 'Hide options' : 'Room options'}</button>
            </div>
          </form>

          <form className="dash-card" onSubmit={handleJoin}>
            <h2>Join a room</h2>
            <p>Enter the 6-character code you were given.</p>
            <div className="inline-form">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" aria-label="Room code" className="code-input" />
              <button type="submit" className="btn btn-primary" disabled={code.trim().length !== 6}>Join room</button>
            </div>
            <p className="hint"><Link to="/public">Or browse public rooms</Link></p>
          </form>
        </div>

        {hosted.length > 0 && (
          <section className="my-rooms">
            <h2>Rooms you host</h2>
            <ul>
              {hosted.map((room) => (
                <li key={room.roomId}>
                  <span className="code-chip">{room.roomId}</span>
                  <span className="room-title">{room.name || 'Untitled room'} {room.isPublic && <span className="badge">Public</span>} {room.hasPassword && <span title="Password protected">🔒</span>}</span>
                  <Link to={`/watch/${room.roomId}`}>Open room</Link>
                  <button type="button" className="btn btn-small btn-danger row-delete" onClick={() => handleDelete(room.roomId)} aria-label={`Delete room ${room.roomId}`}>Delete</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="my-rooms">
          <h2>Recently visited</h2>
          {recent.length === 0 ? (
            <p className="empty">Rooms you join will show up here, so you can jump back in.</p>
          ) : (
            <ul>
              {recent.map((r) => (
                <li key={r.roomId}>
                  {r.videoId ? <img className="mini-thumb" src={thumbnail(r.videoId)} alt="" loading="lazy" /> : <span className="mini-thumb mini-empty" />}
                  <span className="code-chip">{r.roomId}</span>
                  <span className="room-title">
                    {r.name || 'Untitled room'} {r.hasPassword && <span title="Password protected">🔒</span>}
                    <span className="muted"> · {timeAgo(r.lastJoinedAt)} · {formatMinutes(Math.round(r.totalSeconds / 60))} total</span>
                  </span>
                  <Link to={`/watch/${r.roomId}`}>Rejoin</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
