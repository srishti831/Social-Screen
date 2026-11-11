import { useEffect, useState } from 'react';
import { formatTime } from '../utils/format.js';

/** Everyone computes the countdown themselves from { phase, startedAt, duration }: no per-second traffic. */
export default function PomodoroPanel({ pomodoro, canControl, send }) {
  const [focus, setFocus] = useState(25);
  const [rest, setRest] = useState(5);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const phase = pomodoro?.phase || 'idle';
  const remaining =
    phase === 'idle' ? 0 : Math.max(0, pomodoro.duration - (Date.now() + pomodoro.offset - pomodoro.startedAt) / 1000);

  return (
    <div className="panel-stack pomodoro">
      <div className={`pomo-clock pomo-${phase}`}>
        <span className="pomo-phase">{phase === 'idle' ? 'Timer is off' : phase === 'focus' ? '🎯 Focus' : '☕ Break'}</span>
        <span className="pomo-time">{phase === 'idle' ? '--:--' : formatTime(remaining)}</span>
      </div>
      {canControl ? (
        <div className="pomo-controls">
          <label>Focus (min)<input type="number" min="1" max="120" value={focus} onChange={(e) => setFocus(Number(e.target.value))} /></label>
          <label>Break (min)<input type="number" min="1" max="60" value={rest} onChange={(e) => setRest(Number(e.target.value))} /></label>
          <div className="row-gap">
            <button type="button" className="btn btn-primary btn-small" onClick={() => send('pomodoro_start', { focusMin: focus, breakMin: rest })}>
              {phase === 'idle' ? 'Start' : 'Restart'}
            </button>
            {phase !== 'idle' && <button type="button" className="btn btn-small" onClick={() => send('pomodoro_stop')}>Stop</button>}
          </div>
        </div>
      ) : (
        <p className="hint">The host or moderators run the shared timer. Everyone sees the same countdown.</p>
      )}
    </div>
  );
}
