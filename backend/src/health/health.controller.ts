import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
    @Get()
    healthStatus() {
        return { status: "OK" }
    }
}
