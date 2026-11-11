import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Who am I? The httpOnly cookie is checked by the server (refreshing it if needed).
  useEffect(() => {
    let alive = true;
    api
      .fetchMe()
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // The api layer fires this when a refresh attempt fails (session really over).
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.fetchMe());
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login: async (credentials) => setUser((await api.login(credentials)).user),
      register: async (details) => setUser((await api.register(details)).user),
      googleLogin: async (credential) => setUser((await api.googleLogin(credential)).user),
      logout: async () => {
        await api.logout();
        setUser(null);
      },
      refreshUser,
    }),
    [user, loading, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
