IMAGE_NAME := "stellar_viewer"

# Default target
default:
    @just --list

# Docker targets
build tag="latest":
    # Build Docker image
    docker build -t {{IMAGE_NAME}}:{{tag}} .

run:
    # Run Docker container
    docker-compose up -d

stop:
    # Stop Docker container
    docker-compose down

rebuild:
    # Rebuild and restart the docker container
    docker-compose build --no-cache && docker-compose up -d --force-recreate

logs:
    # View container logs
    docker-compose logs -f

shell:
    # Open a shell into the running container
    docker-compose exec viewer-caddy sh

# Cleanup targets


clean-docker:
    # Clean up Docker images and containers
    docker system prune -f
    docker volume prune -f


push-gitdocker tag="latest":
    docker build -t {{IMAGE_NAME}}:{{tag}} .
    docker tag {{IMAGE_NAME}} ghcr.io/montelibero/{{IMAGE_NAME}}:{{tag}}
    docker push ghcr.io/montelibero/{{IMAGE_NAME}}:{{tag}}