# Band firmware + agent tests (no UNO Q required for these targets).

PYTHON ?= python3
CXX ?= g++
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
REPO := $(abspath $(ROOT)/..)

.PHONY: test test-detector test-py

test: test-detector test-py

test-detector:
	$(CXX) -std=c++17 -O2 -Wall -Wextra -I$(ROOT)/fallband/sketch \
		-o $(ROOT)/tests/detector_test $(ROOT)/tests/detector_test.cpp
	$(ROOT)/tests/detector_test

test-py:
	$(PYTHON) $(ROOT)/tests/test_payloads.py
	$(PYTHON) $(ROOT)/tests/test_har.py
