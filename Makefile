VERSION := 0.1
REPOSITORY := messydesk
IMAGE := md-poppler
CONTAINER := $(IMAGE)
TAG := $(REPOSITORY)/$(IMAGE):$(VERSION)

.PHONY: clean build start stop restart bash logs test

clean:
	-@docker rm -f $(CONTAINER) 2>/dev/null || true
	-@docker image rm -f $(TAG) 2>/dev/null || true

build:
	docker build -t $(TAG) .

start:
	docker run -d --name $(CONTAINER) \
		-v md-poppler-data:/src/data \
		-v md-poppler-uploads:/src/uploads \
		-p 8300:8300 \
		--restart unless-stopped \
		$(TAG)

stop:
	-@docker stop $(CONTAINER) 2>/dev/null || true
	-@docker rm $(CONTAINER) 2>/dev/null || true

restart:
	$(MAKE) stop
	$(MAKE) start

bash:
	docker exec -it $(CONTAINER) bash

logs:
	docker logs -f $(CONTAINER)

test:
	npm test
