import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../services/config.js';

let scriptPromise = null;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Google Identity Services button. Hidden when VITE_GOOGLE_CLIENT_ID is not set. */
export default function GoogleButton({ onCredential, onError }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let alive = true;
    loadGoogle()
      .then(() => {
        if (!alive || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => cbRef.current(response.credential),
        });
        window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
      })
      .catch(() => {
        setFailed(true);
        onError?.('Could not load Google sign-in');
      });
    return () => {
      alive = false;
    };
  }, [onError]);

  if (!GOOGLE_CLIENT_ID || failed) return null;
  return <div className="google-wrap"><div ref={ref} /></div>;
}
