import { useState } from 'react';
import { can } from '../utils/permissions.js';
import { thumbnail } from '../utils/format.js';

export default function QueuePanel({ queue, skipVotes, skipNeeded, me, settings, send, hasVideo }) {
  const [url, setUrl] = useState('');
  const canManage = can(me, settings, 'manage_queue');
  const canPlay = can(me, settings, 'control_playback');

  function add(event) {
    event.preventDefault();
    if (url.trim() && send('queue_add', { url: url.trim() })) setUrl('');
  }

  return (
    <div className="panel-stack">
      <form className="video-form" onSubmit={add}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add a YouTube link to the queue" aria-label="Add to queue" />
        <button type="submit" className="btn" disabled={!url.trim()}>Add</button>
      </form>

      {hasVideo && queue.length > 0 && (
        <div className="skip-row">
          <button type="button" className="btn btn-small" onClick={() => send('queue_vote_skip')}>
            ⏭ Vote to skip ({skipVotes}/{skipNeeded})
          </button>
          <span className="muted">More than half of the room must vote.</span>
        </div>
      )}

      {queue.length === 0 ? (
        <p className="empty">The queue is empty. Add videos and they play one after another.</p>
      ) : (
        <ol className="queue">
          {queue.map((item, index) => {
            const mine = item.addedBy === me?.userId;
            return (
              <li key={item.id} className="queue-item">
                <img src={thumbnail(item.videoId)} alt="" loading="lazy" />
                <div className="queue-info">
                  <strong title={item.title || item.videoId}>{item.title || item.videoId}</strong>
                  <span className="muted">added by {item.addedByName}</span>
                </div>
                <div className="queue-actions">
                  {canPlay && <button type="button" className="btn btn-small btn-icon" title="Play now" onClick={() => send('queue_play', { itemId: item.id })}>▶</button>}
                  {canManage && (
                    <>
                      <button type="button" className="btn btn-small btn-icon" title="Move up" disabled={index === 0} onClick={() => send('queue_reorder', { itemId: item.id, toIndex: index - 1 })}>▲</button>
                      <button type="button" className="btn btn-small btn-icon" title="Move down" disabled={index === queue.length - 1} onClick={() => send('queue_reorder', { itemId: item.id, toIndex: index + 1 })}>▼</button>
                    </>
                  )}
                  {(mine || canManage) && (
                    <button type="button" className="btn btn-small btn-icon btn-danger" title="Remove" onClick={() => send('queue_remove', { itemId: item.id })}>✕</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {!hasVideo && queue.length > 0 && canPlay && <p className="hint">Nothing is playing. Press ▶ on a video to start.</p>}
    </div>
  );
}
