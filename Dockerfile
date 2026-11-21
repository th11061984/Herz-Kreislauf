FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN node scripts/check-fragen.js
EXPOSE 3000
CMD ["node", "server.js"]
