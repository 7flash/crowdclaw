FROM oven/bun:1 AS runtime
WORKDIR /srv/crowdclaw

COPY package.json ./
RUN bun install --production
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/crowdclaw.sqlite \
    WORKSPACE_ROOT=/data/workspaces \
    HOME=/data/home

RUN mkdir -p /data/home /data/workspaces
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD bun -e 'const r=await fetch("http://127.0.0.1:3000/api/health/ready"); process.exit(r.ok?0:1)'

CMD ["bun", "server.ts"]
