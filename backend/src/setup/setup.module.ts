import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { UserModule } from 'src/user/user.module';
import { SetupService } from './setup.service';

@Module({
  imports: [UserModule],
  controllers: [SetupController],
  providers: [SetupService]
})
export class SetupModule { }
