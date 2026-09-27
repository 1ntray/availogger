import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadCurrentUser, type CurrentUser } from './current-user-api';

const UserContext = createContext<{ user: CurrentUser | null; loading: boolean; error: string; retry: () => void; refresh: (background?: boolean) => Promise<void> }>({
  user: null, loading: true, error: '', retry: () => {}, refresh: async () => {},
});

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async (background = false) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setError('');
    if (!background) { setLoading(true); setUser(null); }
    try {
      const result = await loadCurrentUser(controller.signal);
      if (!controller.signal.aborted) setUser(result);
    } catch (cause: unknown) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load your account. Check your connection.');
      throw cause;
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
    return () => pending.current?.abort();
  }, [refresh]);
  return <UserContext.Provider value={{ user, loading, error, refresh, retry: () => { void refresh().catch(() => {}); } }}>{children}</UserContext.Provider>;
}

export const useCurrentUser = () => useContext(UserContext);
