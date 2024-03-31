import { Body, Controller, Get, Post } from '@nestjs/common';
import { SetupDto } from './dtos/setup.dto';
import { SetupService } from 'src/setup/setup.service';
import { Role } from 'src/user/role.enum';

@Controller('setup')
export class SetupController {
    constructor(private readonly setupService: SetupService) { }

    @Get('status')
    async status() {
        const setupStatus = await this.setupService.checkSetupStatus();
        return setupStatus;
    }

    @Post()
    async setup(@Body() body: SetupDto) {
        const { username, password } = body;
        await this.setupService.createAdminUser({ username, password, role: Role.ADMIN });
        return { status: 200, setup: true, message: "Completed" }
    }
}
