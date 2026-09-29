import { useLayoutEffect, useRef, type ReactNode } from 'react';

// Shrink-to-fit text for fixed-size display screens (the audience TV). Fills its
// container, starts at maxPx, and steps the font size down until the content no
// longer overflows the container — so short roasts stay big and long ones shrink
// to fit instead of getting clipped. Re-fits when `refitKey` changes or on resize.
export function FitText({
  children,
  maxPx,
  minPx,
  refitKey,
  className = '',
}: {
  children: ReactNode;
  maxPx: number;
  minPx: number;
  refitKey?: unknown; // change this (e.g. the text) to trigger a re-fit
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    const fit = () => {
      let size = maxPx;
      inner.style.fontSize = `${size}px`;
      let guard = 0;
      while (
        size > minPx &&
        guard++ < 200 &&
        (inner.scrollHeight > wrap.clientHeight || inner.scrollWidth > wrap.clientWidth)
      ) {
        size -= 2;
        inner.style.fontSize = `${size}px`;
      }
    };

    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [maxPx, minPx, refitKey]);

  return (
    <div ref={wrapRef} className="flex h-full w-full items-center overflow-hidden">
      <div ref={innerRef} className={className}>
        {children}
      </div>
    </div>
  );
}
