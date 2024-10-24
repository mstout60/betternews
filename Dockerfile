
# syntax=docker/dockerfile:1.7-labs
ARG BUN_VERSION=1.1.3
FROM oven/bun:${BUN_VERSION}-slim as base

#RUN apt-get update; apt-get install -y ca-certificates jq

COPY <<"EOF" /srv/deploy.sh
#!/bin/bash
deploy=(flyctl deploy)
touch /srv/.secrets

while read -r secret; do
  echo "export ${secret}=${!secret}" >> /srv/.secrets
  deploy+=(--build-secret "${secret}=${!secret}")
done < <(flyctl secrets list --json | jq -r ".[].Name")

deploy+=(--build-secret "ALL_SECRETS=$(base64 --wrap=0 /srv/.secrets)")
${deploy[@]}
EOF

RUN chmod +x /srv/deploy.sh

#COPY --from=flyio /flyctl /usr/bin

LABEL fly_launch_runtime="Bun"

WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/prod/server
COPY package.json bun.lockb /temp/prod/server/
RUN cd /temp/prod/server && bun install --frozen-lockfile --production

RUN mkdir -p /temp/prod/frontend
COPY frontend/bun.lockb frontend/package.json /temp/prod/frontend/
RUN cd /temp/prod/frontend && bun install --frozen-lockfile

FROM base as build
COPY . .
COPY --from=install /temp/prod/server/node_modules node_modules
COPY --from=install /temp/prod/frontend/node_modules frontend/node_modules
ENV NODE_ENV=production
RUN cd frontend && bun run build -d

FROM base as release
COPY --from=install /temp/prod/server/node_modules node_modules
#COPY --exclude=frontend --from=build /usr/src/app .
COPY --from=build /usr/src/app/frontend/dist ./frontend/dist

USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "start" ]
