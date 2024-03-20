import { Body, Controller, Get, Post } from '@nestjs/common';
import { SettingService } from './setting.service';
import { SettingDto } from './dtos/setting.dto';

@Controller('setting')
export class SettingController {

    constructor(private readonly settingService: SettingService) { }

    @Get('list')
    async getSetting() {
        return this.settingService.findAll();
    }


    @Post('update')
    async updateSetting(@Body() settingDto: SettingDto) {
        return await this.settingService.updateSetting(settingDto)
    }

}
