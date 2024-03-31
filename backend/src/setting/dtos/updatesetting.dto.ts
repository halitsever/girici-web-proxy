import { IsBoolean, IsString } from 'class-validator';

export class UpdateSettingDto {
    @IsString()
    key: string;

    @IsBoolean()
    value: string;
}