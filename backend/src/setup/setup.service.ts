import { HttpException, Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';

@Injectable()
export class SetupService {


    constructor(private readonly userService: UserService) { }
    async checkSetupStatus() {
        const adminUser = await this.userService.findAdminUser();
        return adminUser ? { setup: true, message: "Completed" } : { setup: false, message: "Not completed" };
    }

    async createAdminUser({ username, password, role }) {
        const adminUser = await this.userService.findAdminUser();
        if (adminUser) throw new HttpException('Setup already comnpleted', 500);

        return await this.userService.createUser({ username, password, role });
    }
}
