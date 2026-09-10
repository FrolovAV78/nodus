import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type User } from "./lib/api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Explorer from "./pages/Explorer";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import History from "./pages/History";
import Settings from "./pages/Settings";
import Users from "./pages/Users";

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-[#8b97ad]">
        Загрузка…
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <Layout user={user} onLogout={async () => {
      await api.logout();
      setUser(null);
    }}>
      <Routes>
        <Route path="/" element={<Navigate to="/explorer" replace />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<Users me={user} />} />
      </Routes>
    </Layout>
  );
}
