export type AirQualityCategory =
  | 'good'
  | 'fair'
  | 'moderate'
  | 'poor'
  | 'very_poor'
  | 'unknown';

export type StudyTipKey =
  | 'rain'
  | 'snow'
  | 'storm'
  | 'extreme_heat'
  | 'cold'
  | 'poor_air'
  | 'high_uv'
  | 'windy'
  | 'pleasant';

export type ForecastDataSource = 'forecast' | 'ensemble';

export interface WeatherLocationInfo {
  name: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  utcOffsetSeconds: number;
}

export interface CurrentWeatherInfo {
  time: string;
  temperatureC: number;
  apparentTemperatureC: number;
  humidity: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  pressureHpa: number;
  cloudCoverPct: number;
  precipitationMm: number;
  weatherCode: number;
  isDay: boolean;
  uvIndex: number | null;
  visibilityM: number | null;
}

export interface AirQualityInfo {
  europeanAqi: number | null;
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  category: AirQualityCategory;
}

export interface HourlyForecastPoint {
  time: string;
  temperatureC: number;
  apparentTemperatureC: number;
  precipitationProbability: number;
  precipitationMm: number;
  weatherCode: number;
  isDay: boolean;
  windSpeedKmh: number;
  windGustsKmh: number | null;
  windDirectionDeg: number | null;
  humidity: number;
  uvIndex: number | null;
  visibilityM: number | null;
  pressureHpa: number | null;
}

export interface DailyForecastPoint {
  date: string;
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
  apparentTempMaxC: number | null;
  apparentTempMinC: number | null;
  precipitationProbabilityMax: number;
  precipitationSumMm: number;
  windSpeedMaxKmh: number;
  windGustsMaxKmh: number | null;
  windDirectionDeg: number | null;
  windDirectionCardinal: string | null;
  humidityMean: number | null;
  pressureMeanHpa: number | null;
  uvIndexMax: number | null;
  sunrise: string | null;
  sunset: string | null;
  studyTipKey: StudyTipKey;
  isPast: boolean;
  isToday: boolean;
  isWeekend: boolean;
  source: ForecastDataSource;
  isLongRange: boolean;
}

export interface WeatherDataResponse {
  location: WeatherLocationInfo;
  todayDate: string;
  current: CurrentWeatherInfo;
  airQuality: AirQualityInfo;
  hourly: HourlyForecastPoint[];
  hourlyByDate: Record<string, HourlyForecastPoint[]>;
  daily: DailyForecastPoint[];
  studyTipKey: StudyTipKey;
  cached: boolean;
  fetchedAt: string;
}

export interface MonthlySummaryStats {
  totalDays: number;
  warmestDay: { date: string; tempMaxC: number } | null;
  coldestDay: { date: string; tempMinC: number } | null;
  rainyDaysCount: number;
  avgTempMaxC: number | null;
  avgTempMinC: number | null;
  totalPrecipitationMm: number;
}

export interface MonthlyWeatherResponse {
  location: WeatherLocationInfo;
  month: string;
  todayDate: string;
  days: DailyForecastPoint[];
  hourlyByDate: Record<string, HourlyForecastPoint[]>;
  summary: MonthlySummaryStats;
  ensembleUnavailable?: boolean;
  cached: boolean;
  fetchedAt: string;
}

export interface CitySearchResult {
  id: number;
  name: string;
  country: string;
  countryCode: string;
  admin1: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
}
