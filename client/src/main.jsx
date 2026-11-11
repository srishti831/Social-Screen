import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import App from './App.jsx';
import './styles.css';

// Visual feedback: briefly pulse whatever button was clicked.
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('button, a.btn, [role="tab"]') : null;
  if (!el || el.disabled) return;
  el.classList.remove('clicked');
  void el.offsetWidth; // restart the animation on rapid clicks
  el.classList.add('clicked');
  setTimeout(() => el.classList.remove('clicked'), 450);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
