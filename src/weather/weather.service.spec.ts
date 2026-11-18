/// <reference types="jest" />
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import axios from 'axios';
import {
  GetMonthlyWeatherQueryDto,
  GetWeatherQueryDto,
  SearchCitiesQueryDto,
} from './dto/weather-query.dto';
import { WeatherService } from './weather.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const buildCacheMock = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, val: unknown) => {
      store.set(key, val);
    }),
  };
};

const sampleForecastPayload = {
  latitude: 41.3,
  longitude: 69.24,
  timezone: 'Asia/Tashkent',
  utc_offset_seconds: 18000,
  current: {
    time: '2026-11-16T14:00',
    temperature_2m: 14.6,
    apparent_temperature: 13.1,
    relative_humidity_2m: 48,
    wind_speed_10m: 11.4,
    wind_direction_10m: 210,
    surface_pressure: 1018.2,
    cloud_cover: 25,
    precipitation: 0,
    weather_code: 1,
    is_day: 1,
  },
  hourly: {
    time: [
      '2026-11-15T12:00',
      '2026-11-16T13:00',
      '2026-11-16T14:00',
      '2026-11-16T15:00',
      '2026-11-16T16:00',
      '2026-11-17T09:00',
    ],
    temperature_2m: [11.0, 13.2, 14.6, 15.1, 14.0, 8.5],
    apparent_temperature: [9.5, 12.0, 13.1, 13.8, 12.6, 7.0],
    precipitation_probability: [0, 0, 5, 10, 15, 70],
    precipitation: [0, 0, 0, 0, 0, 1.2],
    weather_code: [0, 1, 1, 2, 2, 61],
    wind_speed_10m: [8.0, 10.0, 11.4, 12.1, 9.5, 16.0],
    wind_gusts_10m: [12.0, 15.0, 18.0, 19.0, 14.0, 26.0],
    wind_direction_10m: [90, 200, 210, 220, 215, 315],
    relative_humidity_2m: [55, 50, 48, 46, 52, 78],
    is_day: [1, 1, 1, 1, 1, 1],
    uv_index: [2.0, 2.5, 3.2, 2.8, 1.4, 1.1],
    visibility: [24000, 24000, 24000, 22000, 20000, 12000],
    surface_pressure: [1016, 1018, 1018, 1017, 1017, 1012],
  },
  daily: {
    time: ['2026-11-15', '2026-11-16', '2026-11-17'],
    weather_code: [0, 1, 61],
    temperature_2m_max: [15.0, 16.4, 12.1],
    temperature_2m_min: [4.5, 5.2, 4.0],
    apparent_temperature_max: [14.0, 15.1, 10.2],
    apparent_temperature_min: [3.2, 4.0, 2.1],
    precipitation_probability_max: [5, 10, 80],
    precipitation_sum: [0, 0, 6.4],
    wind_speed_10m_max: [10.0, 14.2, 22.5],
    wind_gusts_10m_max: [18.0, 24.0, 36.0],
    wind_direction_10m_dominant: [90, 225, 315],
    uv_index_max: [3.0, 3.6, 2.1],
    sunrise: ['2026-11-15T07:11', '2026-11-16T07:12', '2026-11-17T07:13'],
    sunset: ['2026-11-15T17:05', '2026-11-16T17:04', '2026-11-17T17:03'],
  },
};

const sampleAirPayload = {
  current: {
    european_aqi: 34,
    us_aqi: 55,
    pm2_5: 13.4,
    pm10: 28.2,
  },
};

const sampleEnsemblePayload = {
  latitude: 41.3,
  longitude: 69.24,
  timezone: 'Asia/Tashkent',
  utc_offset_seconds: 18000,
  daily: {
    time: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'],
    weather_code: [2, 63, 3, 1],
    weather_code_member01: [2, 63, 3, 1],
    weather_code_member02: [3, 61, 3, 0],
    temperature_2m_max: [99.0, 99.0, 17.0, 19.0],
    temperature_2m_max_member01: [99.0, 99.0, 18.0, 21.0],
    temperature_2m_max_member02: [99.0, 99.0, 16.0, 17.0],
    temperature_2m_min: [1.0, 1.0, 6.0, 7.0],
    temperature_2m_min_member01: [1.0, 1.0, 7.0, 8.0],
    temperature_2m_min_member02: [1.0, 1.0, 5.0, 6.0],
    precipitation_sum: [0, 1, 0.5, 0],
    precipitation_sum_member01: [0, 1, 0.4, 0],
    precipitation_sum_member02: [0, 1, 0.0, 0],
    wind_speed_10m_max: [10, 12, 14, 9],
    wind_speed_10m_max_member01: [10, 12, 16, 11],
    wind_gusts_10m_max: [20, 22, 24, 15],
    wind_direction_10m_dominant: [180, 180, 350, 10],
    wind_direction_10m_dominant_member01: [180, 180, 10, 350],
  },
};

