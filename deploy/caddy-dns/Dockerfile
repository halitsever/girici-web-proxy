# Caddy with one DNS provider module, for the wildcard certificate of subdomain mode.
# ACME issues wildcards only through the DNS-01 challenge, which the stock image cannot answer.
FROM caddy:2-builder AS builder
ARG CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare
RUN xcaddy build --with ${CADDY_DNS_MODULE}

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
