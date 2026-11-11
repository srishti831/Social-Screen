import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, forgotPassword } from '../services/api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth single">
      <form className="auth-card" onSubmit={submit}>
        <h2>Forgot password</h2>
        {sent ? (
          <p>If that email is registered, a reset link is on its way. It is valid for 1 hour.</p>
        ) : (
          <>
            <p className="hint">Enter your email and we will send you a link to choose a new password.</p>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
          </>
        )}
        <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
      </form>
    </main>
  );
}