describe('WeatherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches forecast + air quality, groups hourlyByDate, adds daily wind/day flags, and caches', async () => {
    const cache = buildCacheMock();
    const service = new WeatherService(cache as any);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('air-quality-api')) {
        return { data: sampleAirPayload } as any;
      }
      return { data: sampleForecastPayload } as any;
    });

    const first = await service.getWeather(41.2995, 69.2401, 'Tashkent');
    expect(first.cached).toBe(false);
    expect(first.todayDate).toBe('2026-11-16');
    expect(first.location.name).toBe('Tashkent');
    expect(first.current.temperatureC).toBe(14.6);
    expect(first.current.uvIndex).toBe(3.2);
    expect(first.airQuality.europeanAqi).toBe(34);
    expect(first.airQuality.category).toBe('fair');

    // Legacy 24h slice starting from 2026-11-16T14:00 (excludes 13:00 and yesterday)
    expect(first.hourly).toHaveLength(4);
    expect(first.hourly[0].time).toBe('2026-11-16T14:00');
    expect(first.hourly[0].windGustsKmh).toBe(18);
    expect(first.hourly[0].windDirectionDeg).toBe(210);

    // Per-date hourly map covers past + today + future dates
    expect(first.hourlyByDate['2026-11-15']).toHaveLength(1);
    expect(first.hourlyByDate['2026-11-16']).toHaveLength(4);
    expect(first.hourlyByDate['2026-11-17']).toHaveLength(1);

    // Daily points include yesterday, today, tomorrow with flags + wind details
    expect(first.daily).toHaveLength(3);
    expect(first.daily[0]).toMatchObject({
      date: '2026-11-15',
      isPast: true,
      isToday: false,
      isWeekend: true, // Sunday 2026-11-15
      windDirectionCardinal: 'E',
      windGustsMaxKmh: 18,
      source: 'forecast',
      isLongRange: false,
    });
    expect(first.daily[1]).toMatchObject({
      date: '2026-11-16',
      isPast: false,
      isToday: true,
      isWeekend: false,
      windDirectionCardinal: 'SW',
      humidityMean: 49,
      pressureMeanHpa: 1018,
      studyTipKey: 'pleasant',
    });
    expect(first.daily[2]).toMatchObject({
      date: '2026-11-17',
      windDirectionCardinal: 'NW',
      studyTipKey: 'rain',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);

    const second = await service.getWeather(41.2995, 69.2401, 'Main Campus');
    expect(second.cached).toBe(true);
    expect(second.location.name).toBe('Main Campus');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);

    const refreshed = await service.getWeather(
      41.2995,
      69.2401,
      'Main Campus',
      true,
    );
    expect(refreshed.cached).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(4);
  });

  it('merges Forecast API + Ensemble API for monthly rolling outlook and computes summary', async () => {
    const cache = buildCacheMock();
    const service = new WeatherService(cache as any);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('ensemble-api')) {
        return { data: sampleEnsemblePayload } as any;
      }
      return { data: sampleForecastPayload } as any;
    });

    const monthly = await service.getMonthlyWeather({
      lat: 41.2995,
      lon: 69.2401,
      cityName: 'Tashkent',
    });

    expect(monthly.cached).toBe(false);
    expect(monthly.month).toBe('rolling-30d');
    expect(monthly.todayDate).toBe('2026-11-16');

    // Rolling default (pastDays=0) excludes 2026-11-15, keeps 16..19
    expect(monthly.days.map((d) => d.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ]);

    // Forecast takes precedence over Ensemble on overlapping dates (16 & 17)
    expect(monthly.days[0].tempMaxC).toBe(16.4);
    expect(monthly.days[0].source).toBe('forecast');
    expect(monthly.days[0].isLongRange).toBe(false);

    // Days 18 & 19 come from Ensemble with averaged temps, circular wind direction, and mode code
    expect(monthly.days[2]).toMatchObject({
      date: '2026-11-18',
      tempMaxC: 17,
      tempMinC: 6,
      weatherCode: 3,
      windSpeedMaxKmh: 15,
      windDirectionDeg: 0,
      windDirectionCardinal: 'N',
      precipitationProbabilityMax: 67,
      source: 'ensemble',
      isLongRange: true,
    });

    expect(monthly.hourlyByDate['2026-11-16']).toHaveLength(4);
    expect(monthly.hourlyByDate['2026-11-18']).toBeUndefined();

    expect(monthly.summary).toEqual({
      totalDays: 4,
      warmestDay: { date: '2026-11-19', tempMaxC: 19 },
      coldestDay: { date: '2026-11-17', tempMinC: 4 },
      rainyDaysCount: 2,
      avgTempMaxC: 16.1,
      avgTempMinC: 5.6,
      totalPrecipitationMm: 6.7,
    });

    // Second call uses cache
    const cached = await service.getMonthlyWeather({
      lat: 41.2995,
      lon: 69.2401,
      cityName: 'Campus',
    });
    expect(cached.cached).toBe(true);
    expect(cached.location.name).toBe('Campus');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('filters calendar month and degrades gracefully when Ensemble API fails', async () => {
    const service = new WeatherService(undefined);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('ensemble-api')) {
        throw new Error('Ensemble down');
      }
      return { data: sampleForecastPayload } as any;
    });

    const nov = await service.getMonthlyWeather({
      lat: 41.3,
      lon: 69.24,
      month: '2026-11',
    });
    expect(nov.month).toBe('2026-11');
    expect(nov.days).toHaveLength(3);

    await expect(
      service.getMonthlyWeather({
        lat: 41.3,
        lon: 69.24,
        month: '2025-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('degrades gracefully when air quality API fails', async () => {
    const service = new WeatherService(undefined);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('air-quality-api')) {
        throw new Error('AQ timeout');
      }
      return {
        data: {
          ...sampleForecastPayload,
          current: {
            ...sampleForecastPayload.current,
            weather_code: 61,
          },
        },
      } as any;
    });

    const result = await service.getWeather(41.3, 69.24);
    expect(result.airQuality.category).toBe('unknown');
    expect(result.airQuality.europeanAqi).toBeNull();
    expect(result.studyTipKey).toBe('rain');
  });

  it('throws BadGatewayException when primary forecast API fails', async () => {
    const service = new WeatherService(undefined);
    mockedAxios.get.mockRejectedValue(new Error('Network down'));

    await expect(service.getWeather(41.3, 69.24)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('rejects partial coordinates when only lat or lon is provided', async () => {
    const service = new WeatherService(undefined);
    await expect(service.getWeather(41.3, undefined)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getWeather(undefined, 69.24)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('searches cities via geocoding API and caches results', async () => {
    const cache = buildCacheMock();
    const service = new WeatherService(cache as any);

    mockedAxios.get.mockResolvedValue({
      data: {
        results: [
          {
            id: 1512569,
            name: 'Tashkent',
            country: 'Uzbekistan',
            country_code: 'UZ',
            admin1: 'Toshkent Shahri',
            latitude: 41.26465,
            longitude: 69.21627,
            timezone: 'Asia/Tashkent',
          },
        ],
      },
    } as any);

    const first = await service.searchCities('Tashkent', 'uz', 5);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      name: 'Tashkent',
      country: 'Uzbekistan',
      countryCode: 'UZ',
    });

    const second = await service.searchCities('tashkent', 'uz', 5);
    expect(second).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('does not leak cached location.name when subsequent caller omits city', async () => {
    const cache = buildCacheMock();
    const service = new WeatherService(cache as any);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('air-quality-api')) {
        return { data: sampleAirPayload } as any;
      }
      return { data: sampleForecastPayload } as any;
    });

    const first = await service.getWeather(41.2995, 69.2401, 'Branch Alpha');
    expect(first.location.name).toBe('Branch Alpha');

    const second = await service.getWeather(41.2995, 69.2401);
    expect(second.cached).toBe(true);
    expect(second.location.name).toBeNull();
  });

  it('geocodes ?city=... when lat/lon are omitted and throws NotFoundException for unknown city', async () => {
    const cache = buildCacheMock();
    const service = new WeatherService(cache as any);

    mockedAxios.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('geocoding-api')) {
        if (config?.params?.name === 'NowhereCityXYZ') {
          return { data: { results: [] } } as any;
        }
        return {
          data: {
            results: [
              {
                id: 1216265,
                name: 'Samarkand',
                country: 'Uzbekistan',
                country_code: 'UZ',
                admin1: 'Samarqand',
                latitude: 39.6542,
                longitude: 66.9597,
                timezone: 'Asia/Samarkand',
              },
            ],
          },
        } as any;
      }
      if (url.includes('air-quality-api')) {
        return { data: sampleAirPayload } as any;
      }
      return {
        data: {
          ...sampleForecastPayload,
          latitude: 39.65,
          longitude: 66.96,
        },
      } as any;
    });

    const res = await service.getWeather(undefined, undefined, 'Samarkand');
    expect(res.location.name).toBe('Samarkand');
    expect(res.location.latitude).toBeCloseTo(39.65, 1);

    await expect(
      service.getWeather(undefined, undefined, 'NowhereCityXYZ'),
    ).rejects.toThrow(NotFoundException);
  });

  it('computes astronomical sunrise/sunset and ensembleUnavailable flag cleanly', async () => {
    const service = new WeatherService(undefined);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('ensemble-api')) {
        return { data: sampleEnsemblePayload } as any;
      }
      return { data: sampleForecastPayload } as any;
    });

    const monthly = await service.getMonthlyWeather({
      lat: 41.2995,
      lon: 69.2401,
      cityName: 'Tashkent',
    });

    // Ensemble day 2026-11-18 gets computed sunrise & sunset in Tashkent (~07:xx / ~17:xx)
    const day18 = monthly.days.find((d) => d.date === '2026-11-18');
    expect(day18?.sunrise).toMatch(/^2026-11-18T0[67]:\d{2}$/);
    expect(day18?.sunset).toMatch(/^2026-11-18T1[67]:\d{2}$/);
    expect(monthly.ensembleUnavailable).toBeUndefined();

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('ensemble-api')) {
        throw new Error('Ensemble timeout');
      }
      return { data: sampleForecastPayload } as any;
    });

    const degraded = await service.getMonthlyWeather({
      lat: 41.2995,
      lon: 69.2401,
      month: '2026-11',
    });
    expect(degraded.ensembleUnavailable).toBe(true);
  });

  it('returns localized error messages for uz, ru, en', async () => {
    const service = new WeatherService(undefined);
    await expect(
      service.getWeather(41.3, undefined, undefined, false, { lang: 'ru' }),
    ).rejects.toThrow('Параметры lat и lon должны передаваться вместе');

    await expect(
      service.getWeather(41.3, undefined, undefined, false, { lang: 'uz' }),
    ).rejects.toThrow('lat va lon parametrlari birgalikda yuborilishi shart');
  });
});

describe('Weather DTO validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
  });

  it('validates GetWeatherQueryDto and rejects out-of-range coordinates', async () => {
    const valid = await pipe.transform(
      { lat: '41.3', lon: '69.24', refresh: 'true', lang: 'uz', days: '7', pastDays: '0' },
      { type: 'query', metatype: GetWeatherQueryDto },
    );
    expect(valid).toMatchObject({
      lat: 41.3,
      lon: 69.24,
      refresh: true,
      lang: 'uz',
      days: 7,
      pastDays: 0,
    });

    await expect(
      pipe.transform({ lat: '120', lon: '69.24' }, { type: 'query', metatype: GetWeatherQueryDto }),
    ).rejects.toThrow(BadRequestException);
  });

  it('validates GetMonthlyWeatherQueryDto month format and SearchCitiesQueryDto length', async () => {
    await expect(
      pipe.transform({ month: '2026-13' }, { type: 'query', metatype: GetMonthlyWeatherQueryDto }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      pipe.transform({ q: 'a' }, { type: 'query', metatype: SearchCitiesQueryDto }),
    ).rejects.toThrow(BadRequestException);
  });
});
