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
                return `${e.message} State reloaded (v${latest.mission_version}).`; // el backend dice el motivo del 409
            } catch {
                return 'Version conflict and the mission could not be reloaded.';
            }
        }
        if (e instanceof MarsApiError && e.status === 503) {
            return 'Server unavailable. The last known state is kept; try again later.';
        }
        if (e instanceof MarsApiError && e.status === 0) return e.message;
        return e instanceof Error ? e.message : String(e);
    }
}
