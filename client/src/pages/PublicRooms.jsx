import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../components/Topbar.jsx';
import { errorMessage, listPublicRooms } from '../services/api.js';
import { thumbnail } from '../utils/format.js';

export default function PublicRooms() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () =>
      listPublicRooms()
        .then((r) => alive && setRooms(r))
        .catch((err) => alive && setError(errorMessage(err)));
    load();
    const id = setInterval(load, 10_000); // keeps the list fresh while the page is open
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <Topbar />
      <main className="dashboard">
        <h1>Public rooms</h1>
        <p className="muted">Rooms that are open to everyone and have people watching right now.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {rooms === null ? (
          <p className="muted">Loading...</p>
        ) : rooms.length === 0 ? (
          <p className="empty">No public rooms are active. Create one and tick "Public" to be the first.</p>
        ) : (
          <div className="card-grid">
            {rooms.map((r) => (
              <button key={r.roomId} type="button" className="room-card" onClick={() => navigate(`/watch/${r.roomId}`)}>
                {r.videoId ? <img src={thumbnail(r.videoId)} alt="" loading="lazy" /> : <div className="room-card-empty">No video yet</div>}
                <div className="room-card-body">
                  <strong>{r.name || `Room ${r.roomId}`} {r.hasPassword && <span title="Password protected">🔒</span>}</strong>
                  <span className="muted">Host: {r.hostName || 'unknown'}</span>
                  <span className={`badge${r.participantCount >= r.maxUsers ? ' badge-full' : ''}`}>{r.participantCount}/{r.maxUsers} watching</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
