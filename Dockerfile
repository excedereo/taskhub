FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
# The commit this image was built from, shown in the profile footer (optional).
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/taskhub.db
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --include-workspace-root=false && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
# A named volume inherits this ownership, so the unprivileged user can write the database.
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
