import { lazy, StrictMode, Suspense } from 'react';
import { platform } from './platform';
import { createRoot } from 'react-dom/client';
import { App } from './game/App';
import { MovementMap } from './game/MovementMap';
import './style.css';
import './command-room.css';

const root = document.getElementById('root');
if (!root) throw new Error('Отсутствует контейнер приложения');
platform.init();
const Editor=lazy(()=>import('./editor/Editor'));
function Client() {
  if (new URLSearchParams(location.search).has('editor')) return <Suspense fallback={<p>Загрузка редактора…</p>}><Editor/></Suspense>;
  return location.search === '?demo' ? <App /> : <MovementMap />;
}
createRoot(root).render(<StrictMode><Client /></StrictMode>);
