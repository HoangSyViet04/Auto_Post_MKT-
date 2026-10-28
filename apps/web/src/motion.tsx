import { type ReactNode, useEffect, useState } from 'react';

/** Listen to changes too: resizing or changing the OS preference must take effect without reloading. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Animate height through grid rows. Closed content is inert immediately; optional state survives collapse. */
export function Collapse({ open, children, id, className = '', keepMounted = false }: {
  open: boolean; children: ReactNode; id?: string; className?: string; keepMounted?: boolean;
}) {
  const [present, setPresent] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
      if (reduced) setExpanded(true);
      else frame = requestAnimationFrame(() => setExpanded(true));
    } else {
      setExpanded(false);
      if (reduced) setPresent(false);
      else timer = setTimeout(() => setPresent(false), 260);
    }
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [open, reduced]);
  return <div id={id} className={`motion-collapse${expanded ? ' is-expanded' : ''} ${className}`} aria-hidden={!open} inert={!open}>
    <div className="motion-clip">{(keepMounted || open || present) && children}</div>
  </div>;
}

/** CSS cannot override an explicit JS smooth-scroll request, so respect reduced motion here as well. */
export function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}
