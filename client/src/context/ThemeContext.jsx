import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const KEY = 'wp-theme';

// index.html already applied the saved theme before React started; we just read it back.
const current = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(current);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(KEY, next); // the toggle value is remembered
    } catch {
      /* private mode */
    }
    setTheme(next);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
