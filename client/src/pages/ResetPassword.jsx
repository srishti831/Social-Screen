import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage, resetPassword } from '../services/api.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth single">
      <form className="auth-card" onSubmit={submit}>
        <h2>Choose a new password</h2>
        {!token ? (
          <p className="form-error">This link is missing its token. Open the link from your email again.</p>
        ) : done ? (
          <p>Your password was updated. <Link to="/login">Log in</Link></p>
        ) : (
          <>
            <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Saving...' : 'Update password'}</button>
          </>
        )}
      </form>
    </main>
  );
}
