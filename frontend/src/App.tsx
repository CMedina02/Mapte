import { useEffect, useState } from 'react';
import { marsApi } from './shared/api/client';
import type { Region } from './shared/types/contracts';

export default function App() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marsApi.getRegions().then(setRegions).catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="p-6 font-mono">
      <h1 className="text-xl">Mars EVA — smoke test FE-01</h1>
      {error && <p className="text-red-500">{error}</p>}
      <ul>
        {regions.map((r) => (
          <li key={r.region_id}>{r.name}</li>
        ))}
      </ul>
    </main>
  );
}