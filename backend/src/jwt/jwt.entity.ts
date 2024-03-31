import { Entity, PrimaryColumn } from "typeorm";

@Entity()
export class JwtEntity {
    @PrimaryColumn()
    secret: string;
}