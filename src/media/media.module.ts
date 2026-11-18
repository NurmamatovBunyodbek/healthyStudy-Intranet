import { Module } from '@nestjs/common';
import { ImageKitService } from '../common/services/imagekit.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [MediaController],
  providers: [ImageKitService],
  exports: [ImageKitService],
})
export class MediaModule {}
