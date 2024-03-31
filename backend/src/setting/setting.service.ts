import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './setting.entity';

@Injectable()
export class SettingService {
    constructor(
        @InjectRepository(SettingEntity)
        private settingRepository: Repository<SettingEntity>,
    ) { }

    async getSettings(userId: string) {
        const settings = await this.settingRepository.findOne({
            where: {
                id: userId
            }
        })

        if (!settings) throw new NotFoundException();
        return settings;
    }

    async updateSetting({ id, key, value }) {
        const setting = await this.getSettings(id);
        setting[key] = value;
        this.settingRepository.save(setting);
        return { id, key, value }
    }

    async getSettingKeys() {
        return this.settingRepository.metadata.columns.map(column => column.propertyName);
    }


}
