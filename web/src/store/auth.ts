import { create } from 'zustand';
import { api, AUTH_LOST, type User } from '../lib/api';

interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: User | null;
  check: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  check: async () => {
    try {
      const { user } = await api.me();
      set({ status: 'signed-in', user });
    } catch {
      set({ status: 'signed-out', user: null });
    }
  },
  login: async (password) => {
    const { user } = await api.login(password);
    set({ status: 'signed-in', user });
  },
  logout: async () => {
    await api.logout().catch(() => {});
    set({ status: 'signed-out', user: null });
  },
}));

// Any API call answered with 401 means the session ended (expired, or password changed by the admin).
window.addEventListener(AUTH_LOST, () => {
  if (useAuth.getState().status === 'signed-in') useAuth.setState({ status: 'signed-out', user: null });
});
