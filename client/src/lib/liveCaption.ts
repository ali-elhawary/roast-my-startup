import { useEffect, useRef } from 'react';
import type { Command, Phase } from '@shared/types';

// Live founder captions via the browser's SpeechRecognition (Chrome). While the
// kiosk is active it transcribes the founder and relays the current utterance as
// `liveTranscript`, scoped to the current question (reset when the phase changes)
// so /audience + /station can show word-by-word text. Uses the browser's DEFAULT
// mic, which must be the founder's mic; audio is sent to the browser's STT.

type SendCommand = (command: Command) => void;

const QUESTION_PHASES: Phase[] = ['q1', 'q2', 'q3'];

export function useLiveCaption(opts: {
  active: boolean; // kiosk unlocked (mic granted)
  phase: Phase | undefined;
  sendCommand: SendCommand;
}) {
  const { active, phase } = opts;

  // Live values read inside the recognition callbacks without re-subscribing.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sendRef = useRef(opts.sendCommand);
  sendRef.current = opts.sendCommand;

  const recRef = useRef<any>(null);
  const wantRef = useRef(false); // keep it running (restart after browser auto-stops)
  const resultCountRef = useRef(0); // # of results seen in the current SR session
  const baseIndexRef = useRef(0); // first result index belonging to the current question
  const lastSentRef = useRef(0);

  // On each new question, start captioning from the current position so a prior
  // answer doesn't bleed in.
  useEffect(() => {
    baseIndexRef.current = resultCountRef.current;
  }, [phase]);

  useEffect(() => {
    if (!active) return;
    const SR: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn('[caption] SpeechRecognition unavailable (need Chrome)');
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recRef.current = rec;
    wantRef.current = true;

    rec.onstart = () => {
      resultCountRef.current = 0;
      baseIndexRef.current = 0;
    };
    rec.onresult = (e: any) => {
      resultCountRef.current = e.results.length;
      if (!QUESTION_PHASES.includes(phaseRef.current as Phase)) return;
      let text = '';
      for (let i = baseIndexRef.current; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      text = text.trim();
      const now = Date.now();
      if (now - lastSentRef.current < 120) return; // throttle ~8/s
      lastSentRef.current = now;
      sendRef.current({ type: 'liveTranscript', text });
    };
    rec.onend = () => {
      // Chrome stops recognition after a stretch of silence; restart if we still
      // want captions.
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          /* already starting */
        }
      }
    };
    rec.onerror = () => {
      /* onend fires next and handles the restart */
    };

    try {
      rec.start();
    } catch {
      /* ignore */
    }

    return () => {
      wantRef.current = false;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, [active]);
}
