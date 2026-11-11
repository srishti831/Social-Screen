import RoleBadge from './RoleBadge.jsx';
import { can } from '../utils/permissions.js';

export default function ParticipantList({ participants, me, settings, send, callPeers = [] }) {
  const isHost = me?.role === 'host';
  const canRemove = can(me, settings, 'remove_participant');
  const inCall = new Set(callPeers.map((p) => p.userId));

  function confirmThen(message, action) {
    if (window.confirm(message)) action();
  }

  return (
    <ul className="people">
      {participants.map((p) => {
        const isMe = p.userId === me?.userId;
        // A moderator (when allowed) can only remove plain participants.
        const removable = !isMe && canRemove && (isHost || p.role === 'participant');
        return (
          <li key={p.userId} className="person">
            <div className="person-info">
              <span className="person-name">
                {p.username}
                {isMe && <span className="you"> (you)</span>}
                {inCall.has(p.userId) && <span title="In the call"> 🎙️</span>}
              </span>
              <RoleBadge role={p.role} />
            </div>
            {!isMe && (isHost || removable) && (
              <div className="person-actions">
                {isHost &&
                  (p.role === 'participant' ? (
                    <button type="button" className="btn btn-small" onClick={() => send('assign_role', { userId: p.userId, role: 'moderator' })}>Make moderator</button>
                  ) : (
                    <button type="button" className="btn btn-small" onClick={() => send('assign_role', { userId: p.userId, role: 'participant' })}>Make participant</button>
                  ))}
                {isHost && (
                  <button type="button" className="btn btn-small" onClick={() => confirmThen(`Make ${p.username} the host? You will become a participant.`, () => send('transfer_host', { userId: p.userId }))}>
                    Make host
                  </button>
                )}
                {removable && (
                  <button type="button" className="btn btn-small btn-danger" onClick={() => confirmThen(`Remove ${p.username} from the room?`, () => send('remove_participant', { userId: p.userId }))}>
                    Remove
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
