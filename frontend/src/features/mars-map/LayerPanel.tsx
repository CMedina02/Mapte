import type { Layer, LayerKind } from '../../shared/types/contracts';
import Slider from '../../shared/ui/Slider';
import { isImageLayer, type LayerState } from './mapUtils';

interface Props {
  layers: Layer[];
  state: Record<string, LayerState>;
  onChange: (layerId: string, next: LayerState) => void;
}

const KIND: Record<LayerKind, string> = {
  optical: 'Imagery',
  topographic: 'Relief',
  geologic: 'Geology',
  thermal: 'Temperature',
  spectral: 'Mineralogy',
  other: 'Layer',
};

export default function LayerPanel({ layers, state, onChange }: Props) {
  return (
    <section className="space-y-2 text-sm">
      <h2 className="eyebrow">Map layers</h2>
      <ul className="card space-y-0 p-0">
        {layers.map((l, i) => {
          const s = state[l.layer_id];
          const supported = isImageLayer(l);
          return (
            <li key={l.layer_id} className={`space-y-3 px-4 py-3 ${i ? 'border-t border-space-800' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-space-50">{l.title.split(' (')[0]}</span>
                  <span className="block text-xs text-space-400">
                    {KIND[l.kind] ?? 'Layer'} · {l.resolution_m_per_pixel} m per pixel
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.visible}
                  aria-label={`Show ${l.title}`}
                  disabled={!supported}
                  onClick={() => onChange(l.layer_id, { ...s, visible: !s.visible })}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${s.visible ? 'bg-primary-600' : 'bg-space-700'}`}
                >
                  <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${s.visible ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {supported && s.visible && (
                <Slider
                  label="Opacity"
                  value={Math.round(s.opacity * 100)}
                  min={0}
                  max={100}
                  step={5}
                  display={`${Math.round(s.opacity * 100)} %`}
                  onChange={(v) => onChange(l.layer_id, { ...s, opacity: v / 100 })}
                />
              )}
              {!supported && <p className="text-xs text-space-400">Format not yet supported on the map.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
