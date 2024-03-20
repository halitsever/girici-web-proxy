import { IsBoolean, IsOptional } from 'class-validator';

export class SettingDto {
    @IsBoolean()
    @IsOptional()
    urlEncryption: boolean;
}