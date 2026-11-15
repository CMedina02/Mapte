import { useState } from 'react';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import type { ContingencyType, Mission } from '../../shared/types/contracts';
import { missionRoute } from '../../shared/mission';
import { useOnline } from '../offline-sync/offline';

const TYPES: Record<ContingencyType, string> = {
    oxygen_reduced: 'Reducción de O₂',
    rover_unavailable: 'Rover no disponible',
};

interface Props {
    mission: Mission;
    onMission: (m: Mission) => void;
}

export default function ContingencyPanel({ mission, onMission }: Props) {
    const [type, setType] = useState<ContingencyType>('oxygen_reduced');
    const [pointIdx, setPointIdx] = useState(0);
    const [oxygen, setOxygen] = useState(mission.resources.oxygen_available_min);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const online = useOnline();

    const path = missionRoute(mission).path;
    const idx = Math.min(pointIdx, path.length - 1);
    const position = path[idx];
    const invalid = !position || Number.isNaN(oxygen) || oxygen < 0;

    async function trigger() {
        if (invalid) return;
        setLoading(true);
        setError(
            await mutateMission(
                mission.mission_id,
                () =>
                    marsApi.triggerContingency(mission.mission_id, {
                        mission_version: mission.mission_version,
                        contingency_type: type,
                        position,
                        oxygen_available_min: oxygen,
                    }),
                onMission,
            ),
        );
        setLoading(false);
    }

    return (
        <section className="card border-alert-900">
            <p className="eyebrow text-alert-400">Simulador de contingencias</p>

            <select
                className="field"
                value={type}
                onChange={(e) => setType(e.target.value as ContingencyType)}
            >
                {Object.entries(TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                        {label}
                    </option>
                ))}
            </select>

            <label className="block text-sm">
                Posición simulada sobre la ruta (no hay GPS en Marte)
                <select
                    className="field mt-1"
                    value={idx}
                    onChange={(e) => setPointIdx(Number(e.target.value))}
                >
                    {path.map((p, i) => (
                        <option key={i} value={i}>
                            Punto {i + 1} · ({p.x_m}, {p.y_m}) m
                        </option>
                    ))}
                </select>
            </label>

            <label className="flex items-center justify-between text-sm">
                <span>O₂ disponible tras el evento (min)</span>
                <input
                    type="number"
                    min={0}
                    className="field w-24 text-right"
                    value={Number.isNaN(oxygen) ? '' : oxygen}
                    onChange={(e) => setOxygen(e.target.valueAsNumber)}
                />
            </label>

            {error && <p className="text-sm text-alert-500">{error}</p>}
            {!online && <p className="text-sm text-amber-400">Requiere conexión: el retorno lo evalúa el servidor.</p>}
            <button
                type="button"
                onClick={trigger}
                disabled={invalid || loading || !online} className="btn-danger w-full"
            >
                {loading ? 'Evaluando retorno…' : 'Disparar contingencia'}
            </button>
        </section>
    );
}
