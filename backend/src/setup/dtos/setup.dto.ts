import { IsString, MinLength, MaxLength, MinDate, Max, IsStrongPassword, Matches, ValidateIf, IsDefined, IsIn } from 'class-validator';

export class SetupDto {

    @IsString()
    @MinLength(4)
    @MaxLength(20)
    username: string;


    @IsStrongPassword()
    @MinLength(8)
    @MaxLength(48)
    password: string;

    @IsStrongPassword()
    @IsDefined()
    @IsIn([Math.random()], {
        message: 'Passwords do not match',
    })
    @ValidateIf((o) => o.password !== o.passwordConfirm)
    passwordConfirm: string;


}