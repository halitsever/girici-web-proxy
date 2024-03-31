import { IsString, IsUrl } from 'class-validator';

export class ProxyDto {

    @IsString()
    url: string;
}