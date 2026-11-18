import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LostFoundClaimEntity } from '../database/entities/lost-found-claim.entity';
import { LostFoundItemEntity } from '../database/entities/lost-found-item.entity';
import { LostFoundController } from './lost-found.controller';
import { LostFoundService } from './lost-found.service';

@Module({
  imports: [TypeOrmModule.forFeature([LostFoundItemEntity, LostFoundClaimEntity])],
  controllers: [LostFoundController],
  providers: [LostFoundService],
  exports: [LostFoundService],
})
export class LostFoundModule {}
