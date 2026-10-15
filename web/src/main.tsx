import './lib/migrate-storage';
import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { LoginPage } from './pages/Login';
import { useAuth } from './store/auth';
import { usePlayer } from './store/player';
import './index.css';
import './store/theme';

// After a redeploy, a tab that's still open references page files from the old build, which are gone.
// Reload once to pick up the new version (guarded so a real outage can't cause a reload loop).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  try {
    const last = Number(sessionStorage.getItem('tuno-reloaded') ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem('tuno-reloaded', String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway */
  }
  location.reload();
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

/** Shows the login screen until someone signs in; each account gets a fresh app (own data, queue and theme). */
function AuthGate() {
  const { status, user, check } = useAuth();
  const lastUser = useRef<number | null>(null);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const id = user?.id ?? null;
    if (id === lastUser.current) return;
    // Switching or leaving an account: drop everything cached from the previous one.
    if (lastUser.current !== null) {
      queryClient.clear();
      usePlayer.getState().reset();
    }
    lastUser.current = id;
  }, [user]);

  if (status === 'loading') return <div className="h-full bg-bg" />;
  if (status === 'signed-out' || !user) return <LoginPage />;
  return <App key={user.id} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
