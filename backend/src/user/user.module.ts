import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entitiy';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { JwtModule } from 'src/jwt/jwt.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), JwtModule],
  exports: [UserService],
  providers: [UserService],
  controllers: [UserController]
})
export class UserModule { }
