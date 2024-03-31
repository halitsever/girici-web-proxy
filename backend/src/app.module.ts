import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { SettingModule } from './setting/setting.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import { SetupModule } from './setup/setup.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { JwtModule } from './jwt/jwt.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  imports: [
    SettingModule,
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'db.sqlite',
      autoLoadEntities: true,
      synchronize: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
    }),
    UserModule,
    SetupModule,
    AuthModule,
    HealthModule,
    JwtModule,
    ProxyModule]
})
export class AppModule {

}
