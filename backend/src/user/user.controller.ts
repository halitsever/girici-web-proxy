import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { AuthGuard } from 'src/auth/auth.guard';

@Controller('user')
export class UserController {

    constructor(private readonly userService: UserService) { }

    @UseGuards(AuthGuard)
    @Get('me')
    async me(@Req() request) {
        const user = request.user;
        return this.userService.me(user);
    }

}
