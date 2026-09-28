import { useCallback, useRef, useState } from 'react';

// 720p30 cap. `ideal` alone is a soft hint that 4K webcams ignore (handing us a
// 2160p stream whose VP9 decode took minutes to transcode); `max` forces the
// camera down to what we actually ship. Shared by the preview + the recording so
// they use one stream.
function videoConstraints(deviceId: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

// In-app video capture for /station (Option 1). Records the selected camera +
// mic with MediaRecorder for the duration of the live session, then uploads the
// blob to the server, which transcodes it and builds captions. Gated by
// VITE_VIDEO_ENABLED so the audio-only flow is unaffected when off.

export const VIDEO_ENABLED = import.meta.env.VITE_VIDEO_ENABLED === 'true';

export type RecorderStatus = 'idle' | 'recording' | 'uploading' | 'uploaded' | 'error';

type UploadMeta = {
  sessionId: string;
  conversationId: string | null;
  conversationStartMs: number;
  founder: { name: string; email: string; company: string; consentAt: number } | null;
};

function pickMimeType(): string | '' {
  // Order matters: prefer codecs that are cheap for the server to decode.
  // H.264 (mp4) makes the transcode nearly a remux; VP8 decodes far faster than
  // VP9. VP9 is last because 1080p/4K VP9 software decode is what pinned the
  // booth VM's CPU for minutes. Unsupported entries are skipped automatically.
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
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
  const [status, setStatus] = useState<RecorderStatus>('idle');
  // Live camera stream, exposed so /station can render a self-view. Persistent:
  // opened once, reused across founders, torn down only on unmount.
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openedDeviceRef = useRef<string | null>(null);
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

  // Open (or re-open, if the device changed) the persistent camera+mic stream for
  // the live self-view. Idempotent for the same device. Camera failures are
  // swallowed so the self-view just stays hidden.
  const openCamera = useCallback(async () => {
    if (!VIDEO_ENABLED) return;
    if (recorderRef.current) return; // don't disturb an active recording
    if (streamRef.current && openedDeviceRef.current === deviceId) return;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(deviceId),
        audio: true,
      });
      streamRef.current = s;
      openedDeviceRef.current = deviceId;
      setStream(s);
    } catch (err) {
      console.warn('[video] camera open failed', err);
      setStream(null);
    }
  }, [deviceId]);

  // Stop the camera entirely (and any recording). For component unmount.
  const closeCamera = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    openedDeviceRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(async () => {
    if (!VIDEO_ENABLED) return;
    try {
      // Reuse the already-open preview stream; open one if it isn't up yet.
      if (!streamRef.current) {
        const s = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(deviceId),
          audio: true,
        });
        streamRef.current = s;
        openedDeviceRef.current = deviceId;
        setStream(s);
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        streamRef.current,
        mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      recorder.start(1000); // flush in 1s chunks
      recorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setStatus('recording');
    } catch (err) {
      console.warn('[video] recorder failed to start', err);
      setStatus('error');
    }
  }, [deviceId]);

  // Abandon the current recording without uploading (operator restart / discard).
  // Keeps the camera stream alive for the next founder's self-view.
  const discard = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      recorder?.stop();
    } catch {
      /* ignore */
    }
    chunksRef.current = [];
    setStatus('idle');
  }, []);

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

    // Leave the camera stream running for the next founder; just clear chunks.
    chunksRef.current = [];
    if (!blob.size) {
      setStatus('error');
      return;
    }

    const offsetMs = meta.conversationStartMs
      ? meta.conversationStartMs - recordStartRef.current
      : 0;
    const params = new URLSearchParams();
    if (meta.conversationId) params.set('conversationId', meta.conversationId);
    params.set('offsetMs', String(offsetMs));
    if (meta.founder) {
      params.set('name', meta.founder.name);
      params.set('email', meta.founder.email);
      params.set('company', meta.founder.company);
      params.set('consentAt', String(meta.founder.consentAt));
    }

    setStatus('uploading');
    try {
      const res = await fetch(
        `/api/video/${encodeURIComponent(meta.sessionId)}?${params.toString()}`,
        {
          method: 'POST',
          // Plain octet-stream: MediaRecorder's codec-laden mime (e.g.
          // video/webm;codecs=vp9,opus) trips strict content-type parsing.
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob,
        },
      );
      if (res.ok) {
        console.log(`[video] uploaded ${blob.size} bytes for ${meta.sessionId}`);
        setStatus('uploaded');
      } else {
        console.warn('[video] upload rejected', res.status);
        setStatus('error');
      }
    } catch (err) {
      console.warn('[video] upload failed', err);
      setStatus('error');
    }
  }, []);

  return {
    enabled: VIDEO_ENABLED,
    status,
    devices,
    deviceId,
    setDeviceId,
    enumerate,
    openCamera,
    closeCamera,
    stream,
    start,
    stopAndUpload,
    discard,
  };
}
