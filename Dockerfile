# A board site on SQLite: docker build -t artiboard . && docker run -p 4100:4100 -v artiboard:/data artiboard
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY skills/artiboard/assets/board.html ./skills/artiboard/assets/board.html
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4100 ARTIBOARD_DB=/data/board.db
VOLUME /data
EXPOSE 4100
CMD ["node", "server/cli.js", "serve"]
