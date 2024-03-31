import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SettingService } from './setting.service';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateSettingDto } from './dtos/updatesetting.dto';


@Controller('setting')
@UseGuards(AuthGuard)
export class SettingController {

    constructor(private readonly settingService: SettingService) { }

    @Get('list')
    async getSetting(@Req() request) {
        const user = request.user;
        return this.settingService.getSettings(
            user.id
        );
    }

    @Post('set')
    async setSetting(@Body() body: UpdateSettingDto, @Req() request) {
        const user = request.user;
        const { key, value } = body;

        const availableKeys = await this.settingService.getSettingKeys();
        if (key === 'id' || !availableKeys.includes(key)) throw new BadRequestException();


        const result = await this.settingService.updateSetting(
            { id: user.id, key, value }
        );

        return {
            status: 200,
            data: result
        }
    }


}
