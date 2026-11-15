frontend/
├── docs/                        # Documentación existente
└── src/
    ├── app/                     # Shell principal, estado global de misión, layout y switch de modos
    │   ├── App.tsx
    │   └── MissionContext.tsx   # Guarda Mission activa, mission_version y estado Online/Offline
    ├── features/
    │   ├── mars-map/            # [FE-02, FE-04] Proyección cartesiana OpenLayers, capas y polilíneas
    │   │   ├── components/
    │   │   ├── hooks/
    │   │   └── utils/marsProjection.ts
    │   ├── mission-control/     # [FE-03] Selector de región, objetivos, cálculo de ruta y plan
    │   │   ├── components/
    │   │   └── hooks/
    │   ├── explorer/            # [FE-05, FE-06, FE-08] Tableta táctil, fotos POV, observaciones, contingencias y HUD
    │   │   ├── components/
    │   │   └── hooks/
    │   ├── terrain-3d/          # [FE-09] Vista 3D inclinada (Three.js) con terreno, ruta y HUD encima
    │   └── offline-sync/        # [FE-07] Descarga de package, IndexedDB/localStorage y cola pendiente
    │       ├── components/
    │       └── services/storage.ts
    └── shared/
        ├── api/                 # [FE-01] Cliente HTTP con manejo 409/503 y mockAdapter
        │   ├── client.ts
        │   ├── mockAdapter.ts
        │   └── mocks/           # JSONs espejo de contracts/examples/
        ├── types/               # [FE-01] Contratos estrictos en snake_case
        │   └── contracts.ts
        └── ui/                  # Componentes atómicos (Badges de evidencia, Banner de supuestos, Alertas)