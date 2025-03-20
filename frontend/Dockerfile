FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Ajout de ces lignes pour corriger les permissions
RUN mkdir -p node_modules/.cache && chmod -R 777 node_modules/.cache
EXPOSE 3000
CMD ["npm", "start"]