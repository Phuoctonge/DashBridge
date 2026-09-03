FROM node:24-alpine

WORKDIR /app
COPY --chown=10001:10001 package.json server.js analytics-contract.js ./
COPY --chown=10001:10001 public ./public

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
USER 10001:10001
EXPOSE 8080
CMD ["node", "server.js"]
