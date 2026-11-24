import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { router } from './router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry network blips, but never retry client errors (4xx) — they won't fix themselves.
      retry: (count, error) =>
        !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false }, // mutations are never auto-retried (avoids duplicate writes)
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
