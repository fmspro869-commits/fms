/**
 * Kalibracja wizualna Copernicus DEM GLO-30 (Terrarium).
 * GLO-30 ma krok ~30 m; na polach uprawnych deniwelacja często to 2–15 m,
 * więc surowa rzeźba wygląda płasko. Poniższe współczynniki są tylko do podglądu
 * — nie są poprawką geoidy ani zamiennikiem RTK.
 */

/** MapLibre setTerrain — czytelna rzeźba pola bez „kartonowych” gór. */
export const DEM_MAP_EXAGGERATION = 1.85;

/** Hillshade nad DEM — światłocienie skarp i zagłębień. */
export const DEM_HILLSHADE_EXAGGERATION = 0.62;

/** Siatka Three.js (Field Pilot TRACTOR) — lekko mocniejsza niż mapa. */
export const DEM_MESH_EXAGGERATION = 2.05;

/** Adaptive boost gdy pole jest prawie płaskie (zakres wysokości w metrach). */
export function adaptiveMeshExaggeration(elevationRangeM: number): number {
  if (!Number.isFinite(elevationRangeM) || elevationRangeM <= 0) return DEM_MESH_EXAGGERATION;
  if (elevationRangeM < 6) return 2.6;
  if (elevationRangeM < 15) return DEM_MESH_EXAGGERATION;
  if (elevationRangeM > 45) return 1.35;
  return DEM_MESH_EXAGGERATION;
}

export function decodeTerrariumMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}
