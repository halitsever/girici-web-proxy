import { Module } from '@nestjs/common';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingEntity } from './setting.entity';
import { JwtModule } from 'src/jwt/jwt.module';

@Module({
  imports: [TypeOrmModule.forFeature([
    SettingEntity
  ]), JwtModule],
  controllers: [SettingController],
  providers: [SettingService]
})
export class SettingModule { }
