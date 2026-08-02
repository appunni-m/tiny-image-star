# Thin contributor interface for the native npm scripts.
#
# Dialect: GNU Make 3.81 or newer. Make is orchestration only; npm owns the
# JavaScript dependency and verification graph. The default goal is read-only.

.DEFAULT_GOAL := help
SHELL := /bin/sh

NPM ?= npm
NODE ?= node
PYTHON ?= python3
HOST ?= 127.0.0.1
PORT ?= 8000
FOLDER ?=
WORKERS ?= 64
PAGES_DIR ?= _site
BROWSER_INSTALL_ARGS ?= chromium

.PHONY: all help install setup-browser test check verify verify-fast verify-browser verify-watch check-docs serve profile-folder package-pages check-pages

all: verify

help:
	@printf '%s\n' \
		'Tiny Image Star contributor commands (GNU Make 3.81+):' \
		'  make install          Install the locked npm dependencies.' \
		'  make setup-browser    Install Chromium for browser smoke tests.' \
		'  make verify           Run the complete read-only verification gate.' \
		'  make verify-fast      Run deterministic byte/state checks only.' \
		'  make verify-browser   Run the headless browser and responsive checks.' \
		'  make verify-watch     Rerun fast checks after source/test changes.' \
		'  make check-docs       Check local Markdown links.' \
		'  make serve             Serve the static app (PORT=8000, HOST=127.0.0.1).' \
		'  make profile-folder FOLDER=... [WORKERS=64]  Measure a local sample.' \
		'  make package-pages    Build and validate the local _site artifact.' \
		'  make check-pages      Validate an existing Pages directory.' \
		'' \
		'Network or filesystem side effects: install, setup-browser, serve, and package-pages.'

install:
	$(NPM) ci

setup-browser:
	$(NPM) exec -- playwright install $(BROWSER_INSTALL_ARGS)

test: verify-fast

check: verify

verify:
	$(NPM) run verify:all

verify-fast:
	$(NPM) run verify

verify-browser:
	$(NPM) run verify:browser

verify-watch:
	$(NPM) run verify:watch

check-docs:
	$(NPM) run check:docs

serve:
	$(PYTHON) -m http.server "$(PORT)" --bind "$(HOST)"

profile-folder:
	@test -n "$(FOLDER)" || { printf '%s\n' 'profile-folder requires FOLDER=/path/to/images' >&2; exit 2; }
	$(NPM) run profile:folder -- "$(FOLDER)" "$(WORKERS)"

package-pages:
	$(NODE) scripts/assemble-pages.mjs "$(PAGES_DIR)"
	$(MAKE) check-pages PAGES_DIR="$(PAGES_DIR)"

check-pages:
	$(NODE) scripts/check-pages-artifact.mjs "$(PAGES_DIR)"
