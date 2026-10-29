.PHONY: install dev build start check test docker docker-run
install:
	bun install
dev: build
	bun run dev
build:
	bun run build
start: build
	bun run start
check:
	bun run check
test:
	bun test
docker:
	docker build -t gang-poker .
docker-run:
	docker run --rm -p 3000:3000 -e MAX_PLAYERS=6 gang-poker
