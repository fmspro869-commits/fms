import { useState } from 'react';
import { RealisticTerrainMap } from '@/components/terrain/RealisticTerrainMap';
import { Btn, Card, SectionTitle } from '@/components/common';
import { useFarm } from '@/store/FarmContext';
import type { Nav } from '@/App';

export default function Terrain3D({
  nav,
  userCenter,
  locationError,
  locationLoading,
  requestLocation,
}: {
  nav: Nav;
  userCenter?: [number, number];
  locationError: string | null;
  locationLoading: boolean;
  requestLocation: () => void;
}) {
  const { state } = useFarm();
  const [fieldId, setFieldId] = useState('');
  const [exaggeration, setExaggeration] = useState(1.3);
  const selectedFieldId = state.fields.some((item) => item.id === fieldId) ? fieldId : '';
  const field = state.fields.find((item) => item.id === selectedFieldId);

  return (
    <div className="space-y-4" data-testid="terrain-3d">
      <SectionTitle
        title="🏔️ Teren 3D"
        sub="Rzeczywiste zdjęcia satelitarne i model wysokościowy DEM — widok orientacyjny, nie pomiar RTK"
        right={field && (
          <Btn onClick={() => nav.go('polowa', field.id)}>
            🚜 Otwórz nawigację Field Pilot
          </Btn>
        )}
      />
      {locationError && <p className="text-xs text-amber-300" role="status">{locationError}</p>}

      <Card className="flex flex-wrap items-end gap-4">
        <label className="min-w-56 flex-1">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Pole</span>
          <select
            value={selectedFieldId}
            onChange={(event) => setFieldId(event.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            aria-label="Wybierz pole do podglądu terenu 3D"
          >
            <option value="">Widok ogólny</option>
            {state.fields.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.area} ha</option>
            ))}
          </select>
        </label>
        <Btn onClick={requestLocation} disabled={locationLoading} variant="outline">
          {locationLoading ? '📍 Szukam lokalizacji…' : userCenter ? '📍 Odśwież lokalizację' : '📍 Pobierz moją lokalizację'}
        </Btn>
        <label className="w-56">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
            Wzmocnienie rzeźby: {exaggeration.toFixed(1)}×
          </span>
          <input
            type="range"
            min="1"
            max="2.5"
            step="0.1"
            value={exaggeration}
            onChange={(event) => setExaggeration(Number(event.target.value))}
            className="w-full accent-emerald-500"
            aria-label="Wzmocnienie rzeźby terenu"
          />
        </label>
      </Card>

      <RealisticTerrainMap field={field} center={field ? undefined : userCenter ?? [19, 52]} exaggeration={exaggeration} />
      {!userCenter && !locationError && (
        <p className="text-xs text-slate-400" role="status">
          Widok ogólny Polski — zezwól na lokalizację, aby wyśrodkować mapę na swoim urządzeniu.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Mapa wymaga połączenia z internetem. Rzeźba pochodzi z Copernicus DEM GLO-30 udostępnianego przez Microsoft Planetary Computer,
        a obraz satelitarny z Esri. Model DSM o rozdzielczości ok. 30 m może uwzględniać roślinność i zabudowę; nie zastępuje pomiarów terenowych.
      </p>
    </div>
  );
}
