import { Injectable, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './user.entitiy';
import { Repository } from 'typeorm';
import { SettingEntity } from 'src/setting/setting.entity';
import { Role } from './role.enum';

@Injectable()
export class UserService {
    constructor(@InjectRepository(UserEntity) private userRepository: Repository<UserEntity>) { }

    createUser({ username, password, role }) {
        // TODO: IMPORTANT - use bcrypt to hash password
        const user = new UserEntity();
        user.setting = new SettingEntity();
        user.username = username;
        user.password = password;
        user.role = role;
        return this.userRepository.save(user);
    }


    async me(user) {
        return user;
    }

    async find({ username }) {
        return this.userRepository.findOne({
            where: {
                username
            }
        });
    }

    async findAdminUser() {
        return this.userRepository.findOne({
            where: {
                role: Role.ADMIN
            }
        })
    }
}
