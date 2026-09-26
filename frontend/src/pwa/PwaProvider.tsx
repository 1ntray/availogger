import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PwaContext = createContext({ canInstall: false, installed: false, installing: false, needsUpdate: false, error: '', install: async () => {}, update: async () => {} });

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState('');
  const { needRefresh: [needsUpdate], updateServiceWorker } = useRegisterSW({
    onRegisterError: () => setError('App installation support could not start. You can continue using the portal in your browser.'),
  });
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const detectInstalled = () => setInstalled(display.matches || !!(window.navigator as Navigator & { standalone?: boolean }).standalone);
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    const appInstalled = () => { setInstalled(true); setInstallEvent(null); };
    detectInstalled();
    display.addEventListener('change', detectInstalled);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', appInstalled);
    return () => { display.removeEventListener('change', detectInstalled); window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', appInstalled); };
  }, []);
  async function install() {
    if (!installEvent) return;
    setInstalling(true); setError('');
    try { await installEvent.prompt(); await installEvent.userChoice; }
    catch { setError('Installation could not be started. Use your browser’s install menu instead.'); }
    finally { setInstallEvent(null); setInstalling(false); }
  }
  return <PwaContext.Provider value={{ canInstall: !!installEvent && !installed, installed, installing, needsUpdate, error, install, update: async () => { try { await updateServiceWorker(true); } catch { setError('The update could not be applied. Close and reopen the portal.'); } } }}>{children}</PwaContext.Provider>;
}

export const usePwa = () => useContext(PwaContext);
