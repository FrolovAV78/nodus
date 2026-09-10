import { useState } from "react";
import { api, type User } from "../lib/api";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("changeme");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121a31]/90 p-8 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api.login(username, password);
            onLogin(r.user);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка входа");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="text-xs tracking-[0.28em] text-[#6ee7c5]">NODUS</div>
        <h1 className="mt-2 text-3xl font-semibold">Вход в аналитику</h1>
        <p className="mt-2 text-sm text-[#8b97ad]">
          Explorer globals, чат на русском и отчёты по YottaDB.
        </p>
        <label className="mt-6 block text-sm text-[#8b97ad]">
          Логин
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm text-[#8b97ad]">
          Пароль
          <input
            type="password"
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-white"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}
        <button
          disabled={busy}
          className="mt-6 w-full rounded-xl bg-[#6ee7c5] py-2.5 font-medium text-[#06201a]"
        >
          {busy ? "Входим…" : "Войти"}
        </button>
        <p className="mt-4 text-xs text-[#8b97ad]">Демо: admin / changeme · analyst / analyst</p>
      </form>
    </div>
  );
}
