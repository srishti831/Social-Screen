import { useState } from 'react';
import { formatTime } from '../utils/format.js';

export default function NotesPanel({ notes, me, sync, canControl, send, onToast }) {
  const [text, setText] = useState('');
  const hasVideo = Boolean(sync?.videoId);

  function add(event) {
    event.preventDefault();
    if (text.trim() && send('note_add', { text: text.trim() })) setText('');
  }

  // Participants can't seek directly, so for them the click becomes a seek request.
  function jump(note) {
    if (note.videoId !== sync?.videoId) return onToast('That note belongs to a different video', 'info');
    return send(canControl ? 'seek' : 'request_seek', { time: note.videoTime });
  }

  return (
    <div className="panel-stack">
      <form className="video-form" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Note at the current moment" aria-label="Note" disabled={!hasVideo} />
        <button type="submit" className="btn" disabled={!hasVideo || !text.trim()}>Add note</button>
      </form>
      {notes.length === 0 ? (
        <p className="empty">No notes yet. Notes are stamped with the video time. Click one to jump there.</p>
      ) : (
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <button type="button" className="time-chip" onClick={() => jump(n)} title={canControl ? 'Jump to this moment' : 'Ask the host to jump here'}>
                {formatTime(n.videoTime)}
              </button>
              <div className="note-body">
                <p>{n.text}</p>
                <span className="muted">{n.username}</span>
              </div>
              {(n.userId === me?.userId || me?.role === 'host') && (
                <button type="button" className="btn btn-small btn-icon btn-danger" onClick={() => send('note_delete', { noteId: n.id })} aria-label="Delete note">✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
