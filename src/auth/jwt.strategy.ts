import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UserSessionCache } from '../prisma/user-session-cache';

type JwtPayload = { sub: string; email: string; role: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private sessions: UserSessionCache,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'ibanga-dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const user =
      this.sessions.get(payload.sub) ??
      (await this.prisma.user.findUnique({ where: { id: payload.sub } }));
    if (!user || !user.active) {
      this.sessions.invalidate(payload.sub);
      throw new UnauthorizedException();
    }
    this.sessions.set(user);
    return user;
  }
}
