FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DEMO_MODE=true
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime-tools
RUN npm install --global prisma@6.19.3 tsx@4.20.6

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache ffmpeg tini
COPY --from=runtime-tools /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/node_modules/@img ./node_modules/@img
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN ln -s ../lib/node_modules/prisma/build/index.js /usr/local/bin/prisma \
    && ln -s ../lib/node_modules/tsx/dist/cli.mjs /usr/local/bin/tsx \
    && chmod +x ./docker-entrypoint.sh \
    && mkdir -p /app/storage
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
