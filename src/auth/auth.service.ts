import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { EmailService } from './email.service';

const PUBLIC_USER = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  location: true,
  company: true,
  photo: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private email: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Admin accounts cannot be self-registered.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('That email is already registered.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        location: dto.location,
        role: dto.role,
        passwordHash,
      },
      select: PUBLIC_USER,
    });

    return this.withToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      location: user.location,
      company: user.company,
      photo: user.photo,
    };

    return this.withToken(publicUser);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER,
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async requestPasswordReset(email: string) {
    this.email.assertConfigured();
    const frontendUrl = process.env.FRONTEND_URL;

    const message =
      'If that email is registered, a password reset link will be sent.';
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return { message };
    }

    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = new URL('/reset-password', frontendUrl);
    resetUrl.searchParams.set('token', rawToken);

    try {
      await this.email.sendPasswordResetEmail(user.email, resetUrl.toString());
    } catch (error) {
      await this.prisma.passwordResetToken.deleteMany({
        where: { tokenHash },
      });
      this.logger.error(
        'Password reset email delivery failed.',
        error instanceof Error ? error.message : undefined,
      );
    }

    return { message };
  }

  async resetPassword(token: string, newPassword: string) {
    const rawToken = token?.trim();
    if (!rawToken) {
      throw new BadRequestException('A reset token is required.');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const resetTokenRecord = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });

    if (!resetTokenRecord || !resetTokenRecord.user) {
      throw new BadRequestException(
        'This password reset link is invalid or has expired.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: resetTokenRecord.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: resetTokenRecord.id },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.deleteMany({
      where: {
        userId: resetTokenRecord.userId,
        id: { not: resetTokenRecord.id },
      },
    });

    return { message: 'Password reset successful.' };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone.trim() }),
        ...(dto.location === undefined
          ? {}
          : { location: dto.location.trim() }),
        ...(dto.company === undefined ? {} : { company: dto.company.trim() }),
        ...(dto.photo === undefined ? {} : { photo: dto.photo }),
      },
      select: PUBLIC_USER,
    });
  }

  private withToken(user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: User['role'];
    location: string | null;
    company: string | null;
    photo: string | null;
  }) {
    const token = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { token, user };
  }
}
