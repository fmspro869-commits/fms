// FMS 3.0 — FARM OS
// FEATURE 2: WEATHER CALENDAR
// Inteligentny kalendarz pogodowy dla zabiegów

// ============================================
// TYPES
// ============================================

export interface WeatherDay {
  date: number;                // timestamp
  dateStr: string;             // "2025-09-25"

  // Pogoda
  tempMin: number;             // °C
  tempMax: number;
  tempAvg: number;
  rainfall: number;            // mm
  rainfallProbability: number; // %
  windSpeed: number;           // m/s
  windGust: number;            // m/s
  humidity: number;            // %
  pressure: number;            // hPa
  cloudCover: number;          // %

  // Jakość dla zabiegów
  suitability: {
    spraying: SuitabilityLevel;
    sowing: SuitabilityLevel;
    fertilizing: SuitabilityLevel;
    harvesting: SuitabilityLevel;
    soilWork: SuitabilityLevel;
  };

  // Szczegóły
  issues: string[];            // dlaczego nieodpowiedni
  recommendations: string[];   // sugestie
}

export type SuitabilityLevel = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'UNSUITABLE';

export interface WeatherCalendar {
  generatedAt: number;
  location: { lat: number; lng: number };
  days: WeatherDay[];

  // Najlepsze dni
  bestDays: {
    spraying?: WeatherDay;
    sowing?: WeatherDay;
    harvesting?: WeatherDay;
  };

  // Alerty
  alerts: WeatherAlert[];
}

export interface WeatherForecastDay {
  date: number;
  tempMin: number;
  tempMax: number;
  rainfall: number;
  rainfallProbability: number;
  windSpeed: number;
  windGust: number;
  humidity: number;
  pressure: number;
  cloudCover: number;
}

export interface WeatherAlert {
  type: 'FROST' | 'HEAT' | 'STORM' | 'HEAVY_RAIN' | 'DROUGHT' | 'WIND';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  date: number;
  message: string;
}

// ============================================
// SUITABILITY RULES
// ============================================

interface SuitabilityRule {
  maxRainfall: number;         // mm
  maxWindSpeed: number;        // m/s
  minTemp: number;             // °C
  maxTemp: number;
  maxHumidity?: number;
  minHumidity?: number;
  requiresDryDays: number;     // ile dni bez deszczu przed
}

const SPRAYING_RULE: SuitabilityRule = {
  maxRainfall: 0.5,
  maxWindSpeed: 5,
  minTemp: 10,
  maxTemp: 25,
  maxHumidity: 85,
  requiresDryDays: 0,
};

const SOWING_RULE: SuitabilityRule = {
  maxRainfall: 5,
  maxWindSpeed: 10,
  minTemp: 5,
  maxTemp: 30,
  requiresDryDays: 1,
};

const FERTILIZING_RULE: SuitabilityRule = {
  maxRainfall: 2,
  maxWindSpeed: 8,
  minTemp: 5,
  maxTemp: 28,
  requiresDryDays: 0,
};

const HARVESTING_RULE: SuitabilityRule = {
  maxRainfall: 0,
  maxWindSpeed: 12,
  minTemp: 0,
  maxTemp: 35,
  maxHumidity: 70,
  requiresDryDays: 2,
};

const SOIL_WORK_RULE: SuitabilityRule = {
  maxRainfall: 3,
  maxWindSpeed: 15,
  minTemp: 0,
  maxTemp: 35,
  requiresDryDays: 1,
};

// ============================================
// WEATHER CALENDAR ENGINE
// ============================================

export function generateWeatherCalendar(
  forecast: WeatherForecastDay[],
  location: { lat: number; lng: number }
): WeatherCalendar {
  const days: WeatherDay[] = forecast.map((day, index) => {
    const prevDays = forecast.slice(0, index);
    return analyzeDay(day, prevDays);
  });

  // Znajdź najlepsze dni
  const bestSpraying = days
    .filter(d => d.suitability.spraying === 'EXCELLENT')
    .sort((a, b) => a.rainfall - b.rainfall)[0];

  const bestSowing = days
    .filter(d => d.suitability.sowing === 'EXCELLENT')
    .sort((a, b) => b.tempAvg - a.tempAvg)[0];

  const bestHarvesting = days
    .filter(d => d.suitability.harvesting === 'EXCELLENT')
    .sort((a, b) => a.humidity - b.humidity)[0];

  // Generuj alerty
  const alerts = generateWeatherAlerts(days);

  return {
    generatedAt: Date.now(),
    location,
    days,
    bestDays: {
      spraying: bestSpraying,
      sowing: bestSowing,
      harvesting: bestHarvesting,
    },
    alerts,
  };
}

