import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
// Plain Bootstrap CSS (grid + utilities: container, d-flex, row/col-*, etc.)
// loads everywhere — both the admin dashboard and the public site's own
// PublicLayout.jsx/Puck blocks are built on these utility classes for
// layout, not just theming. This is separate from the NetSimple/Tabler
// ADMIN SKIN (vendor/css/styles.css, which layers admin-specific component
// styling with `!important` on top of Bootstrap) — that one is gated to
// admin/portal surfaces only via useAdminTheme.js, since it's what caused
// the public site's own design to get overridden.
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { CartProvider } from './frontend/context/CartContext.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <AuthProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
