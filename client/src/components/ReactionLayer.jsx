import { useEffect, useState } from 'react';

const LIFETIME_MS = 2800;

/** Floating emojis drawn over the video. They are removed again after the CSS animation ends. */
export default function ReactionLayer({ subscribe }) {
  const [items, setItems] = useState([]);

  useEffect(
    () =>
      subscribe('reaction', ({ id, emoji, username }) => {
        const item = { id, emoji, username, left: 8 + Math.random() * 80, drift: Math.round(Math.random() * 60 - 30) };
        setItems((list) => [...list.slice(-25), item]);
        setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), LIFETIME_MS);
      }),
    [subscribe]
  );

  return (
    <div className="reaction-layer" aria-hidden="true">
      {items.map((i) => (
        <span key={i.id} className="float-emoji" style={{ left: `${i.left}%`, '--dx': `${i.drift}px` }}>
          {i.emoji}
          <small>{i.username}</small>
        </span>
      ))}
    </div>
  );
}
