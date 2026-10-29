import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toast } from './components/Toast';
import { HomeScreen } from './screens/HomeScreen';
import { CardsScreen } from './screens/CardsScreen';
import { FilesScreen } from './screens/FilesScreen';
import { LogsScreen } from './screens/LogsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { Workspace } from './screens/Workspace';
import { WriteScreen } from './screens/WriteScreen';
import { SampleProvider } from './state/sampleStore';

export function App() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const root = document.documentElement;
      if (!root) return;
      root.style.setProperty('--vv-height', `${viewport.height}px`);
      root.style.setProperty('--vv-offset', `${viewport.offsetTop}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
    };
  }, []);

  return (
    <SampleProvider>
      <BrowserRouter>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/p/:projectId" element={<Workspace />}>
              <Route index element={<Navigate to="write" replace />} />
              <Route path="write/:chapterId?" element={<WriteScreen />} />
              <Route path="cards" element={<CardsScreen />} />
              <Route path="files" element={<FilesScreen />} />
              <Route path="stats" element={<StatsScreen />} />
              <Route path="settings" element={<SettingsScreen />} />
              <Route path="logs" element={<LogsScreen />} />
            </Route>
          </Routes>
          <Toast />
        </div>
      </BrowserRouter>
    </SampleProvider>
  );
}
