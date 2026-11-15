// /api/v1/sim siempre usa el backend, que controla el desvío y el recálculo.
import type { Position, RouteResult } from '../types/contracts';

export type SimStatus = 'following' | 'drifting' | 'arrived' | 'stopped';
export type SimAction = 'none' | 'warn' | 'rerouted' | 'arrived' | 'stop';

export interface SimEvent {
  t_s: number;
  event_type: string;
  message: string;
  x_m: number;
  y_m: number;
}

export interface SimState {
  sim_id: string;
  simulated: true;
  status: SimStatus;
  action: SimAction;
  message: string;
  t_s: number;
  speed_factor: number;
  position: Position;
  heading_deg: number;
  progress_m: number;
  remaining_m: number | null;
  eta_min: number | null;
  on_route: boolean;
  deviation_m: number;
  thresholds: { warn_m: number; reroute_m: number };
  destination: Position;
  route: RouteResult;
  original_route_id: string;
  route_version: number;
  reroute_count: number;
  log: SimEvent[];
}

export interface SimCreate {
  speed_factor?: number;
  deviation?: { at_fraction?: number; side?: 'left' | 'right'; angle_deg?: number } | null;
}

const BASE = '/api/v1/sim';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail ?? b?.message).catch(() => null);
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const simApi = {
  create: (req: SimCreate = {}) => call<SimState>('', { method: 'POST', body: JSON.stringify(req) }),
  step: (simId: string, dtS = 1) =>
    call<SimState>(`/${encodeURIComponent(simId)}/step`, { method: 'POST', body: JSON.stringify({ dt_s: dtS }) }),
  remove: (simId: string) => call<void>(`/${encodeURIComponent(simId)}`, { method: 'DELETE' }),
};
