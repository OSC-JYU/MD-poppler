FROM node:24-bookworm-slim

# Install poppler-utils for PDF handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    poppler-data \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js service.json ./
COPY help ./help
RUN mkdir -p /app/uploads /app/data && chown -R node:node /app/uploads /app/data

USER node
EXPOSE 8300
CMD ["node", "index.js"]
