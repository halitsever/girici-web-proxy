import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { SettingModule } from './setting/setting.module';
import { TypeOrmModule } from '@nestjs/typeorm';

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
    })]
})
export class AppModule {

}
