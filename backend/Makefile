.PHONY: mongo run seed test fmt clean

mongo:            ## start the local MongoDB container
	docker start dhyaan-mongo 2>/dev/null || docker run -d --name dhyaan-mongo -p 27017:27017 mongo:7

run: mongo        ## run the API on 0.0.0.0:8000 (reachable from a phone on the LAN)
	.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

seed: mongo       ## wipe and reseed Eleanor with 14 days of history
	.venv/bin/python -m scripts.seed --wipe

test: mongo       ## run the whole suite
	.venv/bin/python -m pytest -q

ip:               ## the URL to put in the React Native app
	@echo "http://$$(ipconfig getifaddr en0):8000"

clean:
	docker rm -f dhyaan-mongo 2>/dev/null || true
