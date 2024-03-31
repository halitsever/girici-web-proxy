import { Body, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from 'src/jwt/jwt.service';
import { UserService } from 'src/user/user.service';

@Injectable()
export class AuthService {

    constructor(private readonly jwtService: JwtService, private readonly userService: UserService) { }

    async signIn({ username, password }) {
        const user = await this.userService.find({ username });
        if (!user || user.password !== password) throw new UnauthorizedException();

        return {
            token: await this.jwtService.signJwt({ id: user.id, username: user.username }, '1h')
        };
    }

}
