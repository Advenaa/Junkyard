import { BrowserRouter, Routes, Route, Outlet } from 'react-router';
import { AuthProvider } from './components/AuthProvider';
import { StatusProvider } from './components/StatusProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { Login } from './pages/Login';
import { ReportView } from './pages/ReportView';
import { ReportList } from './pages/ReportList';
import { Settings } from './pages/Settings';
import { Feed } from './pages/Feed';
import { Chat } from './pages/Chat';
import { Search } from './pages/Search';
import { SummaryView } from './pages/SummaryView';
import { ItemView } from './pages/ItemView';

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StatusProvider>
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute />}>
                <Route
                  element={
                    <>
                      <Header />
                      <main className="max-w-5xl mx-auto">
                        <Outlet />
                      </main>
                    </>
                  }
                >
                  <Route path="/" element={<ReportView />} />
                  <Route path="/reports" element={<ReportList />} />
                  <Route path="/reports/:id" element={<ReportView />} />
                  <Route path="/summaries/:id" element={<SummaryView />} />
                  <Route path="/items/:id" element={<ItemView />} />
                  <Route path="/feed" element={<Feed />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route
                    path="*"
                    element={
                      <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
                        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
                        <a href="/" className="text-accent hover:underline">
                          Go to dashboard
                        </a>
                      </div>
                    }
                  />
                </Route>
              </Route>
            </Routes>
          </ErrorBoundary>
        </StatusProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
