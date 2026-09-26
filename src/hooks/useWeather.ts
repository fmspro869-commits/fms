import { useEffect, useState } from 'react';
import type { Field, WeatherDay } from '@/types';
import { WEATHER_FORECAST } from '@/data/demo';

export type WeatherSource = 'live' | 'demo';

export interface WeatherResult {
  days: WeatherDay[];
  today: WeatherDay;
  source: WeatherSource;
  loading: boolean;
  error: string | null;
  place: [number, number];
}

/** Środek ciężkości pierwszego pola z geometrią (fallback: okolice Włocławka/Borka). */
export function centroid(fields: Pick<Field, 'geo'>[]): [number, number] {
  for (const f of fields) {
    if (f.geo && f.geo.length >= 3) {
      const lat = f.geo.reduce((a, p) => a + p[0], 0) / f.geo.length;
      const lng = f.geo.reduce((a, p) => a + p[1], 0) / f.geo.length;
      return [lat, lng];
    }
  }
  return [52.648, 19.067];
}

export function fieldCentroid(field?: Pick<Field, 'geo'>): [number, number] {
  if (field && field.geo && field.geo.length >= 3) return centroid([field]);
  return [52.648, 19.067];
}

/** Mapowanie kodów pogody WMO (Open-Meteo) na ikonę i opis PL. */
function wmo(code: number): { icon: string; desc: string } {
  if (code === 0) return { icon: '☀️', desc: 'Słonecznie' };
  if (code === 1) return { icon: '🌤️', desc: 'Przeważnie słonecznie' };
  if (code === 2) return { icon: '⛅', desc: 'Częściowe zachmurzenie' };
  if (code === 3) return { icon: '☁️', desc: 'Zachmurzenie' };
  if (code === 45 || code === 48) return { icon: '🌫️', desc: 'Mgła' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', desc: 'Mżawka' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', desc: 'Deszcz' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', desc: 'Śnieg' };
  if (code >= 80 && code <= 82) return { icon: '🌦️', desc: 'Przelotne opady' };
  if (code >= 85 && code <= 86) return { icon: '🌨️', desc: 'Opady śniegu' };
  if (code >= 95) return { icon: '⛈️', desc: 'Burze' };
  return { icon: '🌡️', desc: 'Zmienne warunki' };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Pobiera realną prognozę z Open-Meteo (bez klucza API). Fallback do danych DEMO przy błędzie/offline. */
export function useWeather(lat: number, lng: number): WeatherResult {
  const [state, setState] = useState<WeatherResult>({
    days: WEATHER_FORECAST,
    today: WEATHER_FORECAST[0],
    source: 'demo',
    loading: true,
    error: null,
    place: [lat, lng],
  });

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const demo = () => !cancelled && setState({ days: WEATHER_FORECAST, today: WEATHER_FORECAST[0], source: 'demo', loading: false, error: 'Brak połączenia — dane demonstracyjne', place: [lat, lng] });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) { demo(); return; }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max`
      + `&hourly=relative_humidity_2m`
      + `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation`
      + `&wind_speed_unit=ms&timezone=auto&forecast_days=7`;

    fetch(url, { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const d = data.daily;
        if (!d || !Array.isArray(d.time)) throw new Error('Brak danych daily');
        const humByDay: Record<string, number[]> = {};
        const ht: string[] = data.hourly?.time || [];
        const hh: number[] = data.hourly?.relative_humidity_2m || [];
        ht.forEach((t: string, i: number) => { const day = t.slice(0, 10); (humByDay[day] ||= []).push(hh[i]); });

        const days: WeatherDay[] = d.time.map((date: string, i: number) => {
          const meta = wmo(d.weather_code[i]);
          const hums = humByDay[date] || [];
          const humidity = hums.length ? Math.round(hums.reduce((a, b) => a + b, 0) / hums.length) : 60;
          return {
            date,
            temp: Math.round(d.temperature_2m_max[i]),
            tempMin: Math.round(d.temperature_2m_min[i]),
            humidity,
            wind: round1(d.wind_speed_10m_max[i]),
            gusts: round1(d.wind_gusts_10m_max[i]),
            rain: round1(d.precipitation_sum[i]),
            icon: meta.icon,
            desc: meta.desc,
          };
        });
        const cur = data.current;
        if (cur && days[0]) {
          days[0] = { ...days[0], temp: Math.round(cur.temperature_2m), humidity: Math.round(cur.relative_humidity_2m), wind: round1(cur.wind_speed_10m), icon: wmo(cur.weather_code).icon, desc: wmo(cur.weather_code).desc };
        }
        setState({ days, today: days[0], source: 'live', loading: false, error: null, place: [lat, lng] });
      })
      .catch((e) => { if (e.name !== 'AbortError') demo(); });

    return () => { cancelled = true; ctrl.abort(); };
  }, [lat, lng]);

  return state;
}

/** Ocena okna zabiegowego na podstawie parametrów pogody. */
export function sprayVerdict(d: WeatherDay): { tone: 'ok' | 'warn' | 'bad'; label: string; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (d.wind > 4) { score += 2; reasons.push(`Wiatr ${d.wind} m/s — zbyt silny (limit 4 m/s, ryzyko znoszenia cieczy)`); }
  else if (d.wind > 2.5) { score += 1; reasons.push(`Wiatr ${d.wind} m/s — graniczny, opryskuj przy niskim ciśnieniu`); }
  else reasons.push(`Wiatr ${d.wind} m/s — korzystny`);
  if (d.gusts > 8) { score += 2; reasons.push(`Porywy do ${d.gusts} m/s — niebezpieczne znoszenie`); }
  if (d.temp > 25) { score += 1; reasons.push(`Temperatura ${d.temp}°C — ryzyko parowania kropli (pracuj rano/wieczorem)`); }
  if (d.temp < 5) { score += 2; reasons.push(`Za zimno (${d.temp}°C)`); }
  if (d.rain > 0) { score += 2; reasons.push(`Opady ${d.rain} mm — oprysk zostanie zmyty`); }
  if (d.humidity < 50) { score += 1; reasons.push(`Niska wilgotność ${d.humidity}% — szybkie wysychanie kropli`); }
  if (d.humidity > 85) { score += 1; reasons.push(`Bardzo wysoka wilgotność ${d.humidity}% — ryzyko infekcji grzybowych`); }
  if (score === 0) reasons.push('Wszystkie parametry w optymalnym zakresie');
  return score >= 3 ? { tone: 'bad', label: 'WARUNKI NIEKORZYSTNE', reasons } : score >= 1 ? { tone: 'warn', label: 'WARUNKI WARUNKOWE', reasons } : { tone: 'ok', label: 'WARUNKI DOBRE', reasons };
}
