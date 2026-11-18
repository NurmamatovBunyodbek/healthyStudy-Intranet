import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IntranetAuthGuard } from '../common/auth/intranet-auth.guard';
import { ImageKitService } from '../common/services/imagekit.service';

@ApiTags('Media')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(IntranetAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly imageKitService: ImageKitService) {}

  @Get('upload-auth')
  @ApiOperation({
    summary: 'Get signed ImageKit upload parameters for Intranet & external REST clients',
  })
  getUploadAuth() {
    return this.imageKitService.getUploadAuthenticationParameters();
  }
}
