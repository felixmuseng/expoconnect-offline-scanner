# Built on the builder's own architecture: the output is static files, identical
# for every target, so npm never runs under emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# slim drops the njs, geoip, perl and image-filter modules; the app is static files.
FROM nginx:alpine-slim
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
