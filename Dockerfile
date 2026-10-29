FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN bun run check && bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 MAX_PLAYERS=6
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/public ./public
USER bun
EXPOSE 3000
CMD ["bun", "src/server/index.ts"]
