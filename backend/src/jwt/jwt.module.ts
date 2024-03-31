import { Module } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtEntity } from './jwt.entity';

@Module({
  imports: [TypeOrmModule.forFeature([
    JwtEntity
  ])],
  providers: [JwtService],
  exports: [JwtService]
})
export class JwtModule { }
