// Branding placeholder. Swap for real partner logos before the event.
export function Brand({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 text-ink-200 ${className}`}
      aria-label="MongoDB times Google times ElevenLabs"
    >
      <span className="font-bold tracking-tight">MongoDB</span>
      <span className="text-ink-400">&times;</span>
      <span className="font-bold tracking-tight">Google</span>
      <span className="text-ink-400">&times;</span>
      <span className="font-bold tracking-tight">ElevenLabs</span>
    </div>
  );
}
