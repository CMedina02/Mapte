// Genera el heightmap .f32 del escenario mock (como lo exportará el pipeline del backend).
// Ejecutar desde frontend/ cuando cambie el terreno sintético:
//   node scripts/gen-mock-terrain.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { HEIGHTMAP_URL, sectorHeightmap } from '../src/shared/api/mocks/monteSharp.ts';

const hm = sectorHeightmap();
const out = `public${HEIGHTMAP_URL}`;
mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
// Float32 little-endian, row-major, sin header (contrato terrain)
const buf = Buffer.alloc(hm.data.length * 4);
hm.data.forEach((v, i) => buf.writeFloatLE(v, i * 4));
writeFileSync(out, buf);
console.log(`${out}: ${hm.width}×${hm.height}, ${buf.length} bytes, z ${hm.min.toFixed(1)}..${hm.max.toFixed(1)} m`);
