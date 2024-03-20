import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity()
export class SettingEntity {
    @PrimaryColumn()
    key: string;

    @Column({ default: false })
    value: boolean;
}