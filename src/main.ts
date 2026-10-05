import 'dotenv/config';
import express, { type Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

const allowedOrigins = new Set(
  [
    'http://localhost:3000',
    'https://ibanga-fe-1fkh.vercel.app',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS ?? '').split(','),
  ]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => origin.trim()),
);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableCors({
    origin: (origin, callback) =>
      callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  });
  const server = app.getHttpAdapter().getInstance() as Express;
  server.use(express.json({ limit: '10mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3001);
  console.log(
    `iBanga API running on http://localhost:${process.env.PORT ?? 3001}`,
  );
}
void bootstrap();
