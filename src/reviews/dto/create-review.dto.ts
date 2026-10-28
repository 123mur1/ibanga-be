import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  @IsInt({ message: 'Choose a rating from 1 to 5 stars.' })
  @Min(1, { message: 'Choose a rating from 1 to 5 stars.' })
  @Max(5, { message: 'Choose a rating from 1 to 5 stars.' })
  rating: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10, {
    message: 'Write at least a short sentence about your experience.',
  })
  @MaxLength(1000, { message: 'Keep the review under 1000 characters.' })
  comment: string;
}
