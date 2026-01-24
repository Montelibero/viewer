IMAGE_NAME := "stellar_viewer"

# Default target
default:
    @just --list

# Docker targets
build tag="latest":
    # Build Docker image
    docker build -t {{IMAGE_NAME}}:{{tag}} .

run: test
    # Build and Run Docker container
    docker build -t stellar_viewer:local .
    echo "http://127.0.0.1:8081"
    docker run --rm -p 8081:80 {{IMAGE_NAME}}:local


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
    docker-compose exec {{IMAGE_NAME}} sh

# Cleanup targets


clean-docker:
    # Clean up Docker images and containers
    docker system prune -f
    docker volume prune -f


push-gitdocker tag="latest":
    docker build -t {{IMAGE_NAME}}:{{tag}} .
    docker tag {{IMAGE_NAME}} ghcr.io/montelibero/{{IMAGE_NAME}}:{{tag}}
    docker push ghcr.io/montelibero/{{IMAGE_NAME}}:{{tag}}

test:
    node scripts/validate-json.js
    node scripts/check-imports.js