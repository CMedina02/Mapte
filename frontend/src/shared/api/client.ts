import type {
  Region,
  RegionManifest,
  ScienceObjective,
  PhotoReference,
  RouteResult,
  Mission,
  LocalMarsPosition,
  ApiErrorResponse,
} from '../types/contracts';
import {
  MOCK_REGIONS,
  MOCK_MANIFEST,
  MOCK_OBJECTIVES,
  MOCK_PHOTOS,
  MOCK_ROUTE,
  MOCK_MISSION,
} from './mocks/tharsisMock';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const BASE_URL = '/api/v1';

let currentMockMission: Mission = structuredClone(MOCK_MISSION);

export class MarsApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MarsApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    let errPayload: ApiErrorResponse | null = null;
    try {
      errPayload = await res.json();
    } catch {
      // Fallback si no es JSON
    }
    throw new MarsApiError(
      res.status,
      errPayload?.error?.code || `HTTP_${res.status}`,
      errPayload?.error?.message || res.statusText,
      errPayload?.error?.details
    );
  }

  return res.json() as Promise<T>;
}

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export const marsApi = {
  async getRegions(): Promise<Region[]> {
    if (USE_MOCK) {
      await delay();
      return MOCK_REGIONS;
    }
    return request<Region[]>('/regions');
  },

  async getRegionManifest(regionId: string): Promise<RegionManifest> {
    if (USE_MOCK) {
      await delay();
      return MOCK_MANIFEST;
    }
    return request<RegionManifest>(`/regions/${regionId}/manifest`);
  },

  async getRegionObjectives(regionId: string): Promise<ScienceObjective[]> {
    if (USE_MOCK) {
      await delay();
      return MOCK_OBJECTIVES;
    }
    return request<ScienceObjective[]>(`/regions/${regionId}/objectives`);
  },

  async getRegionPhotos(regionId: string, objectiveId?: string): Promise<PhotoReference[]> {
    if (USE_MOCK) {
      await delay();
      return objectiveId
        ? MOCK_PHOTOS.filter((p) => p.objective_id === objectiveId)
        : MOCK_PHOTOS;
    }
    const query = objectiveId ? `?objective_id=${encodeURIComponent(objectiveId)}` : '';
    return request<PhotoReference[]>(`/regions/${regionId}/photos${query}`);
  },

  async computeRoute(payload: {
    region_id: string;
    start: LocalMarsPosition;
    end: LocalMarsPosition;
    constraints: { max_slope_deg: number; speed_m_per_min: number; avoid_unknown: boolean };
  }): Promise<RouteResult> {
    if (USE_MOCK) {
      await delay(400);
      return MOCK_ROUTE;
    }
    return request<RouteResult>('/routes/compute', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async planMission(payload: {
    region_id: string;
    base_position: LocalMarsPosition;
    objective_ids: string[];
    constraints: { max_slope_deg: number; speed_m_per_min: number; avoid_unknown: boolean };
    resources: { oxygen_available_min: number; return_reserve_min: number };
  }): Promise<Mission> {
    if (USE_MOCK) {
      await delay(400);
      currentMockMission = structuredClone(MOCK_MISSION);
      return currentMockMission;
    }
    return request<Mission>('/missions/plan', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getMission(missionId: string): Promise<Mission> {
    if (USE_MOCK) {
      await delay();
      return currentMockMission;
    }
    return request<Mission>(`/missions/${missionId}`);
  },

  async submitObservation(
    missionId: string,
    payload: {
      mission_version: number;
      objective_id: string;
      finding_code: string;
      notes: string;
    }
  ): Promise<Mission> {
    if (USE_MOCK) {
      await delay(350);
      if (payload.mission_version !== currentMockMission.version) {
        throw new MarsApiError(409, 'VERSION_CONFLICT', 'Versión de misión desactualizada.');
      }
      currentMockMission = {
        ...currentMockMission,
        version: currentMockMission.version + 1,
        completed_objective_ids: [...currentMockMission.completed_objective_ids, payload.objective_id],
        next_objective_id: 'obj-tharsis-02',
        decision_log: [
          ...currentMockMission.decision_log,
          {
            timestamp: new Date().toISOString(),
            step: 'OBSERVATION_RECORDED',
            reason: `Hallazgo ${payload.finding_code} registrado en ${payload.objective_id}. Continuando hacia Graben Norte.`,
          },
        ],
      };
      return currentMockMission;
    }
    return request<Mission>(`/missions/${missionId}/observations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async triggerContingency(
    missionId: string,
    payload: {
      mission_version: number;
      contingency_type: string;
      position: LocalMarsPosition;
      oxygen_available_min?: number;
    }
  ): Promise<Mission> {
    if (USE_MOCK) {
      await delay(400);
      if (payload.mission_version !== currentMockMission.version) {
        throw new MarsApiError(409, 'VERSION_CONFLICT', 'Versión de misión desactualizada.');
      }
      currentMockMission = {
        ...currentMockMission,
        version: currentMockMission.version + 1,
        status: 'contingency',
        resources: {
          ...currentMockMission.resources,
          oxygen_available_min: payload.oxygen_available_min ?? 75,
        },
        // Recorta ruta de regreso directo a la base
        route: {
          ...currentMockMission.route,
          path: [payload.position, currentMockMission.base_position],
          distance_m: 620,
          duration_min: 31,
          warnings: ['RUTA DE CONTINGENCIA ACTIVA: Retorno inmediato a hábitat.'],
        },
        alerts: [
          {
            alert_id: `al-cont-${Date.now()}`,
            severity: 'critical',
            code: payload.contingency_type.toUpperCase(),
            message: 'Contingencia crítica detectada. Objetivos secundarios cancelados; ruta de retorno trazada.',
          },
        ],
        decision_log: [
          ...currentMockMission.decision_log,
          {
            timestamp: new Date().toISOString(),
            step: 'CONTINGENCY_REPLAN',
            reason: `Evento ${payload.contingency_type}. Margen de retorno ajustado a reserva mínima de seguridad.`,
          },
        ],
      };
      return currentMockMission;
    }
    return request<Mission>(`/missions/${missionId}/contingencies`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getMissionPackage(missionId: string): Promise<{ mission: Mission; manifest: RegionManifest; objectives: ScienceObjective[]; photos: PhotoReference[] }> {
    if (USE_MOCK) {
      await delay(300);
      return {
        mission: currentMockMission,
        manifest: MOCK_MANIFEST,
        objectives: MOCK_OBJECTIVES,
        photos: MOCK_PHOTOS,
      };
    }
    return request(`/missions/${missionId}/package`);
  },
};