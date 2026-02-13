# AI SDR Docker Image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
RUN apk add --no-cache chromium nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont

# Set Puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p leads web/data

# Expose dashboard port
EXPOSE 4010

# Start the dashboard server
CMD ["node", "web/server.js"]
