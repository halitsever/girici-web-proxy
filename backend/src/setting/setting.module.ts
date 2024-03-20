import { Module } from '@nestjs/common';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingEntity } from './setting.entity';
@Module({
  imports: [TypeOrmModule.forFeature([
    SettingEntity
  ])],
  controllers: [SettingController],
  providers: [SettingService]
})
export class SettingModule { }
