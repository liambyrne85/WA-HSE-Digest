import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ToastProvider } from './contexts/ToastContext';
import './index.css';

// A data router (rather than <BrowserRouter>) so pages can use useBlocker for unsaved-change guards.
// VITE_MEMORY_ROUTER=1 is used for the single-file preview build, which runs inside a sandboxed frame without real URLs.
const createRouter = import.meta.env.VITE_MEMORY_ROUTER === '1' ? createMemoryRouter : createBrowserRouter;
const router = createRouter([
  {
    path: '*',
    element: (
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
