import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { SettingEntity } from '../setting/setting.entity';
import { RoleType } from "./role.enum";
@Entity()
export class UserEntity {

    @PrimaryGeneratedColumn()
    id: string;

    @OneToOne(() => SettingEntity, { cascade: true })
    @JoinColumn()
    setting: SettingEntity;


    @Column()
    username: string;

    @Column()
    password: string;

    @Column()
    role: RoleType;

}