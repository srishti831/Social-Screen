import { useState } from 'react';
import { can } from '../utils/permissions.js';

export default function PollPanel({ poll, myVote, me, settings, send }) {
  const canManage = can(me, settings, 'manage_polls');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const open = poll && !poll.closed;

  function create(event) {
    event.preventDefault();
    const clean = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || clean.length < 2) return;
    if (send('poll_create', { question: question.trim(), options: clean })) {
      setQuestion('');
      setOptions(['', '']);
    }
  }

  const setOption = (i, value) => setOptions((list) => list.map((o, idx) => (idx === i ? value : o)));

  return (
    <div className="panel-stack">
      {poll ? (
        <div className="poll">
          <h3>{poll.question}</h3>
          <p className="muted">by {poll.createdByName} · {poll.total} vote{poll.total === 1 ? '' : 's'} {poll.closed && '· closed'}</p>
          <ul>
            {poll.options.map((o) => {
              const pct = poll.total ? Math.round((o.count / poll.total) * 100) : 0;
              const chosen = myVote === o.id;
              const canVote = open && !myVote;
              return (
                <li key={o.id}>
                  <button type="button" className={`poll-option${chosen ? ' chosen' : ''}`} disabled={!canVote} onClick={() => send('poll_vote', { pollId: poll.id, optionId: o.id })}>
                    <span className="poll-bar" style={{ width: `${pct}%` }} />
                    <span className="poll-text">{chosen && '✓ '}{o.text}</span>
                    <span className="poll-count">{o.count} · {pct}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {open && !myVote && <p className="hint">Pick one option. You can't change your vote.</p>}
          {open && canManage && (
            <button type="button" className="btn btn-small" onClick={() => send('poll_close', { pollId: poll.id })}>Close poll</button>
          )}
        </div>
      ) : (
        <p className="empty">{canManage ? 'No poll yet. Create one below.' : 'No poll right now.'}</p>
      )}

      {canManage && !open && (
        <form className="poll-form" onSubmit={create}>
          <h3>New poll</h3>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" maxLength={150} aria-label="Poll question" />
          {options.map((o, i) => (
            <input key={i} value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} maxLength={60} aria-label={`Option ${i + 1}`} />
          ))}
          <div className="row-gap">
            {options.length < 6 && <button type="button" className="btn btn-small" onClick={() => setOptions((l) => [...l, ''])}>+ Option</button>}
            <button type="submit" className="btn btn-primary btn-small" disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}>Start poll</button>
          </div>
        </form>
      )}
    </div>
  );
}
