import { PointcloudPage } from './pages/PointcloudPage';
import { QrScannerPage } from './pages/QrScannerPage';

export function App() {
  if (window.location.pathname === '/scanner') {
    return <QrScannerPage />;
  }

  return <PointcloudPage />;
}
