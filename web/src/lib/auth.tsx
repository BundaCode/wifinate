import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getToken, setToken } from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<{ needsSetup: boolean }>('/auth/status');
        setNeedsSetup(s.needsSetup);
        if (!s.needsSetup && getToken()) {
          const me = await api<{ user: User }>('/auth/me');
          setUser(me.user);
        }
      } catch { /* token kedaluwarsa → ke halaman login */ }
      setLoading(false);
    })();
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    window.addEventListener('wifinate:logout', signOut);
    return () => window.removeEventListener('wifinate:logout', signOut);
  }, [signOut]);

  const signIn = (token: string, u: User) => {
    setToken(token);
    setUser(u);
    setNeedsSetup(false);
  };

  return <Ctx.Provider value={{ user, loading, needsSetup, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
