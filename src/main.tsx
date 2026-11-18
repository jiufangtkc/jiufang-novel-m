import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initDeviceTheme } from './layout/deviceTheme';
import './fonts/iansui.css';
import './styles/global.css';

// WO-101：先讀這台裝置的主題並掛到 <html data-theme>，再畫畫面。
initDeviceTheme();

registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('找不到根節點');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
