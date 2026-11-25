'use client';
import { useEffect, useState } from 'react';
/** Reads URL query params on the client (static export friendly; no Suspense needed). */
export function useQuery(): URLSearchParams | null {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    const read = () => setQ(new URLSearchParams(window.location.search));
    read();
    window.addEventListener('popstate', read);
    const origPush = history.pushState;
    const t = setInterval(() => { const s = window.location.search; setQ((old) => (old?.toString() === s.slice(1) ? old : new URLSearchParams(s))); }, 300);
    return () => { window.removeEventListener('popstate', read); clearInterval(t); void origPush; };
  }, []);
  return q;
}
