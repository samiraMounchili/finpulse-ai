FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements-transcribe.txt ./

RUN python3 -m venv /opt/finpulse-venv \
    && /opt/finpulse-venv/bin/pip install --upgrade pip \
    && /opt/finpulse-venv/bin/pip install --no-cache-dir -r requirements-transcribe.txt

ENV PATH="/opt/finpulse-venv/bin:${PATH}"
ENV NODE_ENV=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]