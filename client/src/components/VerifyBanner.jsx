import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, resendVerification } from '../services/api.js';

export default function VerifyBanner() {
  const { user } = useAuth();
  const [msg, setMsg] = useState('');
  if (!user || user.emailVerified) return null;

  async function resend() {
    try {
      await resendVerification();
      setMsg('Verification email sent. Check your inbox.');
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  return (
    <div className="banner" role="status">
      <span>Please verify your email address ({user.email}).</span>
      <button type="button" className="btn btn-small" onClick={resend}>Resend email</button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
