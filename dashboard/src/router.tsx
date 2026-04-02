import { BrowserRouter, Routes, Route } from 'react-router';
import { AuthProvider } from './components/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';

function Home() {
  return <div className="p-6"><h1 className="font-heading text-2xl">Dashboard</h1><p className="text-text-secondary mt-2">Reports will appear here.</p></div>;
}
function Reports() {
  return <div className="p-6"><h1 className="font-heading text-2xl">Reports</h1></div>;
}
function Settings() {
  return <div className="p-6"><h1 className="font-heading text-2xl">Settings</h1></div>;
}
function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-heading text-3xl mb-8">Podders</h1>
        <a href="/api/v1/auth/discord" className="inline-block px-6 py-3 bg-accent text-white rounded-lg hover:opacity-90">Sign in with Discord</a>
      </div>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<><Header /><main className="max-w-5xl mx-auto" /></>}>
              <Route path="/" element={<Home />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
