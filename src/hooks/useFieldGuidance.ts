import { useMemo } from 'react';
import type { GuidanceGeometry, GuidanceLine, GuidanceQuality } from '@/geometry/guidance';
import { classifyDeviation, distanceToLineEnd, nearestLine } from '@/geometry/guidance';
import type { GpsFix } from './useGps';

export interface GuidanceInfo {
  activeLine: GuidanceLine | null;
  activeIndex: number; // pozycja L (1-based) lub 0
  xte: number; // odchylenie [m]; >0 = skręć w prawo
  steer: 'left' | 'right' | 'center';
  quality: GuidanceQuality;
  distanceToEnd: number; // m
}

/** Wyznacza aktywną linię i odchylenie na podstawie pozycji GPS. Ciężkie obliczenia memoizowane. */
export function useFieldGuidance(
  geometry: GuidanceGeometry | null,
  fix: GpsFix | null,
  offsetCorr: number,
): GuidanceInfo {
  return useMemo<GuidanceInfo>(() => {
    if (!geometry || !fix || geometry.lines.length === 0) {
      return { activeLine: null, activeIndex: 0, xte: 0, steer: 'center', quality: 'ideal', distanceToEnd: Infinity };
    }
    const { line, xte } = nearestLine({ lat: fix.lat, lng: fix.lng }, geometry, offsetCorr);
    const quality = classifyDeviation(xte);
    const steer: GuidanceInfo['steer'] = Math.abs(xte) <= 0.05 ? 'center' : xte > 0 ? 'right' : 'left';
    const distanceToEnd = line ? distanceToLineEnd({ lat: fix.lat, lng: fix.lng }, geometry, line) : Infinity;
    const activeIndex = line ? geometry.lines.indexOf(line) + 1 : 0;
    return { activeLine: line, activeIndex, xte, steer, quality, distanceToEnd };
  }, [geometry, fix, offsetCorr]);
}
