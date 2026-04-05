FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npx tsc
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
