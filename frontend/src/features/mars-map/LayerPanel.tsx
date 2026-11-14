import type { Layer } from '../../shared/types/contracts';
import { isImageLayer, type LayerState } from './mapUtils';

interface Props {
  layers: Layer[];
  state: Record<string, LayerState>;
  onChange: (layerId: string, next: LayerState) => void;
}

export default function LayerPanel({ layers, state, onChange }: Props) {
  return (
    <section className="space-y-3">
      <h2 className="eyebrow">Capas</h2>
      {layers.map((l) => {
        const s = state[l.layer_id];
        const supported = isImageLayer(l);
        return (
          <div key={l.layer_id} className="card space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!supported}
                checked={s.visible}
                onChange={(e) => onChange(l.layer_id, { ...s, visible: e.target.checked })}
              />
              {l.title}
            </label>
            {supported ? (
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={s.opacity}
                disabled={!s.visible}
                onChange={(e) => onChange(l.layer_id, { ...s, opacity: Number(e.target.value) })}
                className="mt-2 w-full"
                aria-label={`Opacidad ${l.title}`}
              />
            ) : (
              <p className="mt-1 text-xs text-amber-400">
                Formato no soportado aún (.{l.asset_url.split('.').pop()})
              </p>
            )}
            <p className="mt-1 text-xs text-neutral-500">
              {l.kind} · {l.resolution_m_per_pixel} m/px
            </p>
          </div>
        );
      })}
    </section>
  );
}