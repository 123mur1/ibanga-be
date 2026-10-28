import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendImage } from '../common/data-url';
import { UsersService } from './users.service';

/**
 * Profile photos for <img> tags, which cannot send the sign-in token. The users controller is
 * admin-only, so this lives apart. A photo is reachable only with the user's random id.
 */
@Controller('users')
export class UserPhotosController {
  constructor(private users: UsersService) {}

  @Get(':id/photo')
  async photo(
    @Param('id') id: string,
    @Query('v') version: string | undefined,
    @Res() res: Response,
  ) {
    sendImage(res, await this.users.photo(id, version ?? ''), version);
  }
}
