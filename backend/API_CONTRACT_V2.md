# Endpoints being added (contract frozen — build to this, do not renegotiate)

All on `Authorization: Bearer <API_KEY>`, prefix `/v1`. Ids come back as `id`,
never `_id`. Timestamps are ISO-8601 strings.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/residents/{id}/baselines` | — | `[{feature, mu, mad, lam, n_obs, cold_start, last_value, updated_at, unit, direction}]` |
| GET | `/residents/{id}/summaries?days=7` | — | `[{date, narrative, deviations: [{feature, severity, text}]}]` |
| GET | `/residents/{id}/location/history?date=YYYY-MM-DD` | — | `[{zone, from, to, seconds, method, confidence}]` |
| GET | `/events/{event_id}` | — | the event, or 404 |
| POST | `/admin/simulate` | `{resident_id, kind: "fall"\|"bathroom"\|"walk"}` | `{event_id, alert_id?}` |
| POST | `/bands/pair` | `{band_id, resident_id}` | `{ok, band: {...}}` |
| POST | `/residents/{id}/survey/start` | `{zone}` | `{survey_id, zone}` |
| POST | `/residents/{id}/survey/sample` | `{survey_id, beacons: [{uuid, major, minor, rssi}], wifi: [{bssid, rssi}]}` | `{survey_id, samples}` |
| POST | `/residents/{id}/survey/stop` | `{survey_id}` | `{zone, samples, stored: bool}` |
| PUT | `/residents/{id}/contacts` | `[{name, phone_e164, relationship, ladder_order}]` | `{ok, contacts: [...]}` |
| POST | `/push/register` | `{token, resident_id?, role: "family"\|"staff"}` | `{ok}` |

Notes that matter:

- **`/admin/simulate` is the demo trigger.** It must produce a *real* event through
  the real ingest path so the FSM, the websocket and the app all behave exactly as
  they would for a band. Mark the payload `simulated: true`.
- **The survey endpoints feed `app/location.py`'s fingerprint store.** `stop` writes
  the collected RSSI vectors into the `fingerprints` collection for that zone. That
  is what makes room classification work in a new building.
- **`PUT /contacts` replaces the whole ladder** and must renumber `ladder_order`
  densely from 1. A gap in the ladder silently skips a person during an escalation.
- `/push/register` just stores the token on the contact. Sending a push is Expo's
  job and is not this endpoint's business.
