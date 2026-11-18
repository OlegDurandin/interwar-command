import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './game/App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Отсутствует контейнер приложения');
createRoot(root).render(<StrictMode><App /></StrictMode>);
