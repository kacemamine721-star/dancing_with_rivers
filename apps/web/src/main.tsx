import '@/styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { createAppRouter } from '@/router';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found in index.html');

const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </StrictMode>,
);
