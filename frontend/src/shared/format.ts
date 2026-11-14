
export const fmt = (v: number | null | undefined, unit: string) =>
  v == null ? 'Desconocido' : `${v} ${unit}`;