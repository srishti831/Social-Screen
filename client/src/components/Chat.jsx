import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { formatClock } from '../utils/format.js';

// The emoji picker is big, so it is only downloaded the first time somebody opens it.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

const TYPING_THROTTLE_MS = 2000; // send typing_start at most this often
const TYPING_IDLE_MS = 3000; // 3 s without typing = send typing_stop

export default function Chat({ messages, me, send, typing, hasMore, onLoadOlder }) {
  const { theme } = useTheme();
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [, tick] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const lastTypingSent = useRef(0);
  const idleTimer = useRef(null);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lastId]);

  // Re-render every second so "X is typing" disappears by itself.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => clearTimeout(idleTimer.current), []);

  function stopTyping() {
    clearTimeout(idleTimer.current);
    if (lastTypingSent.current) {
      lastTypingSent.current = 0;
      send('typing_stop');
    }
  }

  function noteTyping(value) {
    if (!value.trim()) return stopTyping();
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_THROTTLE_MS) {
      lastTypingSent.current = now;
      send('typing_start');
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
    return undefined;
  }

  function onChange(event) {
    setText(event.target.value);
    noteTyping(event.target.value);
  }

  function addEmoji(emojiData) {
    const next = text + emojiData.emoji;
    setText(next);
    noteTyping(next);
    inputRef.current?.focus();
  }

  function submit(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    if (send('chat_message', { message })) {
      setText('');
      setShowEmoji(false);
      clearTimeout(idleTimer.current);
      lastTypingSent.current = 0; // the server stops our typing indicator when the message arrives
    }
  }

  const now = Date.now();
  const names = Object.values(typing)
    .filter((t) => t.until > now)
    .map((t) => t.username);
  const typingText = names.length === 0 ? '' : names.length === 1 ? `${names[0]} is typing...` : names.length === 2 ? `${names[0]} and ${names[1]} are typing...` : 'Several people are typing...';

  return (
    <div className="chat">
      <ul className="chat-list" ref={listRef}>
        {hasMore && (
          <li className="load-older">
            <button type="button" className="btn btn-small" onClick={onLoadOlder}>Load older messages</button>
          </li>
        )}
        {messages.length === 0 && <li className="empty">No messages yet. Say something about the video.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`chat-message${m.userId === me?.userId ? ' mine' : ''}`}>
            <div className="chat-meta">
              <strong>{m.username}</strong>
              <time>{formatClock(m.timestamp)}</time>
            </div>
            {/* Rendered as plain text by React, so chat can't inject HTML. */}
            <p>{m.message}</p>
          </li>
        ))}
      </ul>
      <div className="typing-line" aria-live="polite">{typingText}</div>
      {showEmoji && (
        <div className="emoji-pop">
          <Suspense fallback={<p className="empty">Loading emojis...</p>}>
            <EmojiPicker onEmojiClick={addEmoji} theme={theme} width="100%" height={340} lazyLoadEmojis previewConfig={{ showPreview: false }} />
          </Suspense>
        </div>
      )}
      <form className="chat-form" onSubmit={submit}>
        <button type="button" className="btn btn-icon" onClick={() => setShowEmoji((v) => !v)} aria-label="Emoji picker" aria-expanded={showEmoji}>
          😊
        </button>
        <input ref={inputRef} value={text} onChange={onChange} onBlur={stopTyping} maxLength={500} placeholder="Message the room" aria-label="Message" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
