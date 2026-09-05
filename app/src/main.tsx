import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root를 찾지 못했어요');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// 서비스워커는 개발 중에는 등록하지 않는다. 캐시가 변경을 가려 디버깅이 어려워진다.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { type: 'module' });
  });
}
