import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from 'src/jwt/jwt.service';

@Injectable()
export class AuthGuard implements CanActivate {

  constructor(private readonly jwtService: JwtService) { }

  async canActivate(
    context: ExecutionContext,
  ) {

    const request = context.switchToHttp().getRequest();

    const token = request.headers['authorization'];

    if (!token) throw new UnauthorizedException();

    const decodedToken = await this.jwtService.verifyJwt(token);

    request.user = decodedToken;

    return true;
  }
}
