import { Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '../components/Logo';
import { useAuth } from '../store/auth';

/** Shown when nobody is signed in. The password alone decides which account (and library) opens. */
export function LoginPage() {
  const login = useAuth((s) => s.login);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    document.title = 'Tuno · Log in';
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-bg px-4 py-10">
      {/* soft accent glow behind the card */}
      <div
        className="pointer-events-none absolute left-1/2 top-[-20%] h-[70vh] w-[70vh] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgb(var(--c-accent) / 0.55), transparent 65%)' }}
        aria-hidden
      />
      <form onSubmit={submit} className="relative w-full max-w-sm animate-fade-in rounded-xl bg-elevated/80 p-8 shadow-2xl ring-1 ring-text/10 backdrop-blur">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="mb-4 h-16 w-16 drop-shadow-[0_8px_24px_rgb(var(--c-accent)/0.45)]" />
          <h1 className="text-3xl font-extrabold tracking-tight">Tuno</h1>
          <p className="mt-2 text-sm text-muted">Enter your password to open your music.</p>
        </div>

        <label className="block">
          <span className="sr-only">Password</span>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input
              ref={input}
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              autoComplete="current-password"
              placeholder="Password"
              className={`h-12 w-full rounded-full bg-bg/80 pl-11 pr-12 text-text outline-none ring-1 placeholder:text-muted focus:ring-2 ${
                error ? 'ring-red-500/70' : 'ring-text/15 focus:ring-accent'
              }`}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="icon-btn absolute right-1.5 top-1/2 -translate-y-1/2"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </label>

        <p className={`mt-3 min-h-5 text-center text-sm text-red-400 ${error ? '' : 'invisible'}`} role="alert">
          {error ?? '.'}
        </p>

        <button disabled={busy || !password} className="btn-accent mt-2 h-12 w-full text-base">
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          Log in
        </button>
      </form>
    </div>
  );
}
