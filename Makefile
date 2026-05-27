VERSION := 0.1
REPOSITORY := localhost
IMAGE := md-poppler_fs
CONTAINER := $(IMAGE)
TAG := $(REPOSITORY)/messydesk/$(IMAGE):$(VERSION)

.PHONY: clean build start stop restart bash logs test

ifneq (,$(wildcard .env))
    include .env
    export
endif

ifeq ($(MD_PATH),)
    $(error MD_PATH is not set. Please set it in .env file or environment)
endif

clean:
	-@docker rm -f $(CONTAINER) 2>/dev/null || true
	-@docker image rm -f $(TAG) 2>/dev/null || true

build:
	docker build -t $(TAG) .

start:
	docker run -d --name $(CONTAINER) \
		-v $(MD_PATH)/data/:/app/data:Z \
		--user 0:0 \
		-e CONTAINER=true \
		-e MD_PATH=/app \
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
