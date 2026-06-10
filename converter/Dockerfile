# Nexus Looker converter — LibreOffice headless + Node.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Только нужные модули LibreOffice + шрифты с метриками Times/Arial/Calibri
# (liberation, carlito=Calibri, caladea=Cambria, dejavu) — иначе кириллица в КП «плывёт».
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu \
      nodejs npm ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

# non-root (LibreOffice печально известен RCE через сложные документы)
RUN useradd -r -u 10001 -m -d /home/conv conv && chown -R conv:conv /app
USER conv
ENV HOME=/home/conv

EXPOSE 8094
CMD ["node", "server.js"]
