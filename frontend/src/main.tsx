import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import Visor from './features/visor/Visor';
import SimVisor from './features/simulation/SimVisor';

const isVisor = location.pathname.startsWith('/visor');
const isSim = location.pathname.startsWith('/sim');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSim ? <SimVisor /> : isVisor ? <Visor /> : <App />}</StrictMode>,
);