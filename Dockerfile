FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

# Compile TypeScript server to JavaScript
RUN npx tsc --project server/tsconfig.json

# Expose health-check port
EXPOSE 4000

CMD ["node", "server/trading-server.js"]
