import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './setting.entity';
import { SettingDto } from './dtos/setting.dto';

@Injectable()
export class SettingService {
    constructor(
        @InjectRepository(SettingEntity)
        private settingRepository: Repository<SettingEntity>,
    ) { }

    async findAll() {
        return await this.settingRepository.find();
    }

    async addSetting(key, value) {
        const setting = new SettingEntity();
        setting.key = key;
        setting.value = value;
        await this.settingRepository.save(setting);
    }


    async updateSetting(keyObject: SettingDto) {
        if (!keyObject || Object.keys(keyObject).length <= 0) throw new BadRequestException('No key provided');
        const [key, value]: [string, boolean] = Object.entries(keyObject)[0];
        const setting = await this.settingRepository.findOne({ where: { key } });
        setting.value = value;
        await this.settingRepository.save(setting);
    }
}
