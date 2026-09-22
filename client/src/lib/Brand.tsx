// Partner lockup. The logo files have solid white backgrounds (no transparency),
// so they sit inside one white "lockup bar" — full-colour logos on white, which
// is each brand's primary usage, and it hides the per-logo backgrounds on the
// dark UI. `height` sizes the logos (px); `className` is for layout/margins.
//
// To revert to the text placeholder, restore this file from before the logo
// commit. To later swap in transparent/reverse SVGs, drop the white bar and set
// the <img> src to the SVGs.

const LOGOS = [
  { src: '/logos/mongodb.png', alt: 'MongoDB' },
  { src: '/logos/google-cloud.jpg', alt: 'Google Cloud' },
  { src: '/logos/elevenlabs.png', alt: 'ElevenLabs' },
];

export function Brand({
  className = '',
  height = 24,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-xl bg-white px-4 py-2 ${className}`}
      style={{ paddingTop: height * 0.4, paddingBottom: height * 0.4 }}
      aria-label="MongoDB times Google Cloud times ElevenLabs"
    >
      {LOGOS.map((logo, i) => (
        <div key={logo.alt} className="flex items-center gap-3">
          {i > 0 && (
            <span aria-hidden className="h-6 w-px shrink-0 bg-ink-200" style={{ height }} />
          )}
          <img
            src={logo.src}
            alt={logo.alt}
            style={{ height }}
            className="w-auto object-contain"
          />
        </div>
      ))}
    </div>
  );
}
