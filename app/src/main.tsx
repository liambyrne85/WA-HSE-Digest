import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import './index.css';
import { startOutbox } from './lib/offline/outbox';

// A data router (rather than <BrowserRouter>) so pages can use useBlocker for unsaved-change guards.
// VITE_MEMORY_ROUTER=1 is used for the single-file preview build, which runs inside a sandboxed frame without real URLs.
const createRouter = import.meta.env.VITE_MEMORY_ROUTER === '1' ? createMemoryRouter : createBrowserRouter;
const router = createRouter([
  {
    path: '*',
    element: (
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    ),
  },
], import.meta.env.VITE_MEMORY_ROUTER === '1'
  // Demo / preview: a scanned tag opens …?s={token} (no server-side routes there)
  ? { initialEntries: [(() => { try { const t = new URLSearchParams(window.location.search).get('s'); return t ? `/s/${t}` : '/'; } catch { return '/'; } })()] }
  : { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

// Offline: cache the app itself (service worker) and send anything saved with no coverage.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
  });
}
startOutbox();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
