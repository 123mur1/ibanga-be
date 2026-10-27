import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class SaveOperationsRecordDto {
  @IsObject()
  data!: Record<string, JsonValue>;

  @IsOptional()
  @IsBoolean()
  draft?: boolean;
}