function analyzeDay(day: WeatherForecastDay, prevDays: WeatherForecastDay[]): WeatherDay {
  const date = new Date(day.date * 1000);

  // Oblicz suity
  const spraying = calculateSuitability(day, SPRAYING_RULE, prevDays);
  const sowing = calculateSuitability(day, SOWING_RULE, prevDays);
  const fertilizing = calculateSuitability(day, FERTILIZING_RULE, prevDays);
  const harvesting = calculateSuitability(day, HARVESTING_RULE, prevDays);
  const soilWork = calculateSuitability(day, SOIL_WORK_RULE, prevDays);

  // Zbierz problemy
  const issues: string[] = [];
  if (day.rainfall > 5) issues.push(`Opady ${day.rainfall}mm`);
  if (day.windSpeed > 10) issues.push(`Silny wiatr ${day.windSpeed}m/s`);
  if (day.tempMax > 30) issues.push(`Upał ${day.tempMax}°C`);
  if (day.tempMin < 5) issues.push(`Przymrozek ${day.tempMin}°C`);

  // Rekomendacje
  const recommendations: string[] = [];
  if (spraying.level === 'EXCELLENT') {
    recommendations.push('✅ Idealny dzień na oprysk');
  }
  if (sowing.level === 'EXCELLENT') {
    recommendations.push('✅ Dobre warunki do siewu');
  }
  if (harvesting.level === 'EXCELLENT') {
    recommendations.push('✅ Optymalny dzień na żniwa');
  }

  return {
    date: day.date * 1000,
    dateStr: date.toISOString().split('T')[0],
    tempMin: day.tempMin,
    tempMax: day.tempMax,
    tempAvg: (day.tempMin + day.tempMax) / 2,
    rainfall: day.rainfall || 0,
    rainfallProbability: day.rainfallProbability || 0,
    windSpeed: day.windSpeed || 0,
    windGust: day.windGust || 0,
    humidity: day.humidity || 0,
    pressure: day.pressure || 0,
    cloudCover: day.cloudCover || 0,
    suitability: {
      spraying: spraying.level,
      sowing: sowing.level,
      fertilizing: fertilizing.level,
      harvesting: harvesting.level,
      soilWork: soilWork.level,
    },
    issues,
    recommendations,
  };
}

function calculateSuitability(
  day: WeatherForecastDay,
  rule: SuitabilityRule,
  prevDays: WeatherForecastDay[]
): { level: SuitabilityLevel; score: number; issues: string[] } {
  let score = 100;
  const issues: string[] = [];
  const tempAvg = (day.tempMin + day.tempMax) / 2;

  // Opady
  if (day.rainfall > rule.maxRainfall) {
    score -= Math.min(50, (day.rainfall - rule.maxRainfall) * 10);
    issues.push(`Opady ${day.rainfall}mm > ${rule.maxRainfall}mm`);
  }

  // Wiatr
  if (day.windSpeed > rule.maxWindSpeed) {
    score -= Math.min(40, (day.windSpeed - rule.maxWindSpeed) * 8);
    issues.push(`Wiatr ${day.windSpeed}m/s > ${rule.maxWindSpeed}m/s`);
  }

  // Temperatura
  if (tempAvg < rule.minTemp) {
    score -= (rule.minTemp - tempAvg) * 5;
    issues.push(`Za zimno: ${tempAvg}°C < ${rule.minTemp}°C`);
  }
  if (tempAvg > rule.maxTemp) {
    score -= (tempAvg - rule.maxTemp) * 5;
    issues.push(`Za gorąco: ${tempAvg}°C > ${rule.maxTemp}°C`);
  }

  // Wilgotność
  if (rule.maxHumidity && day.humidity > rule.maxHumidity) {
    score -= (day.humidity - rule.maxHumidity) * 0.5;
    issues.push(`Wilgotność ${day.humidity}% > ${rule.maxHumidity}%`);
  }

  // Suche dni przed
  if (rule.requiresDryDays > 0) {
    const recentRain = prevDays
      .slice(-rule.requiresDryDays)
      .some(d => d.rainfall > 2);
    if (recentRain) {
      score -= 30;
      issues.push(`Niedawne opady — gleba mokra`);
    }
  }

  // Określ poziom
  let level: SuitabilityLevel;
  if (score >= 90) level = 'EXCELLENT';
  else if (score >= 70) level = 'GOOD';
  else if (score >= 50) level = 'FAIR';
  else if (score >= 30) level = 'POOR';
  else level = 'UNSUITABLE';

  return { level, score, issues };
}

function generateWeatherAlerts(days: WeatherDay[]): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  for (const day of days) {
    // Mróz
    if (day.tempMin < 0) {
      alerts.push({
        type: 'FROST',
        severity: day.tempMin < -5 ? 'CRITICAL' : 'HIGH',
        date: day.date,
        message: `Przymrozek ${day.tempMin}°C`,
      });
    }

    // Ulewa
    if (day.rainfall > 20) {
      alerts.push({
        type: 'HEAVY_RAIN',
        severity: day.rainfall > 40 ? 'CRITICAL' : 'HIGH',
        date: day.date,
        message: `Intensywne opady ${day.rainfall}mm`,
      });
    }

    // Wiatr
    if (day.windGust > 20) {
      alerts.push({
        type: 'STORM',
        severity: day.windGust > 30 ? 'CRITICAL' : 'HIGH',
        date: day.date,
        message: `Silne porywy wiatru ${day.windGust}m/s`,
      });
    }

    // Upał
    if (day.tempMax > 35) {
      alerts.push({
        type: 'HEAT',
        severity: 'MEDIUM',
        date: day.date,
        message: `Upał ${day.tempMax}°C`,
      });
    }
  }

  return alerts;
}

// ============================================
// HELPERS
// ============================================

export function getSuitabilityIcon(level: SuitabilityLevel): string {
  switch (level) {
    case 'EXCELLENT': return '✅';
    case 'GOOD': return '🟢';
    case 'FAIR': return '🟡';
    case 'POOR': return '🟠';
    case 'UNSUITABLE': return '🔴';
  }
}

export function getSuitabilityColor(level: SuitabilityLevel): string {
  switch (level) {
    case 'EXCELLENT': return '#22c55e';
    case 'GOOD': return '#84cc16';
    case 'FAIR': return '#eab308';
    case 'POOR': return '#f97316';
    case 'UNSUITABLE': return '#ef4444';
  }
}

export function formatRainfall(mm: number): string {
  if (mm === 0) return '0 mm';
  if (mm < 1) return '<1 mm';
  return `${mm.toFixed(1)} mm`;
}

export function formatWindSpeed(ms: number): string {
  return `${ms.toFixed(1)} m/s`;
}
