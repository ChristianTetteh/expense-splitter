import { Navigate, Route, Routes } from "react-router-dom";
import Header from "./components/Header.jsx";
import { AuthProvider, RequireAuth } from "./auth.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import Home from "./pages/Home.jsx";
import TabView from "./pages/TabView.jsx";
import Join from "./pages/Join.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

export default function App() {
  return (
    <AuthProvider>
      <div className="app">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/forgot" element={<ForgotPassword />} />
            <Route path="/reset" element={<ResetPassword />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/tabs/:id" element={<RequireAuth><TabView /></RequireAuth>} />
            <Route path="/join/:token" element={<RequireAuth><Join /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}
