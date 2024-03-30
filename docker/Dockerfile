FROM --platform=linux/amd64 node:18-alpine3.15

WORKDIR /app

COPY --chown=node:node . /app

COPY --chown=node:node package.json .

COPY --chown=node:node package-lock.json .

RUN npm run install-modules

RUN npm run build-all

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]