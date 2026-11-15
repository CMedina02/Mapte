// Barra deslizante estilo volumen (Material): etiqueta a la izquierda, valor a la derecha
export default function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-space-200">{label}</span>
        <span className="font-medium text-space-50 tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': fill } as React.CSSProperties}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}
