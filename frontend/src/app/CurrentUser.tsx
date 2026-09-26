import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadCurrentUser, type CurrentUser } from './current-user-api';

const UserContext = createContext<{ user: CurrentUser | null; loading: boolean; error: string; retry: () => void }>({
  user: null, loading: true, error: '', retry: () => {},
});

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setUser(null);
    loadCurrentUser(controller.signal)
      .then(result => { if (!controller.signal.aborted) setUser(result); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load your account. Check your connection.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  return <UserContext.Provider value={{ user, loading, error, retry: () => setAttempt(value => value + 1) }}>{children}</UserContext.Provider>;
}

export const useCurrentUser = () => useContext(UserContext);
