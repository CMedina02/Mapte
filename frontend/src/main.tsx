import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import Visor from './features/visor/Visor';

const isVisor = location.pathname.startsWith('/visor');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isVisor ? <Visor /> : <App />}</StrictMode>,
);