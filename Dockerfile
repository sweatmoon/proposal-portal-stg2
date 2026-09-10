# ── 1단계: 빌드 ──────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /app

# 의존성 먼저 설치 (캐시 활용)
COPY package*.json ./
RUN npm ci

# 소스 복사 후 빌드
COPY tsconfig.build.json ./
COPY src ./src
COPY public ./public
RUN npm run build
# schema.sql을 dist/db/에 복사 (migrate.js가 런타임에 읽음)
RUN cp src/db/schema.sql dist/db/schema.sql

# ── 2단계: 실행 ──────────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# 프로덕션 의존성만 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 빌드 결과물 복사 (dist/ 안에 static/ 포함)
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
