import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TripIndexPage } from './TripIndexPage.tsx';
import { TripView } from './TripView.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { UpdatePrompt } from './ui/UpdatePrompt.tsx';

function currentSlug(): string {
  try {
    return decodeURIComponent(location.pathname.split('/')[1] ?? '');
  } catch {
    return '';
  }
}

function App() {
  const slug = currentSlug();
  return (
    <>
      <ErrorBoundary>{slug ? <TripView slug={slug} /> : <TripIndexPage />}</ErrorBoundary>
      <UpdatePrompt />
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
