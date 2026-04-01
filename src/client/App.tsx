import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { AgeGate } from "./pages/AgeGate";
import { HomePage } from "./pages/Home";
import { VideoPlayerPage } from "./pages/VideoPlayer";
import { SearchPage } from "./pages/Search";
import { CategoryPage } from "./pages/Category";
import { VideosPage } from "./pages/Videos";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { FavoritesPage, HistoryPage } from "./pages/UserPages";
import { AdminPage } from "./pages/Admin";
import { ModelPage } from "./pages/ModelPage";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);

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
