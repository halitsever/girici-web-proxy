import { IsString } from "class-validator";

export class AuthenticateDto {
    @IsString()
    username: string;

    @IsString()
    password: string;
}