import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  GetMonthlyWeatherQueryDto,
  GetWeatherQueryDto,
  SearchCitiesQueryDto,
} from './dto/weather-query.dto';
import { WeatherService } from './weather.service';

@ApiTags('Weather')
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get()
  @ApiOperation({
    summary:
      'Get current weather, hourly (next 24h + grouped by date), up to 16-day forecast + past days, and AQI',
  })
  getWeather(@Query() query: GetWeatherQueryDto) {
    return this.weatherService.getWeather(
      query.lat,
      query.lon,
      query.city,
      query.refresh,
      {
        days: query.days,
        pastDays: query.pastDays,
        lang: query.lang,
      },
    );
  }

  @Get('monthly')
  @ApiOperation({
    summary:
      'Get 30-day rolling or calendar-month weather forecast combining Forecast API and Ensemble API',
  })
  getMonthlyWeather(@Query() query: GetMonthlyWeatherQueryDto) {
    return this.weatherService.getMonthlyWeather({
      lat: query.lat,
      lon: query.lon,
      cityName: query.city,
      forceRefresh: query.refresh,
      month: query.month,
      pastDays: query.pastDays,
      lang: query.lang,
    });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search cities by name via Open-Meteo Geocoding' })
  searchCities(@Query() query: SearchCitiesQueryDto) {
    return this.weatherService.searchCities(query.q, query.lang, query.count);
  }
}
