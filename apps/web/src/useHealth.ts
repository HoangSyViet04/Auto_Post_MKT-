import { useEffect, useState } from 'react';
import type { HealthResponse } from '#domain';
import { apiFetch } from './api.ts';

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error'; message: string };

const POLL_MS = 10_000;

/** Polling /api/health để biết server cục bộ còn chạy. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/api/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setState({ kind: 'ok', data });
      } catch (error) {
        if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
