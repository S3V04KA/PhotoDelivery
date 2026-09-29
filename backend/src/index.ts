import 'dotenv/config';
import { createApp } from './app';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, LoginRateLimiter } from './auth/rate-limit';
import { criticalEnvMissing, loadConfig } from './config';
import { MediaPreviewer } from './services/preview';
import { AwsObjectStore } from './services/s3';

const missing = criticalEnvMissing(process.env);
if (missing.length > 0) {
  console.error(
    `[photo-delivery] не заданы обязательные переменные окружения: ${missing.join(', ')}. ` +
      'Скопируйте backend/.env.example в backend/.env и заполните значения. Сервер не запущен.',
  );
  process.exit(1);
}

const config = loadConfig(process.env);

const app = createApp({
  config,
  store: new AwsObjectStore(config.s3),
  previewer: new MediaPreviewer({ thumbSize: config.thumbSize, thumbQuality: config.thumbQuality }),
  limiter: new LoginRateLimiter(LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS),
  logger: console,
});

app.listen(config.port, () => {
  console.log(`[photo-delivery] сервер слушает :${config.port}, бакет «${config.s3.bucket}»`);
});
