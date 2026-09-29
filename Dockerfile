# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY front/package.json front/package.json
COPY admin-panel/package.json admin-panel/package.json
COPY backend/package.json backend/package.json
RUN npm ci
COPY front front
COPY admin-panel admin-panel
COPY backend backend
ARG VITE_S3_ENDPOINT=http://localhost:9000
ARG VITE_S3_BUCKET=photos
ARG VITE_SITE_TITLE=Фото
ENV VITE_S3_ENDPOINT=$VITE_S3_ENDPOINT \
    VITE_S3_BUCKET=$VITE_S3_BUCKET \
    VITE_SITE_TITLE=$VITE_SITE_TITLE
RUN npm run build -w front && npm run build -w admin-panel && npm run build -w backend

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY front/package.json front/package.json
COPY admin-panel/package.json admin-panel/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src backend/src
COPY backend/scripts backend/scripts
COPY --from=build /app/front/dist front/dist
COPY --from=build /app/admin-panel/dist admin-panel/dist
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "backend/src/index.ts"]
