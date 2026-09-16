import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';

// Intentionally not wrapped in StrictMode: double-invoked effects would open two
// WebSocket connections and could start the ElevenLabs session twice on /station.
createRoot(document.getElementById('root')!).render(<App />);
