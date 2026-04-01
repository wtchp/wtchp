import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { AgeGate } from "./pages/AgeGate";
import { SetupWizard } from "./pages/SetupWizard";
import { HomePage } from "./pages/Home";
import { VideoPlayerPage } from "./pages/VideoPlayer";
import { SearchPage } from "./pages/Search";
import { CategoryPage } from "./pages/Category";
import { VideosPage } from "./pages/Videos";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { FavoritesPage, HistoryPage } from "./pages/UserPages";
import { AdminPage } from "./pages/Admin";
import { ModelPage } from "./pages/ModelPage";
import { apiFetch } from "./hooks/useApi";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);

  // Check if setup is needed on first load
  useEffect(() => {
    apiFetch("/setup/status")
      .then((res) => {
        if (res.success) {
          setNeedsSetup(res.data.needs_setup);
        } else {
          setNeedsSetup(false);
        }
      })
      .catch(() => setNeedsSetup(false));
  }, []);

  // Show nothing while checking
  if (needsSetup === null) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "var(--bg-primary)",
      }}>
        <div className="spinner" />
      </div>
    );
  }

  // Show setup wizard if needed
  if (needsSetup) {
    return <SetupWizard onComplete={() => setNeedsSetup(false)} />;
  }

  return (
    <AuthProvider>
      <AgeGate />
      <div className="app-layout">
        <Header onMenuToggle={toggleSidebar} />
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="main-content with-sidebar">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/video/:slug" element={<VideoPlayerPage />} />
            <Route path="/videos" element={<VideosPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/category/:slug" element={<CategoryPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/model/:slug" element={<ModelPage />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}
