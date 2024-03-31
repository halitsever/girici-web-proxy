import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { JwtModule } from 'src/jwt/jwt.module';

@Module({
  controllers: [ProxyController],
  providers: [ProxyService],
  imports: [JwtModule]
})
export class ProxyModule { }
