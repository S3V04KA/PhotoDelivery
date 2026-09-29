import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

const host = document.getElementById('root');

if (host === null) {
  throw new Error('Не найден корневой элемент #root');
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
