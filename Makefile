SHELL := /bin/sh
.DEFAULT_GOAL := help

# Variables
COMPOSE ?= docker compose
PROFILE ?= dev

.PHONY: help install build dev start test test-watch lint format clean \
	docker-build docker-up docker-down docker-logs docker-restart \
	dev-up dev-down dev-logs docs-check

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z0-9_-]+:.*?##/ {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST) | sort

install: ## Install dependencies
	npm install

build: ## Compile TypeScript to dist/
	npm run build

dev: ## Run locally with ts-node
	npm run dev

start: ## Run compiled app
	npm start

test: ## Run tests once with coverage
	npm test

test-watch: ## Run tests in watch mode
	npm run test:watch

lint: ## Lint source files
	npm run lint

format: ## Format source files
	npm run format

clean: ## Clean build artifacts
	npm run clean

docker-build: ## Build production image via compose
	$(COMPOSE) build bot

docker-up: ## Start production stack
	$(COMPOSE) up -d

docker-down: ## Stop and remove containers
	$(COMPOSE) down

docker-logs: ## Tail production logs
	$(COMPOSE) logs -f bot

docker-restart: ## Restart production bot
	$(COMPOSE) restart bot

dev-up: ## Start dev stack with hot reload
	$(COMPOSE) --profile $(PROFILE) up -d redis
	$(COMPOSE) --profile $(PROFILE) up bot-dev

dev-down: ## Stop dev stack
	$(COMPOSE) --profile $(PROFILE) down || true

dev-logs: ## Tail dev logs
	$(COMPOSE) --profile $(PROFILE) logs -f bot-dev

docs-check: ## Check README links and mermaid blocks
	@set -e; \
	grep -q "README.en.md" README.md; \
	grep -q "```mermaid" README.md; \
	grep -q "```mermaid" README.en.md; \
	echo "Docs check passed ✅"
