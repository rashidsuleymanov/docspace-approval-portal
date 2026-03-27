FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/

RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3005

EXPOSE 3005

CMD ["npm", "run", "start"]
