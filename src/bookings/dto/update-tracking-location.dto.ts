import { IsNumber, Max, Min } from 'class-validator';

export class UpdateTrackingLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracy: number;
}
