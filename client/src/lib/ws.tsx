import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Command, ServerMessage, SessionState } from '@shared/types';

type WsContextValue = {
  state: SessionState | null;
  connected: boolean;
  sendCommand: (command: Command) => void;
};

const WsContext = createContext<WsContextValue | null>(null);

function wsUrl(): string {
  // Derive host from the page so remote screens work without hard-coding an IP.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

export function WsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let backoff = 1000; // grows on repeated failures, resets on a clean open

    function connect() {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoff = 1000; // healthy again
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === 'state') setState(message.state);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          reconnectTimer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 10000); // cap at 10s
        }
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const sendCommand = useCallback((command: Command) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(command));
    }
  }, []);

  return (
    <WsContext.Provider value={{ state, connected, sendCommand }}>
      {children}
    </WsContext.Provider>
  );
}

export function useSession(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useSession must be used within WsProvider');
  return ctx;
}
