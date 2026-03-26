FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    poppler-data \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js
ENV NODE_VERSION=20.15.0
ENV NVM_VERSION=0.39.7
ENV NVM_DIR=/usr/local/nvm

RUN mkdir -p "$NVM_DIR" \
  && curl -fsSL "https://raw.githubusercontent.com/creationix/nvm/v${NVM_VERSION}/install.sh" | bash \
  && . "$NVM_DIR/nvm.sh" \
  && nvm install "$NODE_VERSION" \
  && nvm alias default "$NODE_VERSION" \
  && nvm use default \
  && node -v \
  && npm -v

# Make installed `node` and `npm` available for following layers and runtime.
ENV PATH=${NVM_DIR}/versions/node/v${NODE_VERSION}/bin:${PATH}

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN useradd -rm -d /home/node -s /bin/bash -u 1001 node

COPY --chown=node . /src
RUN mkdir -p /src/data /src/uploads && chown -R node:node /src/data /src/uploads

USER node
EXPOSE 8300
CMD ["node", "index.js"]
