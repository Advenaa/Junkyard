import { BrowserRouter, Routes, Route } from 'react-router';
import { AuthProvider } from './components/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { Login } from './pages/Login';
import { ReportView } from './pages/ReportView';
import { ReportList } from './pages/ReportList';
import { Settings } from './pages/Settings';
import { Feed } from './pages/Feed';
import { Chat } from './pages/Chat';

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<><Header /><main className="max-w-5xl mx-auto" /></>}>
              <Route path="/" element={<ReportView />} />
              <Route path="/reports" element={<ReportList />} />
              <Route path="/reports/:id" element={<ReportView />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
