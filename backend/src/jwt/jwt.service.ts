import { Injectable, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtEntity } from './jwt.entity';
import { Not, Repository, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
const jwt = require("jsonwebtoken");

@Injectable()
export class JwtService implements OnApplicationBootstrap {

    constructor(@InjectRepository(JwtEntity) private jwtRepository: Repository<JwtEntity>) { }

    async onApplicationBootstrap() {
        const availableJwtSecret = await this.jwtRepository.find();
        if (availableJwtSecret.length > 0) {
            return;
        }
        const jwtConfig = new JwtEntity();
        jwtConfig.secret = randomBytes(32).toString('hex');
        await this.jwtRepository.save(jwtConfig);
    }

    async getJwtToken() {
        return await this.jwtRepository.findOne({
            where: {
                secret: Not(IsNull())
            }
        });
    }


    async signJwt(payload, expireTime) {
        return await jwt.sign(payload, (await this.getJwtToken()).secret, { expiresIn: expireTime });
    }


    async verifyJwt(token) {

        try {
            return await jwt.verify(token, (await this.getJwtToken()).secret);

        }
        catch (err) {

            throw new UnauthorizedException();

        }
    }



}
