import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class BaseLocationWeatherQueryDto {
  @ApiPropertyOptional({ example: 41.2995 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 69.2401 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number;

  @ApiPropertyOptional({ example: 'Tashkent' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  refresh?: boolean;

  @ApiPropertyOptional({ enum: ['uz', 'ru', 'en'], default: 'en' })
  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en';
}

export class GetWeatherQueryDto extends BaseLocationWeatherQueryDto {
  @ApiPropertyOptional({
    example: 16,
    minimum: 1,
    maximum: 16,
    description: 'Number of forecast days starting from today (default 16)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  days?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    maximum: 7,
    description: 'Number of past days to include (default 1 for yesterday)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7)
  pastDays?: number;
}

export class GetMonthlyWeatherQueryDto extends BaseLocationWeatherQueryDto {
  @ApiPropertyOptional({
    example: '2026-11',
    description:
      'Optional calendar month (YYYY-MM). Omit for rolling 30-day outlook from today.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be in YYYY-MM format',
  })
  month?: string;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    maximum: 31,
    description:
      'Optional past days to prepend in rolling mode (ignored when month is specified)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  pastDays?: number;
}

export class SearchCitiesQueryDto {
  @ApiProperty({ example: 'Samarkand' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({ enum: ['uz', 'ru', 'en'], default: 'en' })
  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en';

  @ApiPropertyOptional({ example: 6, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  count?: number;
}
