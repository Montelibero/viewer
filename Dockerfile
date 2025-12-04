# Use the official Caddy image
FROM caddy:2-alpine

# Copy the Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Copy the website files
COPY site/ /srv/

# Expose the port Caddy listens on
EXPOSE 80

LABEL org.opencontainers.image.source="https://github.com/Montelibero/viewer"
