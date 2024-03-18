import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ProxyAgent } from "proxy-agent";
import * as proxyMiddleware from 'unblocker';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const agent = new ProxyAgent();
  // TODO: change middleware with new one
  app.use(proxyMiddleware({ prefix: "/proxy/", httpAgent: agent, httpsAgent: agent }));
  
  

  await app.listen(3000);
}
bootstrap();
