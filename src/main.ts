import * as path from 'path';
import * as fastify from 'fastify';
import * as helmet from 'helmet';
import * as fs from 'fs-extra';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { Logger } from './core/logger/logger.service';
import { SpaFilter } from './core/spa/spa.filter';
import { ConfigService } from './core/config/config.service';
import { getStartupConfig } from './core/config/config.startup';

process.env.UIX_BASE_PATH = path.resolve(__dirname, '../');

async function bootstrap() {
  const startupConfig = await getStartupConfig();

  const server = fastify({
    https: startupConfig.httpsOptions,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(server),
    {
      logger: startupConfig.debug ? new Logger() : false,
      httpsOptions: startupConfig.httpsOptions,
    },
  );

  const configService: ConfigService = app.get(ConfigService);
  const logger: Logger = app.get(Logger);

  // helmet security headers
  app.use(helmet({
    hsts: false,
    frameguard: false,
    referrerPolicy: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        scriptSrc: ['\'self\'', '\'unsafe-inline\'', '\'unsafe-eval\''],
        styleSrc: ['\'self\'', '\'unsafe-inline\''],
        imgSrc: ['\'self\'', 'data:', 'https://raw.githubusercontent.com'],
        workerSrc: ['blob:'],
        connectSrc: ['\'self\'', (req) => {
          return `wss://${req.headers.host} ws://${req.headers.host} ${startupConfig.cspWsOveride || ''}`;
        }],
      },
    },
  }));

  // serve static assets with a long cache timeout
  app.useStaticAssets({
    root: path.resolve(process.env.UIX_BASE_PATH, 'public'),
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
    },
  });

  // serve index.html without a cache
  app.getHttpAdapter().get('/', (req, res) => {
    res.type('text/html');
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.sendFile('index.html');
  });

  // login page image
  app.getHttpAdapter().get('/assets/snapshot.jpg', async (req, res) => {
    if (configService.ui.loginWallpaper) {
      if (!await fs.pathExists(configService.ui.loginWallpaper)) {
        logger.error(`Custom Login Wallpaper does not exist: ${configService.ui.loginWallpaper}`);
        return res.code(404).send('Not Found');
      }
      res.type('image/jpg');
      res.header('Cache-Control', 'public,max-age=31536000,immutable');
      res.send(await fs.readFile(path.resolve(configService.ui.loginWallpaper)));
    } else {
      res.header('Cache-Control', 'public,max-age=31536000,immutable');
      res.sendFile('assets/snapshot.jpg');
    }
  });

  // set prefix
  app.setGlobalPrefix('/api');

  // setup cors
  app.enableCors({
    origin: ['http://localhost:8080', 'http://localhost:4200'],
  });

  // validation pipes
  // https://github.com/typestack/class-validator
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    skipMissingProperties: true,
  }));

  // serve spa on all 404
  app.useGlobalFilters(new SpaFilter());

  logger.warn(`Console v${configService.package.version} is listening on port ${configService.ui.port}`);
  await app.listen(configService.ui.port || 8080, '0.0.0.0');
}
bootstrap();
