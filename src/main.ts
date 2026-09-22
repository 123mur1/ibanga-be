import 'dotenv/config';
import express, { type Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:3000'],
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
