import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import {
  AirQualityCategory,
  AirQualityInfo,
  CitySearchResult,
  DailyForecastPoint,
  HourlyForecastPoint,
  MonthlySummaryStats,
  MonthlyWeatherResponse,
  StudyTipKey,
  WeatherDataResponse,
  WeatherLocationInfo,
} from './weather.types';

const DEFAULT_COORDS = {
  lat: 41.2995,
  lon: 69.2401,
  city: 'Tashkent',
};

const DEFAULT_FORECAST_DAYS = 16;
const DEFAULT_PAST_DAYS = 1;
const ROLLING_MONTHLY_FORWARD_DAYS = 30;

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MONTHLY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const GEO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 8000;

const FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast';
const ENSEMBLE_API_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const AIR_QUALITY_API_URL =
  'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODING_API_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const CARDINAL_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

const FORECAST_HOURLY_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'is_day',
  'uv_index',
  'visibility',
  'surface_pressure',
].join(',');

const FORECAST_DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'sunrise',
  'sunset',
  'uv_index_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
].join(',');

const ENSEMBLE_DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'precipitation_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
].join(',');

type WeatherLang = 'uz' | 'ru' | 'en';

const WEATHER_ERRORS: Record<
  WeatherLang,
  {
    forecastFailed: string;
    invalidResponse: string;
    monthlyFailed: string;
    geocodingFailed: string;
    queryTooShort: string;
    partialCoords: string;
    cityNotFound: (city: string) => string;
    monthOutOfRange: (month: string) => string;
  }
> = {
  uz: {
    forecastFailed: 'Ob-havo xizmatidan ma’lumot olib bo‘lmadi',
    invalidResponse: 'Ob-havo xizmati noto‘g‘ri javob qaytardi',
    monthlyFailed: 'Oylik ob-havo ma’lumotini olib bo‘lmadi',
    geocodingFailed: 'Shahar qidirish xizmatidan javob olib bo‘lmadi',
    queryTooShort: 'Qidiruv so‘zi kamida 2 ta belgidan iborat bo‘lishi kerak',
    partialCoords: 'lat va lon parametrlari birgalikda yuborilishi shart',
    cityNotFound: (city) => `"${city}" shahri topilmadi`,
    monthOutOfRange: (month) =>
      `So‘ralgan "${month}" oyi mavjud prognoz va tarix oralig‘idan tashqarida`,
  },
  ru: {
    forecastFailed: 'Не удалось получить данные от сервиса погоды',
    invalidResponse: 'Сервис погоды вернул некорректный ответ',
    monthlyFailed: 'Не удалось получить данные о погоде на месяц',
    geocodingFailed: 'Не удалось получить ответ от сервиса поиска городов',
    queryTooShort: 'Поисковый запрос должен содержать минимум 2 символа',
    partialCoords: 'Параметры lat и lon должны передаваться вместе',
    cityNotFound: (city) => `Город "${city}" не найден`,
    monthOutOfRange: (month) =>
      `Запрошенный месяц "${month}" выходит за пределы доступного прогноза и истории`,
  },
  en: {
    forecastFailed: 'Could not retrieve data from the weather service',
    invalidResponse: 'Weather service returned an invalid response',
    monthlyFailed: 'Could not retrieve monthly weather data',
    geocodingFailed: 'Could not retrieve response from city search service',
    queryTooShort: 'Search query must be at least 2 characters long',
    partialCoords: 'Both lat and lon query parameters must be provided together',
    cityNotFound: (city) => `City "${city}" was not found`,
    monthOutOfRange: (month) =>
      `Requested month "${month}" is outside the supported forecast/history window`,
  },
};

interface ResolvedLocation {
  lat: number;
  lon: number;
  name: string | null;
  roundedLat: number;
  roundedLon: number;
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(
    @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
  ) {}

