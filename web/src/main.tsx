import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import LoginPage from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Vouchers = lazy(() => import('./pages/Vouchers'));
const Packages = lazy(() => import('./pages/Packages'));
const Customers = lazy(() => import('./pages/Customers'));
const Office = lazy(() => import('./pages/Office'));
const Monitor = lazy(() => import('./pages/Monitor'));
const Reports = lazy(() => import('./pages/Reports'));
const Routers = lazy(() => import('./pages/Routers'));
const SettingsPage = lazy(() => import('./pages/Settings'));

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

function FullSpinner() {
  return <div className="grid min-h-[60vh] place-items-center"><Spinner className="size-8" /></div>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <FullSpinner />;
  if (!user) return <LoginPage />;
  return (
    <Suspense fallback={<FullSpinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="voucher" element={<Vouchers />} />
          <Route path="paket" element={<Packages />} />
          <Route path="pelanggan" element={<Customers />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="laporan" element={<Reports />} />
          {user.role === 'admin' && <Route path="kantor" element={<Office />} />}
          {user.role === 'admin' && <Route path="router" element={<Routers />} />}
          {user.role === 'admin' && <Route path="pengaturan" element={<SettingsPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster richColors position="top-center" closeButton />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
