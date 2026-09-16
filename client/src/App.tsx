import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { WsProvider } from '@/lib/ws';
import Signin from '@/routes/Signin';
import Station from '@/routes/Station';
import Audience from '@/routes/Audience';
import Panel from '@/routes/Panel';
import Operator from '@/routes/Operator';

export default function App() {
  return (
    <WsProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/audience" replace />} />
          <Route path="/signin" element={<Signin />} />
          <Route path="/station" element={<Station />} />
          <Route path="/audience" element={<Audience />} />
          <Route path="/panel" element={<Panel />} />
          <Route path="/operator" element={<Operator />} />
          <Route path="*" element={<Navigate to="/audience" replace />} />
        </Routes>
      </BrowserRouter>
    </WsProvider>
  );
}
