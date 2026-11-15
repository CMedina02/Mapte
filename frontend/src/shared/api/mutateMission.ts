import { marsApi, MarsApiError } from './client';
import type { Mission } from '../types/contracts';

export async function mutateMission(
    missionId: string,
    fn: () => Promise<Mission>,
    onMission: (m: Mission) => void,
): Promise<string | null> {
    try {
        onMission(await fn());
        return null;
    } catch (e) {
        if (e instanceof MarsApiError && e.status === 409) {
            try {
                const latest = await marsApi.getMission(missionId);
                onMission(latest);
                return `${e.message} Estado recargado (v${latest.mission_version}).`; // el backend dice el motivo del 409
            } catch {
                return 'Conflicto de versión y no se pudo recargar la misión.';
            }
        }
        if (e instanceof MarsApiError && e.status === 503) {
            return 'Servidor no disponible. Se conserva el último estado conocido; reintenta más tarde.';
        }
        if (e instanceof MarsApiError && e.status === 0) return e.message;
        return e instanceof Error ? e.message : String(e);
    }
}
