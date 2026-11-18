import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { IntranetAuthenticatedRequest } from '../common/auth/auth.types';
import { IntranetRoles } from '../common/auth/decorators';
import { IntranetAuthGuard } from '../common/auth/intranet-auth.guard';
import { IntranetRolesGuard } from '../common/auth/roles.guard';
import {
  CreateLostFoundClaimDto,
  CreateLostFoundItemDto,
  ListLostFoundQueryDto,
  MarkItemReturnedDto,
  ResolveLostFoundClaimDto,
  UpdateLostFoundItemDto,
} from './dto/lost-found.dto';
import { LostFoundService } from './lost-found.service';

@ApiTags('Lost & Found')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@ApiHeader({
  name: 'x-tenant-id',
  required: false,
  description: 'Optional multi-project namespace (defaults to healthystudy)',
})
@UseGuards(IntranetAuthGuard)
@Controller('lost-found')
export class LostFoundController {
  constructor(private readonly lostFoundService: LostFoundService) {}

  @Get()
  @ApiOperation({ summary: 'List Lost & Found items with filters and pagination' })
  list(
    @Query() query: ListLostFoundQueryDto,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.listItems(query, req.user);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get Lost & Found summary counts for an organization' })
  stats(
    @Query('organizationId') organizationId: string,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.getStats(organizationId, req.user);
  }

  @Get('admin/queue')
  @UseGuards(IntranetRolesGuard)
  @IntranetRoles('superadmin', 'admin')
  @ApiOperation({ summary: 'Get reception verification queue, active items, and audit history' })
  adminQueue(
    @Query('organizationId') organizationId: string,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.getAdminQueue(organizationId, req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single item detail (sensitive fields masked unless authorized)' })
  getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('organizationId') organizationId: string | undefined,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.getItem(id, req.user, organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new lost/found item report and get smart matches' })
  create(
    @Body() dto: CreateLostFoundItemDto,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.createItem(dto, req.user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a Lost & Found item (reporter or admin)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLostFoundItemDto,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.updateItem(id, dto, req.user);
  }

  @Post(':id/claims')
  @ApiOperation({ summary: 'Submit ownership claim or finder report with proof message' })
  createClaim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateLostFoundClaimDto,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.createClaim(id, dto, req.user);
  }

  @Patch('claims/:claimId/resolve')
  @ApiOperation({ summary: 'Approve or reject a claim (admin/reception or reporter)' })
  resolveClaim(
    @Param('claimId', new ParseUUIDPipe()) claimId: string,
    @Body() dto: ResolveLostFoundClaimDto,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.resolveClaim(claimId, dto, req.user);
  }

  @Patch(':id/return')
  @ApiOperation({ summary: 'Mark item as returned to owner and record handover audit log' })
  markReturned(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarkItemReturnedDto,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.markReturned(id, dto, req.user);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive an open item' })
  archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.archiveItem(id, req.user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an item (admin or reporter)' })
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: IntranetAuthenticatedRequest,
  ) {
    return this.lostFoundService.deleteItem(id, req.user);
  }
}
