import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../services/api.js';
import GoogleButton from '../components/GoogleButton.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function AuthForm({ mode }) {
  const isRegister = mode === 'register';
  const { login, register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const done = () => navigate(location.state?.from || '/', { replace: true });

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isRegister) await register(form);
      else await login({ email: form.email, password: form.password });
      done();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle(credential) {
    setError('');
    try {
      await googleLogin(credential);
      done();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="auth">
      <div className="auth-theme"><ThemeToggle /></div>
      <div className="auth-intro">
        <h1>Watch together, <span className="grad">in sync.</span></h1>
        <p>Make a room, share the link, and everyone's player plays, pauses and seeks at the same moment. Chat, react, queue videos and even talk face to face.</p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{isRegister ? 'Create your account' : 'Log in'}</h2>
        {isRegister && (
          <label>Name<input value={form.name} onChange={update('name')} required minLength={2} maxLength={50} autoComplete="name" /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={update('email')} required autoComplete="email" /></label>
        <label>
          Password
          <input type="password" value={form.password} onChange={update('password')} required minLength={isRegister ? 8 : undefined} autoComplete={isRegister ? 'new-password' : 'current-password'} />
        </label>
        {isRegister && <p className="hint">At least 8 characters.</p>}
        {!isRegister && <p className="hint"><Link to="/forgot-password">Forgot your password?</Link></p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? 'Please wait...' : isRegister ? 'Create account' : 'Log in'}
        </button>
        <GoogleButton onCredential={onGoogle} onError={setError} />
        <p className="auth-switch">
          {isRegister ? (
            <>Already have an account? <Link to="/login" state={location.state}>Log in</Link></>
          ) : (
            <>New here? <Link to="/register" state={location.state}>Create an account</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
