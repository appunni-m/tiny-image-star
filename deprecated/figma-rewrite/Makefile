.DEFAULT_GOAL := help
NPM ?= npm
PYTHON ?= python3
PORT ?= 8000

.PHONY: help install verify verify-browser build serve
help:
	@printf '%s\n' 'Tiny Image Star Design commands:' '  make install         Install locked dependencies.' '  make verify          Run fast foundation checks.' '  make verify-browser  Exercise local images, WASM edits, and bulk recipes.' '  make build           Stage WASM and assemble Pages.' '  make serve           Serve the app at http://127.0.0.1:$(PORT)/.'

install:
	$(NPM) ci

verify:
	$(NPM) run verify

verify-browser:
	$(NPM) run verify:browser

build:
	$(NPM) run build

serve:
	$(PYTHON) -m http.server "$(PORT)" --bind 127.0.0.1
