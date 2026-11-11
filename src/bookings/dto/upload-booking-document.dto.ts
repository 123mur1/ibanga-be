import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class UploadBookingDocumentDto {
  @IsIn(['CARGO', 'TAX', 'OTHER'])
  kind: 'CARGO' | 'TAX' | 'OTHER';

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  /** The file as a data URL; the service checks its type and size (5 MB). */
  @IsString()
  @MaxLength(7_500_000)
  dataUrl: string;
}