  async getWeather(
    lat?: number,
    lon?: number,
    cityName?: string,
    forceRefresh = false,
    options?: { days?: number; pastDays?: number; lang?: WeatherLang },
  ): Promise<WeatherDataResponse> {
    const lang: WeatherLang = options?.lang ?? 'en';
    const loc = await this.resolveLocation(lat, lon, cityName, lang);
    const days = this.clampInt(
      options?.days ?? DEFAULT_FORECAST_DAYS,
      1,
      16,
    );
    const pastDays = this.clampInt(
      options?.pastDays ?? DEFAULT_PAST_DAYS,
      0,
      7,
    );
    const cacheKey = `weather:v2:${loc.roundedLat}:${loc.roundedLon}:${pastDays}:${days}`;

    if (!forceRefresh) {
      const cachedValue = await this.safeCacheGet<WeatherDataResponse>(cacheKey);
      if (cachedValue) {
        return {
          ...cachedValue,
          location: {
            ...cachedValue.location,
            name: loc.name ?? null,
          },
          cached: true,
        };
      }
    }

    const [forecastResult, airQualityResult] = await Promise.allSettled([
      axios.get(FORECAST_API_URL, {
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          latitude: loc.lat,
          longitude: loc.lon,
          timezone: 'auto',
          forecast_days: days,
          past_days: pastDays,
          current: [
            'temperature_2m',
            'relative_humidity_2m',
            'apparent_temperature',
            'is_day',
            'precipitation',
            'weather_code',
            'cloud_cover',
            'surface_pressure',
            'wind_speed_10m',
            'wind_direction_10m',
          ].join(','),
          hourly: FORECAST_HOURLY_FIELDS,
          daily: FORECAST_DAILY_FIELDS,
        },
      }),
      axios.get(AIR_QUALITY_API_URL, {
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          latitude: loc.lat,
          longitude: loc.lon,
          timezone: 'auto',
          current: 'european_aqi,us_aqi,pm10,pm2_5',
        },
      }),
    ]);

    if (forecastResult.status === 'rejected') {
      this.logger.error(
        `Failed to fetch Open-Meteo forecast for (${loc.lat}, ${loc.lon})`,
        forecastResult.reason,
      );
      throw new BadGatewayException(WEATHER_ERRORS[lang].forecastFailed);
    }

    const forecastData = forecastResult.value?.data;
    if (!forecastData?.current) {
      throw new BadGatewayException(WEATHER_ERRORS[lang].invalidResponse);
    }

    const airData =
      airQualityResult.status === 'fulfilled'
        ? airQualityResult.value?.data?.current
        : null;

    if (airQualityResult.status === 'rejected') {
      this.logger.warn(
        `Air quality fetch failed for (${loc.lat}, ${loc.lon}), continuing with weather only`,
      );
    }

    const normalized = this.normalizeForecast(forecastData, airData, loc);
    await this.safeCacheSet(
      cacheKey,
      {
        ...normalized,
        location: { ...normalized.location, name: null },
      },
      WEATHER_CACHE_TTL_MS,
    );

    return normalized;
  }

  async getMonthlyWeather(params: {
    lat?: number;
    lon?: number;
    cityName?: string;
    forceRefresh?: boolean;
    month?: string;
    pastDays?: number;
    lang?: WeatherLang;
  }): Promise<MonthlyWeatherResponse> {
    const lang: WeatherLang = params.lang ?? 'en';
    const loc = await this.resolveLocation(
      params.lat,
      params.lon,
      params.cityName,
      lang,
    );
    const month = params.month?.trim() || undefined;
    const rollingPastDays = this.clampInt(params.pastDays ?? 0, 0, 31);
    const forecastPastDays = month
      ? this.computeCalendarPastDays(month)
      : rollingPastDays;

    const cacheKey = `weather:monthly:v1:${loc.roundedLat}:${loc.roundedLon}:${month ?? `rolling:${rollingPastDays}`}`;

    if (!params.forceRefresh) {
      const cachedValue =
        await this.safeCacheGet<MonthlyWeatherResponse>(cacheKey);
      if (cachedValue) {
        return {
          ...cachedValue,
          location: {
            ...cachedValue.location,
            name: loc.name ?? null,
          },
          cached: true,
        };
      }
    }

    const [forecastResult, ensembleResult] = await Promise.allSettled([
      axios.get(FORECAST_API_URL, {
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          latitude: loc.lat,
          longitude: loc.lon,
          timezone: 'auto',
          forecast_days: 16,
          past_days: forecastPastDays,
          current: 'temperature_2m',
          hourly: FORECAST_HOURLY_FIELDS,
          daily: FORECAST_DAILY_FIELDS,
        },
      }),
      axios.get(ENSEMBLE_API_URL, {
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          latitude: loc.lat,
          longitude: loc.lon,
          timezone: 'auto',
          models: 'gfs_seamless',
          forecast_days: 35,
          daily: ENSEMBLE_DAILY_FIELDS,
        },
      }),
    ]);

    if (forecastResult.status === 'rejected') {
      this.logger.error(
        `Failed to fetch Open-Meteo monthly forecast for (${loc.lat}, ${loc.lon})`,
        forecastResult.reason,
      );
      throw new BadGatewayException(WEATHER_ERRORS[lang].monthlyFailed);
    }

    const forecastData = forecastResult.value?.data;
    if (!forecastData?.daily?.time) {
      throw new BadGatewayException(WEATHER_ERRORS[lang].invalidResponse);
    }

    const ensembleUnavailable = ensembleResult.status === 'rejected';
    if (ensembleUnavailable) {
      this.logger.warn(
        `Ensemble long-range fetch failed for (${loc.lat}, ${loc.lon}), continuing with 16-day forecast only`,
      );
    }

    const ensembleData =
      ensembleResult.status === 'fulfilled' ? ensembleResult.value?.data : null;

    const todayDate = this.extractDatePrefix(
      forecastData.current?.time,
      forecastData.daily.time[0],
    );

    const hourlyByDate = this.buildHourlyByDate(
      forecastData.hourly || {},
      forecastData.current,
    );

    const forecastDays = this.buildForecastDailyPoints(
      forecastData.daily || {},
      hourlyByDate,
      todayDate,
      'unknown',
    );

    const dayMap = new Map<string, DailyForecastPoint>();
    for (const day of forecastDays) {
      dayMap.set(day.date, day);
    }

    const resolvedLat = Number(forecastData.latitude ?? loc.lat);
    const resolvedLon = Number(forecastData.longitude ?? loc.lon);
    const utcOffsetSeconds = Number(forecastData.utc_offset_seconds ?? 0);

    if (ensembleData?.daily?.time) {
      const ensembleDays = this.buildEnsembleDailyPoints(
        ensembleData.daily,
        todayDate,
        resolvedLat,
        resolvedLon,
        utcOffsetSeconds,
      );
      for (const day of ensembleDays) {
        if (!dayMap.has(day.date)) {
          dayMap.set(day.date, day);
        }
      }
    }

    const sortedDays = Array.from(dayMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    let selectedDays: DailyForecastPoint[];
    if (month) {
      selectedDays = sortedDays.filter((d) => d.date.startsWith(`${month}-`));
      if (selectedDays.length === 0) {
        throw new BadRequestException(
          WEATHER_ERRORS[lang].monthOutOfRange(month),
        );
      }
    } else {
      const past =
        rollingPastDays > 0
          ? sortedDays
              .filter((d) => d.date < todayDate)
              .slice(-rollingPastDays)
          : [];
      const forward = sortedDays
        .filter((d) => d.date >= todayDate)
        .slice(0, ROLLING_MONTHLY_FORWARD_DAYS);
      selectedDays = [...past, ...forward];
    }

    const selectedDateSet = new Set(selectedDays.map((d) => d.date));
    const filteredHourlyByDate: Record<string, HourlyForecastPoint[]> = {};
    for (const [date, points] of Object.entries(hourlyByDate)) {
      if (selectedDateSet.has(date)) {
        filteredHourlyByDate[date] = points;
      }
    }

    const location: WeatherLocationInfo = {
      name: loc.name,
      latitude: resolvedLat,
      longitude: resolvedLon,
      timezone: String(forecastData.timezone || 'UTC'),
      utcOffsetSeconds,
    };

    const response: MonthlyWeatherResponse = {
      location,
      month: month ?? 'rolling-30d',
      todayDate,
      days: selectedDays,
      hourlyByDate: filteredHourlyByDate,
      summary: this.computeMonthlySummary(selectedDays),
      ...(ensembleUnavailable ? { ensembleUnavailable: true } : {}),
      cached: false,
      fetchedAt: new Date().toISOString(),
    };

    await this.safeCacheSet(
      cacheKey,
      {
        ...response,
        location: { ...response.location, name: null },
      },
      MONTHLY_CACHE_TTL_MS,
    );
    return response;
  }

  async searchCities(
    rawQuery: string,
    lang: WeatherLang = 'en',
    count = 8,
  ): Promise<CitySearchResult[]> {
    const query = rawQuery.trim();
    if (query.length < 2) {
      throw new BadRequestException(WEATHER_ERRORS[lang].queryTooShort);
    }

    const apiLang = lang === 'ru' ? 'ru' : 'en';
    const cacheKey = `weather:geo:v1:${apiLang}:${count}:${query.toLowerCase()}`;

    const cached = await this.safeCacheGet<CitySearchResult[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get(GEOCODING_API_URL, {
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          name: query,
          count,
          language: apiLang,
          format: 'json',
        },
      });

      const results = Array.isArray(response.data?.results)
        ? response.data.results
        : [];

      const mapped: CitySearchResult[] = results.map((item: any) => ({
        id: Number(item.id),
        name: String(item.name || ''),
        country: String(item.country || ''),
        countryCode: String(item.country_code || ''),
        admin1: item.admin1 ? String(item.admin1) : null,
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        timezone: item.timezone ? String(item.timezone) : null,
      }));

      await this.safeCacheSet(cacheKey, mapped, GEO_CACHE_TTL_MS);
      return mapped;
    } catch (error) {
      this.logger.error(`City geocoding search failed for "${query}"`, error);
      throw new BadGatewayException(WEATHER_ERRORS[lang].geocodingFailed);
    }
  }

  private async resolveLocation(
    lat?: number,
    lon?: number,
    cityName?: string,
    lang: WeatherLang = 'en',
  ): Promise<ResolvedLocation> {
    if (
      (lat !== undefined && lon === undefined) ||
      (lat === undefined && lon !== undefined)
    ) {
      throw new BadRequestException(WEATHER_ERRORS[lang].partialCoords);
    }

    const trimmedCity = cityName?.trim();
    if (lat === undefined && lon === undefined && trimmedCity) {
      const matches = await this.searchCities(trimmedCity, lang, 1);
      if (matches.length === 0) {
        throw new NotFoundException(
          WEATHER_ERRORS[lang].cityNotFound(trimmedCity),
        );
      }
      const matched = matches[0];
      return {
        lat: matched.latitude,
        lon: matched.longitude,
        name: trimmedCity,
        roundedLat: Math.round(matched.latitude * 100) / 100,
        roundedLon: Math.round(matched.longitude * 100) / 100,
      };
    }

    const resolvedLat = lat ?? DEFAULT_COORDS.lat;
    const resolvedLon = lon ?? DEFAULT_COORDS.lon;
    const resolvedName =
      trimmedCity || (lat === undefined ? DEFAULT_COORDS.city : null);

    return {
      lat: resolvedLat,
      lon: resolvedLon,
      name: resolvedName,
      roundedLat: Math.round(resolvedLat * 100) / 100,
      roundedLon: Math.round(resolvedLon * 100) / 100,
    };
  }

  private normalizeForecast(
    forecastData: any,
    airCurrent: any,
    loc: ResolvedLocation,
  ): WeatherDataResponse {
    const current = forecastData.current;
    const hourlyRaw = forecastData.hourly || {};
    const dailyRaw = forecastData.daily || {};

    const hourlyTimes: string[] = Array.isArray(hourlyRaw.time)
      ? hourlyRaw.time
      : [];
    const currentHourPrefix =
      typeof current.time === 'string' ? current.time.slice(0, 13) : '';

    let startIdx = hourlyTimes.findIndex(
      (t) => t.slice(0, 13) >= currentHourPrefix,
    );
    if (startIdx < 0) startIdx = 0;

    const hourlyByDate = this.buildHourlyByDate(hourlyRaw, current);

    const allHourlyPoints = Object.values(hourlyByDate).flat();
    const hourlyStartIdx = allHourlyPoints.findIndex(
      (p) => p.time.slice(0, 13) >= currentHourPrefix,
    );
    const sliceFrom = hourlyStartIdx >= 0 ? hourlyStartIdx : 0;
    const hourly = allHourlyPoints.slice(sliceFrom, sliceFrom + 24);

    const todayDate = this.extractDatePrefix(
      current.time,
      dailyRaw.time?.[0],
    );
    const airQuality = this.normalizeAirQuality(airCurrent);

    const daily = this.buildForecastDailyPoints(
      dailyRaw,
      hourlyByDate,
      todayDate,
      airQuality.category,
    );

    const currentUv =
      hourlyRaw.uv_index?.[startIdx] != null
        ? this.round1(hourlyRaw.uv_index[startIdx])
        : null;
    const currentVisibility =
      hourlyRaw.visibility?.[startIdx] != null
        ? Math.round(Number(hourlyRaw.visibility[startIdx]))
        : null;

    const currentTemp = this.round1(current.temperature_2m);
    const currentCode = Number(current.weather_code ?? 0);
    const windSpeed = this.round1(current.wind_speed_10m);

    return {
      location: {
        name: loc.name,
        latitude: Number(forecastData.latitude ?? loc.lat),
        longitude: Number(forecastData.longitude ?? loc.lon),
        timezone: String(forecastData.timezone || 'UTC'),
        utcOffsetSeconds: Number(forecastData.utc_offset_seconds ?? 0),
      },
      todayDate,
      current: {
        time: String(current.time),
        temperatureC: currentTemp,
        apparentTemperatureC: this.round1(current.apparent_temperature),
        humidity: Math.round(Number(current.relative_humidity_2m ?? 0)),
        windSpeedKmh: windSpeed,
        windDirectionDeg: Math.round(Number(current.wind_direction_10m ?? 0)),
        pressureHpa: Math.round(Number(current.surface_pressure ?? 0)),
        cloudCoverPct: Math.round(Number(current.cloud_cover ?? 0)),
        precipitationMm: this.round1(current.precipitation ?? 0),
        weatherCode: currentCode,
        isDay: Number(current.is_day ?? 1) === 1,
        uvIndex: currentUv,
        visibilityM: currentVisibility,
      },
      airQuality,
      hourly,
      hourlyByDate,
      daily,
      studyTipKey: this.resolveStudyTip({
        weatherCode: currentCode,
        temperatureC: currentTemp,
        windSpeedKmh: windSpeed,
        uvIndex: currentUv,
        airCategory: airQuality.category,
      }),
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  private buildHourlyByDate(
    hourlyRaw: any,
    current?: any,
  ): Record<string, HourlyForecastPoint[]> {
    const times: string[] = Array.isArray(hourlyRaw.time) ? hourlyRaw.time : [];
    const grouped: Record<string, HourlyForecastPoint[]> = {};

    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const date = time.slice(0, 10);
      if (!grouped[date]) {
        grouped[date] = [];
      }

      grouped[date].push({
        time,
        temperatureC: this.round1(
          hourlyRaw.temperature_2m?.[i] ?? current?.temperature_2m,
        ),
        apparentTemperatureC: this.round1(
          hourlyRaw.apparent_temperature?.[i] ?? current?.apparent_temperature,
        ),
        precipitationProbability: Number(
          hourlyRaw.precipitation_probability?.[i] ?? 0,
        ),
        precipitationMm: this.round1(hourlyRaw.precipitation?.[i] ?? 0),
        weatherCode: Number(
          hourlyRaw.weather_code?.[i] ?? current?.weather_code ?? 0,
        ),
        isDay: Number(hourlyRaw.is_day?.[i] ?? current?.is_day ?? 1) === 1,
        windSpeedKmh: this.round1(hourlyRaw.wind_speed_10m?.[i] ?? 0),
        windGustsKmh:
          hourlyRaw.wind_gusts_10m?.[i] != null
            ? this.round1(hourlyRaw.wind_gusts_10m[i])
            : null,
        windDirectionDeg:
          hourlyRaw.wind_direction_10m?.[i] != null
            ? Math.round(Number(hourlyRaw.wind_direction_10m[i]))
            : null,
        humidity: Math.round(Number(hourlyRaw.relative_humidity_2m?.[i] ?? 0)),
        uvIndex:
          hourlyRaw.uv_index?.[i] != null
            ? this.round1(hourlyRaw.uv_index[i])
            : null,
        visibilityM:
          hourlyRaw.visibility?.[i] != null
            ? Math.round(Number(hourlyRaw.visibility[i]))
            : null,
        pressureHpa:
          hourlyRaw.surface_pressure?.[i] != null
            ? Math.round(Number(hourlyRaw.surface_pressure[i]))
            : null,
      });
    }

    return grouped;
  }

  private buildForecastDailyPoints(
    dailyRaw: any,
    hourlyByDate: Record<string, HourlyForecastPoint[]>,
    todayDate: string,
    todayAirCategory: AirQualityCategory,
  ): DailyForecastPoint[] {
    const dates: string[] = Array.isArray(dailyRaw.time) ? dailyRaw.time : [];

    return dates.map((date, idx) => {
      const weatherCode = Number(dailyRaw.weather_code?.[idx] ?? 0);
      const tempMaxC = this.round1(dailyRaw.temperature_2m_max?.[idx] ?? 0);
      const tempMinC = this.round1(dailyRaw.temperature_2m_min?.[idx] ?? 0);
      const windSpeedMaxKmh = this.round1(
        dailyRaw.wind_speed_10m_max?.[idx] ?? 0,
      );
      const uvIndexMax =
        dailyRaw.uv_index_max?.[idx] != null
          ? this.round1(dailyRaw.uv_index_max[idx])
          : null;
      const windDirectionDeg =
        dailyRaw.wind_direction_10m_dominant?.[idx] != null
          ? Math.round(Number(dailyRaw.wind_direction_10m_dominant[idx]))
          : null;

      const dayHours = hourlyByDate[date] ?? [];
      const humidityMean = this.meanRounded(dayHours.map((h) => h.humidity));
      const pressureMeanHpa = this.meanRounded(
        dayHours
          .map((h) => h.pressureHpa)
          .filter((v): v is number => v !== null),
      );

      const isToday = date === todayDate;

      return {
        date,
        weatherCode,
        tempMaxC,
        tempMinC,
        apparentTempMaxC:
          dailyRaw.apparent_temperature_max?.[idx] != null
            ? this.round1(dailyRaw.apparent_temperature_max[idx])
            : null,
        apparentTempMinC:
          dailyRaw.apparent_temperature_min?.[idx] != null
            ? this.round1(dailyRaw.apparent_temperature_min[idx])
            : null,
        precipitationProbabilityMax: Number(
          dailyRaw.precipitation_probability_max?.[idx] ?? 0,
        ),
        precipitationSumMm: this.round1(
          dailyRaw.precipitation_sum?.[idx] ?? 0,
        ),
        windSpeedMaxKmh,
        windGustsMaxKmh:
          dailyRaw.wind_gusts_10m_max?.[idx] != null
            ? this.round1(dailyRaw.wind_gusts_10m_max[idx])
            : null,
        windDirectionDeg,
        windDirectionCardinal: this.degToCardinal(windDirectionDeg),
        humidityMean,
        pressureMeanHpa,
        uvIndexMax,
        sunrise: dailyRaw.sunrise?.[idx] ?? null,
        sunset: dailyRaw.sunset?.[idx] ?? null,
        studyTipKey: this.resolveStudyTip({
          weatherCode,
          temperatureC: tempMaxC,
          windSpeedKmh: windSpeedMaxKmh,
          uvIndex: uvIndexMax,
          airCategory: isToday ? todayAirCategory : 'unknown',
        }),
        isPast: date < todayDate,
        isToday,
        isWeekend: this.isWeekendDate(date),
        source: 'forecast',
        isLongRange: false,
      };
    });
  }

  private buildEnsembleDailyPoints(
    ensembleDaily: any,
    todayDate: string,
    lat: number,
    lon: number,
    utcOffsetSeconds: number,
  ): DailyForecastPoint[] {
    const dates: string[] = Array.isArray(ensembleDaily.time)
      ? ensembleDaily.time
      : [];
    const results: DailyForecastPoint[] = [];

    for (let idx = 0; idx < dates.length; idx++) {
      const date = dates[idx];
      const maxTemps = this.collectEnsembleNumbers(
        ensembleDaily,
        'temperature_2m_max',
        idx,
      );
      const minTemps = this.collectEnsembleNumbers(
        ensembleDaily,
        'temperature_2m_min',
        idx,
      );

      // Skip trailing horizon slots where the ensemble run has no values yet
      if (maxTemps.length === 0 && minTemps.length === 0) {
        continue;
      }

      const tempMaxC = this.round1(this.mean(maxTemps) ?? 0);
      const tempMinC = this.round1(this.mean(minTemps) ?? tempMaxC);

      const appMaxVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'apparent_temperature_max',
        idx,
      );
      const appMinVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'apparent_temperature_min',
        idx,
      );
      const precipVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'precipitation_sum',
        idx,
      );
      const windVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'wind_speed_10m_max',
        idx,
      );
      const gustVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'wind_gusts_10m_max',
        idx,
      );
      const dirVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'wind_direction_10m_dominant',
        idx,
      );
      const codeVals = this.collectEnsembleNumbers(
        ensembleDaily,
        'weather_code',
        idx,
      );

      let weatherCode = this.modeNumber(codeVals) ?? 0;
      const windSpeedMaxKmh = this.round1(this.mean(windVals) ?? 0);
      const windDirectionDeg = this.circularMeanDeg(dirVals);
      const precipitationSumMm = this.round1(this.mean(precipVals) ?? 0);

      // Derive precipitation probability from the share of ensemble members predicting >= 0.2 mm
      const precipitationProbabilityMax =
        precipVals.length > 0
          ? Math.round(
              (precipVals.filter((p) => p >= 0.2).length / precipVals.length) *
                100,
            )
          : 0;

      if (
        weatherCode < 51 &&
        precipitationSumMm >= 1.0 &&
        precipitationProbabilityMax >= 60
      ) {
        const precipCodes = codeVals.filter((c) => c >= 51);
        if (precipCodes.length > 0) {
          weatherCode = this.modeNumber(precipCodes) ?? weatherCode;
        }
      }

      const sunTimes = this.computeSunTimes(date, lat, lon, utcOffsetSeconds);

      results.push({
        date,
        weatherCode,
        tempMaxC,
        tempMinC,
        apparentTempMaxC:
          appMaxVals.length > 0 ? this.round1(this.mean(appMaxVals)!) : null,
        apparentTempMinC:
          appMinVals.length > 0 ? this.round1(this.mean(appMinVals)!) : null,
        precipitationProbabilityMax,
        precipitationSumMm,
        windSpeedMaxKmh,
        windGustsMaxKmh:
          gustVals.length > 0 ? this.round1(this.mean(gustVals)!) : null,
        windDirectionDeg,
        windDirectionCardinal: this.degToCardinal(windDirectionDeg),
        humidityMean: null,
        pressureMeanHpa: null,
        uvIndexMax: null,
        sunrise: sunTimes.sunrise,
        sunset: sunTimes.sunset,
        studyTipKey: this.resolveStudyTip({
          weatherCode,
          temperatureC: tempMaxC,
          windSpeedKmh: windSpeedMaxKmh,
          uvIndex: null,
          airCategory: 'unknown',
        }),
        isPast: date < todayDate,
        isToday: date === todayDate,
        isWeekend: this.isWeekendDate(date),
        source: 'ensemble',
        isLongRange: true,
      });
    }

    return results;
  }

  private collectEnsembleNumbers(
    dailyObj: Record<string, unknown[]>,
    baseKey: string,
    idx: number,
  ): number[] {
    const values: number[] = [];
    const memberPrefix = `${baseKey}_member`;

    for (const [key, series] of Object.entries(dailyObj)) {
      if (key !== baseKey && !key.startsWith(memberPrefix)) continue;
      if (!Array.isArray(series)) continue;
      const raw = series[idx];
      if (raw !== null && raw !== undefined && !Number.isNaN(Number(raw))) {
        values.push(Number(raw));
      }
    }

    return values;
  }

  private computeMonthlySummary(
    days: DailyForecastPoint[],
  ): MonthlySummaryStats {
    if (days.length === 0) {
      return {
        totalDays: 0,
        warmestDay: null,
        coldestDay: null,
        rainyDaysCount: 0,
        avgTempMaxC: null,
        avgTempMinC: null,
        totalPrecipitationMm: 0,
      };
    }

    let warmest = days[0];
    let coldest = days[0];
    let sumMax = 0;
    let sumMin = 0;
    let sumPrecip = 0;
    let rainyDaysCount = 0;

    for (const day of days) {
      if (day.tempMaxC > warmest.tempMaxC) warmest = day;
      if (day.tempMinC < coldest.tempMinC) coldest = day;
      sumMax += day.tempMaxC;
      sumMin += day.tempMinC;
      sumPrecip += day.precipitationSumMm;
      if (day.precipitationSumMm >= 0.2) {
        rainyDaysCount++;
      }
    }

    return {
      totalDays: days.length,
      warmestDay: { date: warmest.date, tempMaxC: warmest.tempMaxC },
      coldestDay: { date: coldest.date, tempMinC: coldest.tempMinC },
      rainyDaysCount,
      avgTempMaxC: this.round1(sumMax / days.length),
      avgTempMinC: this.round1(sumMin / days.length),
      totalPrecipitationMm: this.round1(sumPrecip),
    };
  }

  private normalizeAirQuality(airCurrent: any): AirQualityInfo {
    if (!airCurrent) {
      return {
        europeanAqi: null,
        usAqi: null,
        pm25: null,
        pm10: null,
        category: 'unknown',
      };
    }

    const euAqi =
      airCurrent.european_aqi != null
        ? Math.round(Number(airCurrent.european_aqi))
        : null;
    const usAqi =
      airCurrent.us_aqi != null ? Math.round(Number(airCurrent.us_aqi)) : null;
    const pm25 = airCurrent.pm2_5 != null ? this.round1(airCurrent.pm2_5) : null;
    const pm10 = airCurrent.pm10 != null ? this.round1(airCurrent.pm10) : null;

    return {
      europeanAqi: euAqi,
      usAqi,
      pm25,
      pm10,
      category: this.classifyEuAqi(euAqi),
    };
  }

  private classifyEuAqi(aqi: number | null): AirQualityCategory {
    if (aqi === null || Number.isNaN(aqi)) return 'unknown';
    if (aqi <= 20) return 'good';
    if (aqi <= 40) return 'fair';
    if (aqi <= 60) return 'moderate';
    if (aqi <= 80) return 'poor';
    return 'very_poor';
  }

  private resolveStudyTip(params: {
    weatherCode: number;
    temperatureC: number;
    windSpeedKmh: number;
    uvIndex: number | null;
    airCategory: AirQualityCategory;
  }): StudyTipKey {
    const { weatherCode, temperatureC, windSpeedKmh, uvIndex, airCategory } =
      params;

    if (weatherCode >= 95) return 'storm';
    if (
      (weatherCode >= 71 && weatherCode <= 77) ||
      weatherCode === 85 ||
      weatherCode === 86
    ) {
      return 'snow';
    }
    if (
      (weatherCode >= 51 && weatherCode <= 67) ||
      (weatherCode >= 80 && weatherCode <= 82)
    ) {
      return 'rain';
    }
    if (airCategory === 'poor' || airCategory === 'very_poor') return 'poor_air';
    if (temperatureC >= 34) return 'extreme_heat';
    if (temperatureC <= 2) return 'cold';
    if (uvIndex !== null && uvIndex >= 6) return 'high_uv';
    if (windSpeedKmh >= 35) return 'windy';
    return 'pleasant';
  }

  private degToCardinal(deg: number | null): string | null {
    if (deg === null || Number.isNaN(deg)) return null;
    const normalized = ((deg % 360) + 360) % 360;
    const idx = Math.round(normalized / 45) % 8;
    return CARDINAL_DIRECTIONS[idx];
  }

  private circularMeanDeg(angles: number[]): number | null {
    if (angles.length === 0) return null;
    let sinSum = 0;
    let cosSum = 0;
    for (const deg of angles) {
      const rad = (deg * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }
    if (Math.abs(sinSum) < 1e-6 && Math.abs(cosSum) < 1e-6) {
      return Math.round(((angles[0] % 360) + 360) % 360);
    }
    const avgDeg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
    return Math.round(((avgDeg % 360) + 360) % 360);
  }

  private modeNumber(values: number[]): number | null {
    if (values.length === 0) return null;
    const counts = new Map<number, number>();
    let bestVal = values[0];
    let bestCount = 0;
    for (const v of values) {
      const c = (counts.get(v) ?? 0) + 1;
      counts.set(v, c);
      if (c > bestCount) {
        bestCount = c;
        bestVal = v;
      }
    }
    return bestVal;
  }

  private mean(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }

  private meanRounded(values: number[]): number | null {
    const avg = this.mean(values);
    return avg === null ? null : Math.round(avg);
  }

  private extractDatePrefix(
    currentTime: unknown,
    fallbackDate: unknown,
  ): string {
    if (typeof currentTime === 'string' && currentTime.length >= 10) {
      return currentTime.slice(0, 10);
    }
    if (typeof fallbackDate === 'string' && fallbackDate.length >= 10) {
      return fallbackDate.slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }

  private computeCalendarPastDays(month: string): number {
    const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) return 31;
    const year = Number(match[1]);
    const mon = Number(match[2]);
    const monthStartMs = Date.UTC(year, mon - 1, 1);
    const now = new Date();
    const todayUtcMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const diffDays = Math.floor((todayUtcMs - monthStartMs) / 86400000);
    if (diffDays < 0) return 0;
    return this.clampInt(diffDays + 1, 0, 62);
  }

  private computeSunTimes(
    dateStr: string,
    lat: number,
    lon: number,
    utcOffsetSeconds: number,
  ): { sunrise: string | null; sunset: string | null } {
    const parts = dateStr.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return { sunrise: null, sunset: null };
    }
    const [year, month, day] = parts;
    const dayOfYear = Math.floor(
      (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000,
    );
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;
    const lngHour = lon / 15;

    const calc = (isSunrise: boolean): string | null => {
      const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
      const M = 0.9856 * t - 3.289;
      const L =
        (((M +
          1.916 * Math.sin(M * rad) +
          0.02 * Math.sin(2 * M * rad) +
          282.634) %
          360) +
          360) %
        360;
      let RA =
        (((Math.atan(0.91764 * Math.tan(L * rad)) * deg) % 360) + 360) % 360;
      const lQuad = Math.floor(L / 90) * 90;
      const raQuad = Math.floor(RA / 90) * 90;
      RA = (RA + (lQuad - raQuad)) / 15;

      const sinDec = 0.39782 * Math.sin(L * rad);
      const cosDec = Math.cos(Math.asin(sinDec));
      const denom = cosDec * Math.cos(lat * rad);
      if (Math.abs(denom) < 1e-9) return null;
      const cosH =
        (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / denom;
      if (!Number.isFinite(cosH) || cosH > 1 || cosH < -1) return null;

      const H = isSunrise
        ? (360 - Math.acos(cosH) * deg) / 15
        : (Math.acos(cosH) * deg) / 15;
      const T = H + RA - 0.06571 * t - 6.622;
      const ut = (((T - lngHour) % 24) + 24) % 24;
      const localMinutes = Math.round((ut + utcOffsetSeconds / 3600) * 60);
      const wrapped = ((localMinutes % 1440) + 1440) % 1440;
      const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
      const mm = String(wrapped % 60).padStart(2, '0');
      return `${dateStr}T${hh}:${mm}`;
    };

    return { sunrise: calc(true), sunset: calc(false) };
  }

  private isWeekendDate(dateStr: string): boolean {
    const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  }

  private clampInt(value: number, min: number, max: number): number {
    const n = Math.round(Number(value));
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  private round1(value: unknown): number {
    const num = Number(value ?? 0);
    if (Number.isNaN(num)) return 0;
    return Math.round(num * 10) / 10;
  }

  private async safeCacheGet<T>(key: string): Promise<T | undefined> {
    if (!this.cache) return undefined;
    try {
      return await this.cache.get<T>(key);
    } catch (err) {
      this.logger.warn(`Cache get failed for ${key}`, err);
      return undefined;
    }
  }

  private async safeCacheSet(
    key: string,
    value: unknown,
    ttlMs: number,
  ): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, value, ttlMs);
    } catch (err) {
      this.logger.warn(`Cache set failed for ${key}`, err);
    }
  }
}
