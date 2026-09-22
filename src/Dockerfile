FROM node:22-alpine AS build

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY server.ts ./
COPY lib ./lib
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    WEB_PORT=3200 \
    MCP_PORT=3201

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
COPY --chown=node:node builtin-skills ./builtin-skills

RUN mkdir -p /app/skills /app/data && chown -R node:node /app/skills /app/data

USER node
EXPOSE 3200 3201

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "Promise.all([3200,3201].map(p => fetch('http://127.0.0.1:'+p+'/health'))).then(rs => { if (rs.some(r => !r.ok)) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
