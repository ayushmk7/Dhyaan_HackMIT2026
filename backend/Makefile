.PHONY: mongo embedder run seed test fmt clean vision vision-demo vision-synthetic vlm

mongo:            ## start the local MongoDB container
	docker start dhyaan-mongo 2>/dev/null || docker run -d --name dhyaan-mongo -p 27017:27017 mongo:7

embedder:         ## local semantic embeddings (nomic-embed-text, 768d, offline once pulled)
	@pgrep -qf "ollama serve" || (ollama serve > /tmp/ollama.log 2>&1 &)
	@sleep 2 && ollama pull nomic-embed-text

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

# --- camera lane (VLM_PLAN §3) ------------------------------------------------
# Needs the extra once:  uv pip install -e ".[vision]"
# Model name lives in backend/vision/__init__.py (VLM_MODEL, env-overridable) —
# keep this in sync with that, not the other way around.

vlm:              ## pull + warm the vision model (3.2 GB, keeps itself resident)
	@pgrep -qf "ollama serve" || (ollama serve > /tmp/ollama.log 2>&1 &)
	@sleep 2 && ollama pull qwen2.5vl:3b
	@curl -s http://localhost:11434/api/chat -d '{"model":"qwen2.5vl:3b","messages":[{"role":"user","content":"hi"}],"stream":false,"keep_alive":-1,"think":false}' > /dev/null && echo "qwen2.5vl:3b warm"

vision:           ## run the camera worker against the local API
	.venv/bin/python -m vision --source 0 --camera-id cam_mac_01

vision-demo:      ## the on-stage configuration: fast rules, preview window, `p` pauses 2h
	.venv/bin/python -m vision --source 0 --demo --preview --camera-id cam_mac_01

vision-synthetic: ## no webcam needed — synthetic frames, on-stage rules
	.venv/bin/python -m vision --source synthetic --camera-id cam_mac_01 --demo
