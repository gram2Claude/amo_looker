# Nexus Looker converter — LibreOffice headless + Node.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Только нужные модули LibreOffice + шрифты с метриками Times/Arial/Calibri
# (liberation, carlito=Calibri, caladea=Cambria, dejavu) — иначе кириллица в КП «плывёт».
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu \
      nodejs npm ca-certificates \
      python3 python3-pip python3-uno \
    && rm -rf /var/lib/apt/lists/*

# unoserver — прогретый пул LibreOffice (CONVERT_MODE=warm, спека 04 этап 1.1).
# python3-uno (биндинги UNO из LibreOffice) обязателен — pip его не ставит.
RUN pip3 install --break-system-packages --no-cache-dir unoserver \
    && unoserver --version && unoconvert --version

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js app.js convert.js warm.js ./

# non-root (LibreOffice печально известен RCE через сложные документы)
RUN useradd -r -u 10001 -m -d /home/conv conv && chown -R conv:conv /app
USER conv
ENV HOME=/home/conv

EXPOSE 8094
CMD ["node", "server.js"]
