import { useRef } from 'react';
import { REACTIONS } from '../services/config.js';

export default function ReactionBar({ send }) {
  const last = useRef(0);
  function react(emoji) {
    const now = Date.now();
    if (now - last.current < 250) return; // the server rate-limits too; this keeps the UI calm
    last.current = now;
    send('send_reaction', { emoji });
  }
  return (
    <div className="reaction-bar" role="group" aria-label="Send a reaction">
      {REACTIONS.map((emoji) => (
        <button key={emoji} type="button" className="reaction-btn" onClick={() => react(emoji)} aria-label={`React ${emoji}`}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
