import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, verifyEmail } from '../services/api.js';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { refreshUser } = useAuth();
  const [state, setState] = useState({ status: 'working', text: '' });

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState({ status: 'error', text: 'This link is missing its token.' });
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState({ status: 'ok', text: 'Your email is verified.' });
        refreshUser();
      })
      .catch((err) => setState({ status: 'error', text: errorMessage(err) }));
  }, [params, refreshUser]);

  return (
    <main className="notice-page">
      <h1>{state.status === 'working' ? 'Verifying...' : state.status === 'ok' ? 'All set' : 'Could not verify'}</h1>
      <p>{state.text}</p>
      <Link className="btn btn-primary" to="/">Go to Social - Screen</Link>
    </main>
  );
}
