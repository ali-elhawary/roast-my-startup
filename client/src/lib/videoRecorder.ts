import { useCallback, useRef, useState } from 'react';

// In-app video capture for /station (Option 1). Records the selected camera +
// mic with MediaRecorder for the duration of the live session, then uploads the
// blob to the server, which transcodes it and builds captions. Gated by
// VITE_VIDEO_ENABLED so the audio-only flow is unaffected when off.

export const VIDEO_ENABLED = import.meta.env.VITE_VIDEO_ENABLED === 'true';

type UploadMeta = {
  sessionId: string;
  conversationId: string | null;
  conversationStartMs: number;
  founder: { name: string; email: string; consentAt: number } | null;
};

function pickMimeType(): string | '' {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export function useVideoRecorder() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);

  // List cameras. Labels are only populated after permission is granted, so call
  // this right after the kiosk unlock.
  const enumerate = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === 'videoinput');
      setDevices(cams);
      setDeviceId((prev) => prev || cams[0]?.deviceId || '');
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(async () => {
    if (!VIDEO_ENABLED) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      recorder.start(1000); // flush in 1s chunks
      recorderRef.current = recorder;
      recordStartRef.current = Date.now();
    } catch (err) {
      console.warn('[video] recorder failed to start', err);
    }
  }, [deviceId]);

  const stopAndUpload = useCallback(async (meta: UploadMeta) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' }));
      try {
        recorder.stop();
      } catch {
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
      }
    });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (!blob.size) return;

    const offsetMs = meta.conversationStartMs
      ? meta.conversationStartMs - recordStartRef.current
      : 0;
    const params = new URLSearchParams();
    if (meta.conversationId) params.set('conversationId', meta.conversationId);
    params.set('offsetMs', String(offsetMs));
    if (meta.founder) {
      params.set('name', meta.founder.name);
      params.set('email', meta.founder.email);
      params.set('consentAt', String(meta.founder.consentAt));
    }

    try {
      await fetch(`/api/video/${encodeURIComponent(meta.sessionId)}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'video/webm' },
        body: blob,
      });
      console.log(`[video] uploaded ${blob.size} bytes for ${meta.sessionId}`);
    } catch (err) {
      console.warn('[video] upload failed', err);
    }
  }, []);

  return {
    enabled: VIDEO_ENABLED,
    devices,
    deviceId,
    setDeviceId,
    enumerate,
    start,
    stopAndUpload,
  };
}
