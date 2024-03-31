import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticateDto } from './dtos/authenticate.dto';

@Controller('auth')
export class AuthController {

    constructor(private readonly authService: AuthService) { }

    @Post()
    async authenticate(@Body() body: AuthenticateDto) {
        const { username, password } = body;
        return await this.authService.signIn({ username, password });
    }

}
