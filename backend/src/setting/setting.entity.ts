import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class SettingEntity {
    @PrimaryGeneratedColumn()
    id: string;

    @Column({ default: false })
    url_encryption: boolean;
}