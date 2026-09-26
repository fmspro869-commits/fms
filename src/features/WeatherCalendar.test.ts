import { describe, expect, it } from 'vitest';
import { generateWeatherCalendar } from './WeatherCalendar';

const day = {
  date: Date.UTC(2026, 7, 6, 12) / 1000,
  tempMin: 14,
  tempMax: 22,
  rainfall: 0,
  rainfallProbability: 0,
  windSpeed: 2,
  windGust: 4,
  humidity: 60,
  pressure: 1013,
  cloudCover: 10,
};

describe('generateWeatherCalendar', () => {
  it('identifies suitable operation windows and preserves the location', () => {
    const calendar = generateWeatherCalendar([day], { lat: 52, lng: 19 });

    expect(calendar.location).toEqual({ lat: 52, lng: 19 });
    expect(calendar.days[0].suitability.spraying).toBe('EXCELLENT');
    expect(calendar.days[0].suitability.sowing).toBe('EXCELLENT');
    expect(calendar.bestDays.spraying?.dateStr).toBe('2026-08-06');
  });

  it('flags adverse weather and does not recommend spraying', () => {
    const calendar = generateWeatherCalendar([{
      ...day,
      tempMin: -6,
      tempMax: 36,
      rainfall: 42,
      windSpeed: 12,
      windGust: 31,
    }], { lat: 52, lng: 19 });

    expect(calendar.days[0].suitability.spraying).toBe('UNSUITABLE');
    expect(calendar.bestDays.spraying).toBeUndefined();
    expect(calendar.alerts.some((alert) => alert.type === 'FROST' && alert.severity === 'CRITICAL')).toBe(true);
    expect(calendar.alerts.some((alert) => alert.type === 'HEAVY_RAIN' && alert.severity === 'CRITICAL')).toBe(true);
  });
});
