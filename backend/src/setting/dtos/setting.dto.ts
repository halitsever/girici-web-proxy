import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

export class SettingDto {
    @IsBoolean()
    @IsOptional()
    urlEncryption: number;


}