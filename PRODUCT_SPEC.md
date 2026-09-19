# Porchlight — Product & System Spec
### HackMIT 2026 · one platform, two products · elder-care sensing

> **Scope of this document.** This is the *product, go-to-market and judging* layer.
> The wearable (Arduino UNO Q + Modulino IMU, band mechanics, power, firmware) is specified in **`HARDWARE_SPEC.md`**.
> The implementation (Deepgram Voice Agent, Twilio telephony, local VLM on CCTV, RAG over the event store, React Native app) is specified in **`TECHNICAL_PRD.md`**.
> "Porchlight" is a working name. B2C product = **Porchlight Home**. B2B product = **Porchlight Care**.

---

## 1. Product thesis

An arm-worn band detects a fall in the first three seconds; thirty seconds later, before anybody's family is woken and before anybody dials 911, the phone in the next room rings and a voice agent asks the person on the floor a simple question — *"Margaret, your band felt a hard fall. Are you hurt?"* — and then actually listens to the answer. Everything downstream is decided by that answer: "I just sat down hard" closes the incident and writes one line to a timeline; silence, slurred speech, or "I can't get up" escalates to the adult child by phone in under twenty seconds and hands them a transcript instead of a siren. The same band's Wi-Fi and BLE radios, read against a handful of cheap beacons in the kitchen, bathroom, bedroom and front door, place the person **room by room** — which is what turns a fall alarm into a health instrument: how many bathroom trips last night, did she leave the house today, how many rooms does she move between compared with her own thirty-day median, and at a facility, did somebody just go through the west door at 03:40. The same band, the same event store and the same escalation ladder run at facility scale, where existing hallway CCTV is read by a **local** vision-language model and fused with the beacon trace to log activities of daily living — ate, walked, slept, bathroom trips, night wandering — against a baseline learned per resident, so a night nurse covering 32 people gets a ranked list of three rooms to check instead of 32 rooms and a hunch. The family app is deliberately not a surveillance console and never a live dot on a floor plan: it is a status line, a timeline, and a chat that answers *"how was Mum's week?"* from the event history. **The product shows deviations, not surveillance** — that single sentence is both the design constraint and the pitch.

**The one sentence for a judge:**
> Every fall-detection product on the market decides *for* the person on the floor — Porchlight is the one that asks them first, in a real phone conversation, and it earns the right to ask by only ever showing the family what changed, not where she is.

---

## 2. The pain, quantified

| Claim | Number | Source |
|---|---|---|
| Older adults who fall each year (US) | **1 in 4 (27.6%) ≈ 14 million people**; 35.6M falls and 8.4M fall injuries in a year | [CDC MMWR 2023](https://www.cdc.gov/mmwr/volumes/72/wr/mm7235a1.htm) · [ACL Profile of Older Americans 2023](https://acl.gov/sites/default/files/Profile%20of%20OA/ACL_ProfileOlderAmericans2023_508.pdf) |
| ED visits for older-adult falls | **~4.5 million/yr** — 3.1M treated & released, **1.4M hospitalised** | [CDC Facts About Falls](https://www.cdc.gov/falls/data-research/facts-stats/index.html) |
| Deaths | **Over 43,000** fall deaths in 2024 — the leading cause of injury death in 65+; ~100 older adults die from a fall every day | [CDC About Older Adult Falls](https://www.cdc.gov/falls/about/index.html) · [MMWR 2023](https://www.cdc.gov/mmwr/volumes/72/wr/mm7235a1.htm) |
| Cost | **~$80 billion/yr** in medical costs, **Medicare bearing about two-thirds**. (Earlier peer-reviewed figure: $50.0B, of which $28.9B Medicare) | [CDC At-a-Glance](https://www.cdc.gov/falls/pdf/CDC-DIP_At-a-Glance_Falls_508.pdf) · [Florence et al., *JAGS* 2018](https://pubmed.ncbi.nlm.nih.gov/29512120/) |
| Hip fractures | **~319,000** older adults hospitalised/yr; 83% of hip-fracture deaths caused by falls | [CDC](https://www.cdc.gov/falls/data-research/facts-stats/index.html) |
| Trend | Age-adjusted fall death rate **up 21%**, 64.7 → **78.4 per 100,000** (2018 → 2024); on trend, **59,000 deaths/yr by 2030** | [CDC](https://www.cdc.gov/falls/data-research/index.html) · [MMWR 2018](https://www.cdc.gov/mmwr/volumes/67/wr/mm6718a1.htm) |
| Falls happen alone | **82%** (217/265) of recorded falls in a 90+ cohort occurred when the person was alone | [Fleming & Brayne, BMJ 2008](https://pubmed.ncbi.nlm.nih.gov/19015185/) |
| Can't get up | **80%** (53/66) of fallers aged 90+ were unable to get up after at least one fall; **47%** of non-injured fallers 72+ in the New Haven cohort | [Fleming & Brayne 2008](https://pubmed.ncbi.nlm.nih.gov/19015185/) · [Tinetti, JAMA 1993](https://pubmed.ncbi.nlm.nih.gov/8416408/) |
| **The long lie** | **30%** (20/66) lay on the floor **an hour or more**. Of those who lay >1h in the classic cohort, **half died within six months**; a quarter of all fallers died within a year — 5× the matched controls | [Fleming & Brayne 2008](https://pubmed.ncbi.nlm.nih.gov/19015185/) · [Wild, Nayak & Isaacs, BMJ 1981](https://pubmed.ncbi.nlm.nih.gov/6779979/) |
| Living alone | **28% of community-dwelling US adults 65+ = 16.2 million people**; 33% of older women; **42% of women 75+**. Internationally: 27% of US 60+ vs a **16%** average across 130 countries | [ACL 2023](https://acl.gov/sites/default/files/Profile%20of%20OA/ACL_ProfileOlderAmericans2023_508.pdf) · [Pew, 2020](https://www.pewresearch.org/short-reads/2020/03/10/older-people-are-more-likely-to-live-alone-in-the-u-s-than-elsewhere-in-the-world/) |
| Market growth | US 65+ population **57.8M (2022) → 78.3M (2040)**; the 85+ cohort **doubles**, 6.5M → 13.7M | [ACL 2023](https://acl.gov/sites/default/files/Profile%20of%20OA/ACL_ProfileOlderAmericans2023_508.pdf) |
| Assisted living market | **41,465** communities, **~1.4M** licensed beds, **>1M** residents, **4 in 10** living with Alzheimer's or other dementia; average community = 33 beds | [AHCA/NCAL Facts & Figures](https://www.ahcancal.org/Assisted-Living/Facts-and-Figures/Pages/default.aspx) |
| What a bed costs the family | Median assisted living **$6,200/month**; nursing home semi-private **$9,581/month** | [CareScout Cost of Care 2025](https://www.carescout.com/cost-of-care) |
| Staffing churn | Nursing-staff turnover: **mean 128% / median 94%** per year across 15,645 facilities (2021 study). *Be careful with this number:* CMS changed its calculation in July 2023 and current Care Compare data puts mean total nursing turnover nearer **46%** — still one of the worst rates in the US economy | [Gandhi, Yu & Grabowski, *Health Affairs* 2021](https://pubmed.ncbi.nlm.nih.gov/33646872/) · [CMS Care Compare dataset](https://data.cms.gov/provider-data/dataset/4pq5-n9py) |
| **Overnight coverage is thinner than families imagine** | **32 states** use flexible "sufficient staff" standards with no ratio at all; only 19 specify ratios. Several states do not require *awake* overnight staff below a bed threshold. For dementia units, **17 states require merely "at least one awake staff person."** | [ASPE Compendium of Residential Care & Assisted Living Regulations, 2015](https://aspe.hhs.gov/sites/default/files/migrated_legacy_files//73501/15alcom.pdf) pp. 30–31, 37 |
| Workforce pipeline | **8.9 million** direct-care job openings 2022–2032; median annual earnings **$25,015** | [PHI, 2024](https://www.phinational.org/resource/direct-care-workers-in-the-united-states-key-facts-2024/) |
| Wandering | *"Six in 10 people living with dementia will wander at least once; many do so repeatedly."* Most are found within 1.5 miles; the Association tells caregivers to call 911 if the person is not located within **15 minutes** | [Alzheimer's Association](https://www.alz.org/help-support/caregiving/stages-behaviors/wandering) |
| Who this exposes | **4 in 10** assisted-living residents live with Alzheimer's or another dementia — i.e. roughly **400,000+ US residents** in the wandering-risk population, inside buildings with exterior doors | [AHCA/NCAL](https://www.ahcancal.org/Assisted-Living/Facts-and-Figures/Pages/default.aspx) × [Alz. Assoc.](https://www.alz.org/help-support/caregiving/stages-behaviors/wandering) |

### 2.1 The part nobody builds for: the alarm is not the problem, the *answer* is

Two failure modes kill this category, and both are about false positives, not missed falls.

**Seniors do not press the button — and this is not a soft claim, it is measured.**

| Finding | Number | Source |
|---|---|---|
| Falls where the person **could not get up**, in a home **that had an alarm**, where the alarm was **not activated** | **80% (113/141)** | [Fleming & Brayne, BMJ 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC2590903/) |
| **Long-lie episodes** in alarm-equipped homes where the alarm was **not used** | **97% (37/38)** | [same](https://pmc.ncbi.nlm.nih.gov/articles/PMC2590903/) |
| PERS subscribers who **never wear** the button | **24%** | [Heinbüchner et al., *Z Gerontol Geriatr* 2010](https://pubmed.ncbi.nlm.nih.gov/20814795/) |
| PERS subscribers who wear it **24 h/day** | **14%** | [same](https://pubmed.ncbi.nlm.nih.gov/20814795/) |
| Subscribers who fell alone and lay >5 min who **did not activate** the PERS | **83%** | [same](https://pubmed.ncbi.nlm.nih.gov/20814795/) |

The participants' own recorded reasons: **perceptions of irrelevance, concerns about independence, and practical difficulties**. The pendant was on the table. It stayed on the table. **A PERS pendant is, empirically, a device that is not used at the exact moment it is needed, in 8 to 9.7 cases out of 10.**

**Caregivers stop responding to the alarm.** In a 31-day ICU study of 461 patients, **88.8%** of annotated arrhythmia alarms were false positives, at **187 audible alarms per bed per day** ([Drew et al., *PLoS One* 2014](https://pubmed.ncbi.nlm.nih.gov/25338067/)); a nursing review puts the figure at *"up to 99% of alarms sounding on hospital units are false"* ([Tanner 2013](https://pubmed.ncbi.nlm.nih.gov/23594329/)). And the definitive answer on whether more alarms produce fewer falls is **no**: a cluster-randomised trial across 16 units and 27,672 inpatients raised bed-alarm use from 1.79 to **64.41 alarm-days per 1,000 patient-days and found no significant effect on falls** (RR 1.09, 95% CI 0.85–1.53) ([Shorr et al., *Ann Intern Med* 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3549269/)); Cochrane concurs that pressure-sensor alarms have *"little to no effect"* ([Abraham et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9404383/)).

**So the product problem is not "detect more falls." It is: reduce the cost of being wrong, on both ends.** A false positive that costs a 20-second phone call and a logged "I'm fine" is survivable a dozen times a week. A false positive that costs an ambulance, a hospital co-pay, and an embarrassed 79-year-old explaining herself to a paramedic gets the band thrown in a drawer. A false positive that costs Alicia a walk down the west wing at 2 a.m. is why she stops walking down the west wing. **The conversation is the false-positive filter on the B2C side; the per-resident baseline is the false-positive filter on the B2B side.** That is the entire wedge, and the literature above is the reason it is a real one and not a feature.

---

## 3. Personas

### 3.1 Margaret Doyle, 79 — *the person the product is actually for*
Widowed four years, lives alone in a 1950s ranch house in Dayton, Ohio. Drives to the 10 a.m. service and to Kroger. Two friends in the phone tree. Her daughter bought her a pendant in 2023; it lives in the dish by the door because *"it makes me look like I'm already gone,"* and because the one time she pressed it by accident a stranger's voice came out of a box in the hall and asked if she needed an ambulance.

**Her day.** Up at 6:40. Coffee, crossword, local news. Around 2 p.m. she reaches for the top shelf in the pantry, the step stool shifts, and she goes down hard on her right hip onto linoleum. Nothing is broken. She is winded and furious and cannot get up for about four minutes. Her phone is charging in the bedroom. **Under the status quo she lies there until she can lever herself up on a chair, and nobody ever hears about it.** Her son finds out three weeks later because she mentions the bruise.

**What she will tolerate:** a band she'd wear anyway because it also tells the time and tracks her walking. A phone call from a calm voice that asks before it acts. **What makes her take it off:** a camera in her house, a stranger in her hall speaker, anything her son can watch in real time, anything that tells her she's declining.

**Her hardest objection, in her own words — and this one is about location, not falls:**
> *"So it knows what room I'm in. All day. It knows when I'm in the bathroom, and how long, and Danny can see that on his phone in Denver. I raised that boy. I'm not going to have him checking up on my bathroom."*

**The answer we give her, and it has to be literally true or the whole thing collapses:**
> *"He can't see where you are. He can't see a map of your house, he can't see a dot, and he can't see 'Mum is in the bathroom.' There is no screen in his app that shows that, and there is no way for him to turn one on. What the band counts is how many times you got up in the night — and even that, he only ever sees if it's very different from your own normal, and only the next morning, never live. If you'd rather it didn't count the bathroom at all, there's a switch for that and you can flip it yourself, today, and the fall detection keeps working exactly the same."*

Margaret is the veto. If she says no, the product does not ship into that house. Every design decision in §8 exists to make that paragraph true.

### 3.2 Dan Doyle, 51 — *the person who pays*
Margaret's son. Denver, three states away. Product manager, two teenagers, calls Sunday at 7 p.m. and gets "everything's fine, honey." He has no signal between those calls. He has a slow, permanent, low-grade dread that his phone will ring at 4 a.m.

**His day.** Standup, a design review, a 1:1. At 12:40 he eats a sandwich at his desk and opens the app, because that is the exact moment his guilt surfaces. He does not want a dashboard. He wants to type *"has Mum been out this week?"* and get three lines back, one of which mentions a hard-fall check on Wednesday that she answered herself. Then he closes the app. **Total session: 25 seconds. That is the product.**

**What converts him:** the Wednesday line. He didn't know. He now knows, and she wasn't made to feel supervised. **What churns him:** a stream of notifications that require nothing of him. Guilt-as-a-service is not retention, it's an unsubscribe.

### 3.3 Alicia Nunes, 32 — *the night nurse*
LPN, 11 p.m.–7 a.m., 64-bed memory care community. She is responsible for 32 residents across the east wing. **One hallway camera per wing. No cameras in rooms.** She does rounds at midnight, 2, 4 and 6. Between rounds she is in the med room, charting.

**Her night.** 11:40 — Mr. Kaminski's bed alarm; he rolled over. 12:00 — rounds, everyone in bed. 1:20 — same alarm, same reason; she now weights it at roughly zero. 2:00 — rounds. **2:50 — Mrs. Okoye, room 214, walks the hallway for the third time tonight. Alicia is charting and doesn't see it. Mrs. Okoye has a UTI coming on, which is exactly how it presents.** 3:30 — a real fall in 207, found at the 4 a.m. round, ~25 minutes late.

**What she needs at 2:50:** not video, not a dashboard she has to stare at. One line on her phone: *"214 Okoye — 3rd hallway trip tonight; her 30-night median is 0.6. Check."* **What she will ignore forever:** anything that fires more than about twice a shift, and anything that asks her to review footage.

### 3.4 Ray Ostrowski, 58 — *the facility director, the buyer*
Executive Director, 96 beds (64 AL + 32 memory care). Three pressures, in order: (1) **state survey** — an unwitnessed fall with an incomplete incident record is a deficiency tag, and tags are public; (2) **liability insurance** — his carrier re-quoted this year and asked, in writing, what fall-mitigation technology he had; (3) **labour** — agency nurses at 1.8× base rate covering a vacancy rate he inherited, against an industry where nursing-staff turnover runs [94% median, 128% mean](https://pubmed.ncbi.nlm.nih.gov/33646872/).

**His day.** Morning stand-up on last night's incidents, and the recurring question *"how long was she down before we found her?"* — to which the honest answer is usually *"we don't know."* An 11 a.m. family tour where the daughter asks about falls and he has nothing concrete to say. A 2 p.m. corporate call about census. At 4, a resident's son on the phone, angry, asking why nobody noticed his father hadn't eaten since Tuesday.

**What he buys:** a defensible number. Time-to-discovery per incident, an exportable record, and a line he can say on a tour. He does **not** buy "AI." He buys "we can tell you, to the minute, when it happened and when someone got there." **What kills the deal:** cameras in resident rooms, any suggestion that video leaves the building, and a per-bed price that his regional VP has to escalate.

---

## 4. The two products

### 4.1 Porchlight Home (B2C)

| # | Feature | Who it serves | Priority | In the 24h demo? |
|---|---|---|---|---|
| 1 | Band-side fall detection (IMU impact + post-impact stillness), on-device | Margaret | **P0** | **Yes** |
| 2 | 30-second on-band cancel (buzz + button) before anything leaves the house | Margaret | **P0** | **Yes** |
| 3 | Outbound voice call to the resident via Twilio + Deepgram Voice Agent | Margaret | **P0** | **Yes** |
| 4 | Intent classification of the answer → `resolved` / `uncertain` / `escalate` | Margaret, Dan | **P0** | **Yes** |
| 5 | Escalation call + SMS to the family contact, with transcript | Dan | **P0** | **Yes** |
| 6 | Event timeline in the React Native app | Dan | **P0** | **Yes** |
| 7 | RAG chat over the event history ("how was Mum's week?") | Dan | **P0** | **Yes** |
| 8 | **Room-level indoor location** from band Wi-Fi/BLE + 4–6 BLE beacons. *The only location source in B2C — there are no cameras in a private home.* | Margaret, Dan | **P0** | **Yes** |
| 9 | `left_home` / `returned_home` from the front-door beacon → "did she get out today" | Dan | **P0** | **Yes** |
| 10 | Night bathroom-visit count vs her own 30-night median | Dan, clinicians | **P0** | **Yes** |
| 11 | Room-transition count per day as a coarse mobility/decline signal | Dan | **P0** | **Yes (seeded history)** |
| 12 | **Location aggregation firewall:** family sees counts and deviations only — never a live position, never a floor plan | Margaret | **P0** | **Yes (show the app has no map)** |
| 13 | Resident-visible controls: mute window, **"don't track the bathroom"**, "don't call my son for this", off switch | Margaret | **P0** | **Yes (screen only)** |
| 14 | Separate, explicit consent step for location, distinct from fall detection | Margaret, Legal | **P0** | **Yes** |
| 15 | Recording disclosure in the first sentence of every call | Legal | **P0** | **Yes** |
| 16 | Physical privacy switch: location off, fall detection stays on | Margaret | P1 | No (spec'd) |
| 17 | Band wear-time tracking & low-wear nudge | Dan, us | P1 | No |
| 18 | Escalation ladder ≥2 contacts, then 911 with a spoken location message | Dan | P1 | No (scripted) |
| 19 | Time-in-room per day, aggregated (e.g. "8h in the armchair, up from 5h") | Dan | P1 | Partial (seeded) |
| 20 | Weekly digest ("Mum's week in five lines") push | Dan | P1 | No |
| 21 | Fall location ("she fell in the bathroom") attached to the escalation call | Dan, 911 | P1 | No |
| 22 | Medication reminder as an inbound voice call | Margaret | P2 | No |
| 23 | Two-way "call me back" button on the band | Margaret | P2 | No |
| 24 | Cellular band (no phone/Wi-Fi dependency) | Margaret | P2 | No |

### 4.2 Porchlight Care (B2B — assisted living / memory care)

| # | Feature | Who it serves | Priority | In the 24h demo? |
|---|---|---|---|---|
| 1 | Multi-resident band fleet, one event store | Alicia, Ray | **P0** | **Yes (3 simulated)** |
| 2 | **Local VLM over existing hallway CCTV** → ADL events (ate / walked / slept / bathroom / wandering) | Alicia | **P0** | **Yes (1 camera, recorded clip)** |
| 3 | Video never leaves the building; only event rows sync | Ray, Legal | **P0** | **Yes (show the architecture)** |
| 4 | **Room-level indoor location** from band + beacons in rooms, hallways and at every exterior door | Alicia, Ray | **P0** | **Yes** |
| 5 | **Wandering / elopement alert**: exit-door beacon + no staff escort + resident on the memory-care roster → immediate page | Alicia, Ray | **P0** | **Yes** |
| 6 | Night-wandering pattern (hallway transits vs the resident's own median) | Alicia | **P0** | **Yes** |
| 7 | Per-resident learned baseline; alert on deviation, not on absolute thresholds | Alicia | **P0** | **Yes** |
| 8 | Night-shift ranked check-list (3 rooms, not 32) | Alicia | **P0** | **Yes** |
| 9 | Time-to-discovery stamped on every incident | Ray | **P0** | **Yes** |
| 10 | Location + camera fusion: hall camera confirms/denies a beacon-inferred exit, cutting false wander alerts | Alicia | P1 | Partial |
| 11 | Staff dashboard: floor view, per-resident card, incident detail | Alicia, Ray | P1 | Partial |
| 12 | Audit-ready incident export (PDF/CSV, timestamped, immutable) incl. location trace | Ray | P1 | **Yes (one PDF)** |
| 13 | Consent register: per-resident status (fall / location / camera as three separate grants), who signed, when, revocable | Ray, Legal | P1 | Partial |
| 14 | Voice agent for ambulatory residents in AL (memory care escalates straight to staff) | Alicia | P1 | No |
| 15 | Shift-handover summary generated from the night's events | Alicia | P1 | No |
| 16 | Staff-side location is **live and unredacted** (unlike the family app) — clinical necessity, logged access | Alicia, Ray | P1 | Partial |
| 17 | Family portal (facility-branded), read-only, redacted to the same aggregate level as B2C | Ray | P2 | No |
| 18 | Insurance/actuarial report pack (elopement + fall time-to-discovery) | Ray | P2 | No |
| 19 | Integration with PointClickCare / Yardi eMAR | Ray | P2 | No |

> **Design rule that spans both:** in memory care, the voice agent does **not** call the resident. Asking a person with moderate dementia "are you hurt?" over the phone is at best useless and at worst frightening. Memory care escalates directly to staff. The conversational branch is for cognitively intact adults — B2C, and assisted-living residents only.

---

## 5. End-to-end journeys

### 5.1 The fall journey — second by second

**Branch A — resolved by the voice agent (the common case, ~70–85% of triggers).**

| Time | What happens | Where |
|---|---|---|
| **T+0.0s** | Margaret's right hip hits linoleum. IMU sees a >3g impact transient followed by an orientation change. | Band (STM32 real-time core) |
| **T+0.4s** | Impact + post-impact stillness classifier passes threshold. Candidate fall. | Band |
| **T+3.0s** | Band **buzzes** and shows `FALL DETECTED — press to cancel`. Two short haptic pulses every 5s. | Band |
| **T+3–30s** | **The cancel window.** One button press ends it. Nothing has left the house. | Band |
| **T+30.0s** | No cancel, still no meaningful motion. Band publishes `fall_candidate` with confidence + accel trace. | Band → hub |
| **T+31.5s** | Backend opens a Twilio outbound call to the landline **and** the mobile, whichever answers first. Family contact is **not** yet notified. | Backend |
| **T+35.0s** | **The phone rings.** | Margaret's kitchen |
| **T+42.0s** | She reaches it. Deepgram Voice Agent, first sentence, recording disclosure included: *"Hi Margaret, this is Porchlight. Your band felt a hard fall about forty seconds ago. This call is recorded so I can log it for you. Are you hurt?"* | Deepgram + Twilio |
| **T+50.0s** | *"Oh — no, I'm okay. I just sat down hard reaching for the pantry."* | — |
| **T+52.0s** | Agent classifies `resolved_self_reported`. One confirm: *"Glad to hear it. Can you stand up on your own?"* → *"I'm up already."* | Deepgram |
| **T+55.0s** | *"Alright. I've logged it. If anything changes, press your band twice and I'll call your son. Take care, Margaret."* Call ends. | — |
| **T+56.0s** | Timeline entry written: `Hard fall · 2:07 pm · answered in 7s · self-reported unhurt · no escalation`. Transcript attached. **Dan's phone does not ring.** A single line appears in his app. | Event store → RN app |

**Branch B — escalation (the case that justifies the whole system).**

| Time | What happens |
|---|---|
| **T+0 → T+35s** | Identical to Branch A. |
| **T+35s** | Phone rings. No answer. Rings 6 times, ~30 seconds. |
| **T+65s** | **No answer** → this is now `unanswered`, the highest-risk state. |
| **T+67s** | Second attempt on the other number, 20s. |
| **T+90s** | Still nothing. Escalate. |
| **T+92s** | SMS to Dan fires first (fastest channel): *"Porchlight: hard fall detected for Margaret at 2:07 pm. She did not answer two calls. Calling you now."* |
| **T+95s** | **Dan's phone rings.** Agent: *"This is Porchlight. Margaret's band detected a hard fall at 2:07 pm. We called her twice and she did not answer. Do you want me to keep calling her, call a neighbour, or call 911?"* |
| **T+110s** | Dan says *"Call 911."* Agent dials, plays a location message, and stays on the line with Dan. |
| **T+112s** | Incident state → `escalated_911`, timestamped end to end. |

**Branch B′ — answered but not okay.** At T+50s she says *"I can't get up, my hip hurts."* Agent does **not** interrogate. It says *"I'm calling Dan right now and staying on the line with you."* Escalation fires at **T+53s** — 37 seconds faster than the no-answer branch, because a bad answer is more informative than no answer.

> **Compare to Apple Watch:** immobile for ~1 minute → a 30-second countdown → **it calls emergency services** and then messages your contacts ([Apple Support](https://support.apple.com/en-us/108896)). No one ever asks Margaret anything. Branch A does not exist on an Apple Watch: either she cancels, or an ambulance comes.

### 5.2 Onboarding journey (B2C) — target: under 12 minutes, and Margaret is present for all of it

1. **Dan buys.** Band ships to *Margaret's* address, not his. (Deliberate: she unboxes it.)
2. **Dan installs the app**, adds Margaret as the person, enters two phone numbers and one backup contact (her neighbour Cheryl).
3. **Margaret is called by the system, once, to enrol.** The agent introduces itself, states plainly what the band does and what it does not do, and asks her to say "I agree" — recorded and stored as the consent artefact. If she says no, the account does not activate. *Dan cannot override this.*
4. **Band pairing:** she holds the button; the app confirms. She walks 20 steps to calibrate.
5. **Beacon install — the one physical task, and it belongs to the family.** Five coin-cell BLE beacons, adhesive-backed, no wiring, no app pairing. Dan (or the neighbour, or the grandson on a Sunday) sticks them at picture height in the **kitchen, bathroom, bedroom, living room, and inside the front door**, then walks each room once while the app says "kitchen — got it." Target: **under 6 minutes, no tools.** The beacons are labelled in plain English on the sticker, not with MAC addresses, because Margaret will read them.
6. **Location consent, taken separately and taken second.** The agent calls back — a *different* call from the fall-detection enrolment — and asks specifically about room tracking, reads the copy in §8.4, and offers the bathroom opt-out *before* she has to ask for it. **She can say yes to falls and no to location and the product still works.** That is not a courtesy; it is the design.
7. **The rehearsal.** The system deliberately fires one test fall, the band buzzes, she cancels it. Then it fires a second, she lets it run, the phone rings, and she talks to the agent once in a low-stakes setting. **This step is non-negotiable** — it converts "an alarm will go off" into "I've done this before."
8. **She is shown her controls**, on the band and on a printed card: how to cancel, how to mute for 2 hours, how to switch location off while keeping fall detection on, how to turn everything off, and the sentence "say *stop recording* on any call."

### 5.3 The daily reassurance journey (the retention loop)

12:40 p.m., Tuesday. Dan opens the app at his desk.

- **Status line, top of screen:** `Mum · active · band worn 6h today · out of the house this morning · last event: Sunday`
  *(Note what is **not** on this screen: no floor plan, no "currently in: bathroom", no map. See §8.2.)*
- He types: **"How was Mum's week?"**
- RAG over the event store answers in ~2 seconds:
  > *"Quiet week. She left the house three times — Sunday 9:50 a.m. (about 2 hours, her usual church window), **Tuesday 10:15 a.m., back by 11:00 — like most Tuesdays**, and Friday 11 a.m. (about an hour). She moved around the house about as much as usual: 41 room-to-room trips a day on average against her 30-day median of 38. Step counts normal, a bit lower Thursday. One hard-fall check Wednesday 2:07 p.m.: she answered in 7 seconds and said she'd sat down hard reaching for the pantry — no escalation. Nights were normal. Want the Wednesday transcript?"*
- He taps the transcript, reads 40 words, and calls her that evening — **not** "are you okay?!" but "how's the pantry situation?" She laughs.
- He closes the app. **Session: 55 seconds.**

The design constraint that makes this work: **the chat answers questions; it does not volunteer worry.** No push notification was sent for the Wednesday event, because Margaret resolved it herself. He found it because he asked. That asymmetry is what keeps her wearing it.

### 5.4 The B2B night-shift journey

| Time | Event | What Alicia sees |
|---|---|---|
| 23:00 | Shift starts | Floor view: 32 residents, 3 flagged amber, 29 green. Amber = deviation from own baseline, not from a population norm. |
| 23:40 | Mr. Kaminski's legacy bed alarm | *(Porchlight suppresses it: band shows he's supine and still, hallway camera shows an empty hall. No page.)* |
| 00:00 | Rounds | Nothing. |
| 01:20 | Same bed alarm again | Suppressed again. **Two pages she did not get.** |
| **02:50** | **Mrs. Okoye, 214 — third hallway transit tonight** | **One page:** `214 Okoye · 3rd hallway trip 23:00–02:50 · 30-night median 0.6 · no fall · flag: possible UTI / delirium onset` |
| 02:52 | Alicia goes to 214 | She finds her disoriented and warm. Logs it. Day shift orders a urinalysis at 07:30. |
| 03:31 | **Real fall, 207** — band impact + hall camera shows nobody enters or leaves 207 for 40s | `207 FALL · high confidence · no staff presence detected` — page at **03:31:12** |
| 03:33 | Alicia arrives | **Time-to-discovery: 106 seconds.** Under the old pattern this was found at the 04:00 round — ~29 minutes. |
| 07:00 | Handover | Auto-generated shift summary: 2 events, 1 intervention, 1 fall, time-to-discovery stamped, 4 legacy alarms suppressed with reasons. Exportable. |

**Total pages to Alicia across the night: 2.** That number is the product.

### 5.5 The night bathroom journey (B2C) — the clinical value of location, without a map

This is the journey that justifies indoor tracking at all, and it is the one that has to be handled most carefully.

| Night | What the beacons record | What Dan sees |
|---|---|---|
| Mon–Sat, baseline | Bedroom → bathroom → bedroom, **0–1 times a night**, median 0.6, mean duration 3 min | **Nothing.** No notification, no screen, no line in the timeline. |
| Sunday 01:10, 02:40, 03:55, 05:20 | **4 bathroom transitions**, one of 11 minutes | **Nothing yet** — one bad night is noise. |
| Monday 00:50, 02:05, 03:20, 04:40, 06:05 | **5 transitions**, second consecutive night ≥4 | **Monday 08:00, one line:** `Two unusual nights — Mum was up 4 and 5 times, against her usual 0–1. Nothing else changed. Might be worth asking how she's feeling.` |

**Everything in that design is deliberate.** *Deviation, not data*: a normal night is not information, it is surveillance with a number on it. *Two nights, not one*: a single-night trigger fires on a cup of tea and burns the channel's credibility. *Morning, not live*: a 1 a.m. push teaches Dan to watch his mother in real time, which is precisely the behaviour the product exists to prevent. *A conversation, not an intervention*: "might be worth asking how she's feeling," never "possible UTI" — that boundary is also the FDA boundary (§8.6). And **Margaret can switch this off and keep everything else**; if she does we lose nocturia trending and keep her wearing the band, which is the correct trade every time.

### 5.6 The B2B wandering / door journey — the highest-value 40 seconds in the building

Six in ten people living with dementia will wander at least once ([Alzheimer's Association](https://www.alz.org/help-support/caregiving/stages-behaviors/wandering)), and the Association's own guidance to caregivers is to call 911 if the person is not found within **15 minutes**. In a 96-bed community with 32 memory-care residents and one awake overnight nurse — a staffing level that [17 states satisfy with the words "at least one awake staff person"](https://aspe.hhs.gov/sites/default/files/migrated_legacy_files//73501/15alcom.pdf) — fifteen minutes is roughly one round.

| Time | Event | System | Alicia |
|---|---|---|---|
| 03:38:00 | Mr. Ferreira (memory care, elopement-risk flag) leaves room 219 | Beacon: `219 → west hall` | — |
| 03:38:26 | Enters the west vestibule | Beacon: `west hall → west exit vestibule`, resident on the elopement roster, **no staff band within range** | — |
| 03:38:29 | — | Hall camera clip queried by the **local** VLM: *"one person, unaccompanied, moving toward the exterior door"* — confirms the beacon inference and suppresses the alternative hypothesis (a staff member carrying his band, a dropped band) | — |
| **03:38:31** | — | **Page fires. 31 seconds after he left his room.** | `219 FERREIRA · WEST EXIT · unaccompanied · 31s ago` |
| 03:39:10 | Alicia intercepts him in the vestibule | Event closed, `intercepted_in_building` | — |
| 03:39:12 | — | Incident written with the full beacon trace, the camera confirmation, and **time-to-intercept: 72 seconds** | — |

**Why this beats the incumbent.** The installed base in memory care is RF wander bracelets on magnetically locked doors: they tell you someone crossed the threshold, *after* the threshold. No interior granularity, no per-resident baseline, and no way to distinguish an escorted exit from an elopement — which is exactly why doors get propped and alarms get muted. Porchlight fires **before the door**, on the corridor, with a camera check that removes the commonest false positive. **The exportable trace with a to-the-second time-to-intercept is what Ray shows his insurance carrier** — the actual reason he signs.

---

## 6. Competitive matrix

| Product | Falls detected how | **Asks the person first?** | **Indoor location** | ADL tracking | Family chat | Price (public) | B2C / B2B |
|---|---|---|---|---|---|---|---|
| [Apple Watch](https://support.apple.com/en-us/108896) | Wrist IMU, on-device | **No.** ~60s immobile → 30s countdown → **dials 911**, then texts contacts | GPS outdoors only; **no room-level** | Steps, workouts, sleep — not ADLs | No | ~$249+, no subscription | B2C |
| [Life Alert](https://www.lifealert.com/) | Button press; fall-detect pendant option | **No.** Button → monitoring-centre operator you must first reach | Base-station proximity only | No | No | Not published; industry-reported ~$50–90/mo + activation fee + multi-year contract | B2C |
| [Medical Guardian](https://www.medicalguardian.com/pricing) | Button; fall detection as a paid add-on | **No.** Operator speaks through a base unit | GPS on mobile units | No | No | "About $1 a day" per their site | B2C |
| [Bay Alarm Medical](https://www.bayalarmmedical.com/) | Button; automatic fall detection add-on | **No** | GPS on mobile units | No | No | **$27.95–$39.95/mo** by device; fall detection extra | B2C |
| [Lively / GreatCall](https://www.lively.com/) | Button + fall detection on higher tiers | **No.** Urgent Response agent | GPS | Light | No | Device + tiered monthly plan | B2C |
| [SafelyYou](https://safelyyou.com/) | **Ceiling camera in the resident's room**, AI fall detection + clinician clip review | **No.** Staff dispatched; the resident is not consulted | Room-scoped (one camera = one room) | Limited (fall context) | No | Not public; per-bed enterprise | B2B memory care |
| [VirtuSense (VSTAlert)](https://virtusense.ai/) | Bed/room sensor; predicts bed-exit *before* the fall | **No** | Bed/chair zone only | Balance & gait assessment | No | Not public | B2B |
| [Sensi.AI](https://www.sensi.ai/) | **Audio** sensors; "always-on assessments" | **No** | Per-sensor room scope | Yes, audio-inferred care events | Agency-facing, not family | Not public | B2B home care |
| **[CarePredict (Tempo)](https://www.carepredict.com/)** | **Arm-worn wearable**, fall detection, two-way voice, geofencing | Two-way voice exists — but it is a **channel to staff**, not an autonomous triage conversation | **Yes — wearable + in-building location beacons, room-level** | **Yes — the deepest ADL inference of any incumbent** | No | Not public | B2B senior living |
| [Vayyar Care](https://vayyar.com/care/) | **Radar**; explicitly "no cameras, no wearables" | **No** | Per-room, one unit per room | Movement patterns, bathroom duration | No | Not public | B2B |
| [Kepler Vision (Night Nurse)](https://keplervision.eu/) | Computer vision on existing cameras, person-state recognition | **No** | Camera field of view | Partial (in/out of bed, posture) | No | Not public | B2B (EU-led) |
| [Inspiren](https://inspiren.com/) / Tellus / [Nobi](https://nobi.life/) | Wall sensor / radar / smart lamp | **No** | Per-room | Partial | No | Not public | B2B |
| **Wander-management incumbents** — [Accutech ResidentGuard](https://accutech.com/), Securitas Healthcare (ex-STANLEY) Arial, generic RF bracelets | Not a fall product | **No** | **Door threshold only** — binary "crossed / did not cross", no interior granularity, no baseline, cannot tell an escorted exit from an elopement | No | No | Not public; sold as door hardware + tags | B2B |
| **Porchlight** | **Band IMU** (impact + post-impact stillness) **+ local VLM on existing CCTV**, fused | **Yes — an autonomous voice agent calls the resident; their answer routes the incident** | **Yes — band Wi-Fi/BLE + beacons, room-level, and the *only* location source in B2C (no home cameras)** | **Yes**, against a **per-resident learned baseline** | **Yes — RAG over the event history, aggregates only** | **B2C: $149 kit + $29/mo. B2B: $16/bed/mo** | **Both** |

### 6.1 Why this is defensible — and where the pitch is weak

**Be honest first, because a judge will be.**

- **Apple Watch already detects falls and calls people.** It does, well, on a device tens of millions of people already own, with no subscription. **A band whose only feature is fall detection is dead on arrival.**
- **[SafelyYou](https://safelyyou.com/) already does camera-based fall detection in memory care**, commercially, at scale, in real buildings. Re-solving that in 24 hours is not a company.
- **And the uncomfortable one: [CarePredict](https://www.carepredict.com/) is already most of this system.** An arm-worn wearable. Room-level indoor location from in-building beacons. ADL inference. Fall detection. Two-way voice. Sold per bed to senior living. If you put their feature list next to the B2B half of this spec, the overlap is embarrassing, and any judge who knows the space will say so before you do. **Say it first.**

**So what is actually left? Three things, in descending order of strength.**

**1. The conversation between the fall and the escalation. (Strong — this is the real one.)**
No shipping product asks the person on the floor a question and lets the answer route the incident. Apple counts to 30 and dials 911. Life Alert connects a human operator — but only if the button is pressed, and the button is [not pressed in 80–97% of the falls that matter](https://pmc.ncbi.nlm.nih.gov/articles/PMC2590903/). SafelyYou sends staff and shows them video. CarePredict's two-way voice is a walkie-talkie to the nurses' station, not an autonomous triage agent that decides whether to wake anybody. The insight is behavioural, not technical: **people abandon these devices because being wrong is expensive, and a 20-second phone call is the cheapest possible way to be wrong.** It is newly buildable because conversational voice only became fast and cheap enough in roughly the last 18 months — at [$0.075/min](https://deepgram.com/pricing) this is an 11-cent incident; in 2019 it required a human call centre, which is literally what Life Alert is and exactly why it costs what it costs.

**2. Local-only inference and the aggregation firewall. (Medium-strong, and underrated.)**
Every camera-based incumbent processes video off-box or reserves the right to. Porchlight's video never leaves the building and the family app is architecturally incapable of showing a live position. That is a **product-policy** moat rather than a technical one — but in eldercare, policy *is* the product, because the resident holds the veto (§8). It is also, conveniently, the margin story (§7.3).

**3. The per-resident learned baseline and the family-facing RAG chat. (Weakest — say so.)**
"Three hallway trips is abnormal *for Mrs. Okoye*" beats "three hallway trips," and several vendors gesture at this without exposing it as the reason for the alert. But baselines are a data-accumulation advantage: a real moat at year three, and **no moat at all at hour 24**. The RAG chat is a UI pattern anyone can copy in a week. Its value is the *restraint* it encodes, not the retrieval. **Do not lead with either.**

**The honest weaknesses** — two products in 24 hours, a band with 24 hours of false-positive tuning against Apple's five years, BLE location that is 1–3 m accurate and will misfire on stage, and a CCTV VLM that is the most legally loaded component while contributing least to the headline story — are enumerated with mitigations in §12.

---

## 7. Business model

### 7.1 B2C pricing — Porchlight Home

| Line | Price | Benchmark |
|---|---|---|
| **Starter kit** — band + **5 room beacons** + charger, one-time | **$149** | Apple Watch SE ~$249 with no subscription; PERS devices are often "free" but locked to a contract |
| Monitoring + app + voice agent + location | **$29 / month**, no contract, cancel anytime | Bay Alarm **$27.95–$39.95/mo** with fall detection extra ([source](https://www.bayalarmmedical.com/)); Medical Guardian "about $1 a day" ([source](https://www.medicalguardian.com/pricing)); Life Alert is widely reported at a higher monthly rate **plus an activation fee and a multi-year contract** |
| Extra beacons (bigger house, basement, garage) | $12 each | — |
| Second family member on the app | $0 | — |
| Second band (a couple) | $109 + $10/mo | — |

**Install story (B2C): the family installs it, in one visit, with no tools.** Five adhesive coin-cell beacons at picture height. The pitch line is *"if you can hang a photo, you can install this"* — and it is chosen deliberately over anything requiring a truck roll, because **the incumbent PERS model's activation fee and professional install is precisely the friction we are attacking.** Beacons are battery-only (no mains, no Wi-Fi join, no pairing screen), ~12-month coin cell, and the app nags Dan when one goes quiet. If a beacon dies, **fall detection is unaffected** — location degrades, safety does not.

**The pricing message is one line: *same price as Life Alert, no contract, no activation fee, and it asks your mother before it calls an ambulance.*** The competitive vulnerability of the PERS incumbents is not their price, it is their **contracts** and their **install fees** — that is where a modern product wins on positioning without discounting.

### 7.2 B2B pricing — Porchlight Care

| Line | Price |
|---|---|
| Per bed, per month (band + platform + location) | **$16** |
| Beacon infrastructure (rooms, hallways, every exterior door) | Included in implementation; ~1.3 beacons/bed |
| Local inference appliance (one per wing, incl. CCTV ingest) | $1,800 one-time **or** $60/mo |
| Implementation + beacon install + consent onboarding | $2,500 one-time per community |
| Audit/insurance report pack (fall time-to-discovery + elopement time-to-intercept) | +$2/bed/mo (P2) |

**Install story (B2B): maintenance staff, one afternoon per wing.** A 96-bed community needs roughly 125 beacons (one per resident room, two per hallway segment, one per exterior door, one per common room). They are adhesive, batteryless-optional (door and hallway units can take USB power from existing outlets so the high-traffic nodes never go quiet), and mapped by walking the building once with the commissioning app. **Crucially the exterior-door beacons are the ones that must never fail**, so those are mains-powered and heartbeat-monitored, with a dashboard alarm if one drops.

**Sanity check against the buyer's P&L.** Median assisted living revenue is **$6,200/bed/month** ([CareScout 2025](https://www.carescout.com/cost-of-care)). $16/bed/mo is **0.26% of revenue** — below the threshold where a regional VP has to approve. A 96-bed community = **$1,536/month ≈ $18.4k ARR**; the average US community is 33 beds ([AHCA/NCAL](https://www.ahcancal.org/Assisted-Living/Facts-and-Figures/Pages/default.aspx)) ≈ $6.3k ARR, so the go-to-market must target operators with **multiple** communities, not single sites. With 41,465 communities and 1.4M licensed beds, a 1% bed share at $16/mo is **$2.7M ARR** — a real but not enormous market, which is the honest read. The upside case is not more beds, it is the **insurance line**: if a carrier will discount a general-liability premium for documented elopement time-to-intercept, the product stops being a cost and starts being a rebate, and per-bed price ceases to be the negotiation.

### 7.3 Unit economics — the actual cost of a conversation

Rates, looked up:

| Component | Rate | Source |
|---|---|---|
| Deepgram Voice Agent API (STT + LLM + TTS) | **$0.075/min** pay-as-you-go ($0.068/min on Growth) | [deepgram.com/pricing](https://deepgram.com/pricing) |
| Deepgram Nova-3 streaming STT (if unbundled) | $0.0058/min | [same](https://deepgram.com/pricing) |
| Deepgram Aura-2 TTS (if unbundled) | $0.030 / 1,000 chars | [same](https://deepgram.com/pricing) |
| Twilio outbound voice, US | **$0.0140/min** | [twilio.com voice pricing](https://www.twilio.com/en-us/voice/pricing/us) |
| Twilio inbound voice, US | $0.0085/min | [same](https://www.twilio.com/en-us/voice/pricing/us) |
| Twilio local number | $1.15/month | [same](https://www.twilio.com/en-us/voice/pricing/us) |
| Twilio SMS, US long code | $0.0083 + carrier fee $0.0035–$0.0050 | [twilio.com SMS pricing](https://www.twilio.com/en-us/sms/pricing/us) |

**Cost per incident:**

| Incident type | Composition | Cost |
|---|---|---|
| **Resolved by voice agent** (~75s call) | 1.25 min × ($0.075 + $0.014) | **$0.111** |
| **Escalated** (2 unanswered attempts ~50s + 1 SMS + 90s call to the child) | 0.83 min × $0.089 + $0.013 + 1.5 min × $0.089 | **$0.221** |
| **Escalated to 911** | + ~2 min bridged | **$0.40** |

**Blended B2C COGS per household per month** (3 fall checks/month, 80% resolved / 20% escalated; shared number pool; RAG chat ~$0.15/mo of LLM; **location adds essentially nothing** — beacon RSSI classification runs on the band and the hub, not in the cloud, and the event store writes ~2 kB/day/household):

`3 × (0.8 × $0.111 + 0.2 × $0.221) + $1.15 (number) + $0.15 (LLM) + $0.05 (storage/sync) ≈ $1.75`

**Against $29/month revenue: ~94% gross margin on the service line.**

**Hardware BOM, prototype vs at scale:**

| Item | Hackathon / prototype | At 10k units |
|---|---|---|
| Compute + IMU | Arduino UNO Q 2GB [€59.90 ≈ $65](https://store.arduino.cc/products/uno-q) + Modulino IMU ~$12 | nRF52840-class SoC + LSM6DSO IMU, **$9–13** |
| Battery, charger, band, enclosure | ~$35 | ~$11 |
| **Beacons (×5)** | ESP32 dev boards from the hardware hub, ~$8 ea = **$40** | Purpose-built BLE coin-cell beacon, **$2.50–4.00 ea = $13–20** |
| **Kit total** | **≈ $152** | **≈ $35–45** |

At $149 the prototype kit is **sold at a small loss**; at scale it carries ~70% margin but that is not the point. **Hardware is a customer-acquisition cost, not a revenue line — price it near cost, never discount the subscription, and note that the beacons are what stop a customer churning**, because ripping five stickers off the wall is a higher-friction cancellation than returning a pendant. That is a retention asset and it is also, uncomfortably, a mild dark pattern; the mitigation is that cancellation is one tap and we do not ask for the beacons back.

**B2B inference cost.** Video stays on premises, so per-minute inference cost is electricity, not API spend. One local box (~$1,200–1,800, Jetson Orin-class) running a small VLM at ~1 fps over 4 hallway cameras, amortised over 36 months, is **$33–50/month**. A box covering a ~30-bed wing is **~$1.30/bed/month**. Beacons add ~1.3 units/bed at $3 = **$4/bed one-time**, i.e. **$0.11/bed/month** over three years — location is the cheapest thing in the system and the most valuable per dollar. The voice agent is largely unused in memory care by design (§4.2). **B2B gross margin lands near 85% including the appliance. The local-inference decision is simultaneously the privacy story and the margin story** — say that out loud to a judge, because those two things almost never point the same way.

### 7.4 The wedge: which one do you sell first?

**Sell B2B first. Demo B2C first.** These are not in conflict, and conflating them is the single most common pitch error in this category.

**Why B2B is the wedge:**
- There is **one named buyer with a budget line** (Ray), not a fragmented market of guilty adult children with a 40% first-year churn rate.
- The buyer has **three independent compliance/financial drivers** — survey deficiencies, insurance re-quoting, agency labour cost — any one of which closes a deal.
- **One signature covers 33–96 beds.** B2C CAC in eldercare is brutal (the incumbents spend heavily on TV) and the ARPU is $29.
- **SafelyYou has already done the market education.** Directors know what camera-based fall tech is and that it works. Selling against a category that exists is far cheaper than creating one.
- **Elopement is the sharpest single wedge inside the wedge.** Falls are a chronic cost; an elopement is an acute, existential one — it is the incident type that produces the survey citation, the local news story and the lawsuit. A 96-bed community with 32 memory-care residents, [six in ten of whom will wander at least once](https://www.alz.org/help-support/caregiving/stages-behaviors/wandering), is carrying that risk every night with one awake nurse. **Lead the B2B sales conversation with the 31-second door alert (§5.6), not with falls** — falls are what the buyer has learned to tolerate; elopement is what keeps him awake.
- The B2B deployment generates the **baseline data** that makes the per-resident model good, which is the only durable moat.

**Why B2C leads the demo:** Margaret's phone ringing is legible in eleven seconds to a judge who has a grandmother. A staff dashboard is not. **Pitch the B2C story, close on the B2B slide.**

---

## 8. Trust, consent and the creepiness budget

> This is the section that decides whether the company exists. Fall detection is a modest consent ask — a device that notices an accident. **Continuous room-level tracking of a 79-year-old in her own home is a categorically larger one**, and "we know when you're in the bathroom" is the exact sentence where the resident stops trusting the family and the band goes in the drawer. Every other section of this document is downstream of getting this right.

### 8.1 The governing principle: show deviations, not surveillance

There is one line between a reassurance product and a tracking product. It is not encryption and it is not a privacy policy. It is **what resolution the other person can see.**

| | Tracking product | **Porchlight** |
|---|---|---|
| Family sees | Live position on a floor plan | **A status line and a timeline of exceptions** |
| Update cadence | Real time | **Daily, and only when something deviates** |
| Normal days | Rendered as data | **Rendered as nothing** |
| Bathroom | A room on the map | **A count, and only when 2+ nights are unusual** |
| Question it answers | "Where is she right now?" | **"Is anything different?"** |

The family app **has no floor plan, no map, no live location and no per-room dwell chart, and there is no admin toggle that adds one.** This is enforced in the API, not the UI: family-scoped endpoints do not return room identifiers at all — only `out_of_home: true|false`, aggregate counters and deviation flags. If Dan pulls the client apart and calls the API directly, **the raw trace still isn't there.** That is the difference between a policy and a guarantee, and it is worth engineering, because a policy is one growth sprint from being reversed.

**The B2B exception, stated plainly:** staff *do* see live room-level location, unredacted, because a nurse who cannot locate a resident cannot do her job and 30 seconds at an exterior door is the whole product. The controls there are different in kind — **access is logged, attributable to a named staff account, and reviewable by the resident's representative.** We don't pretend the facility deployment is privacy-preserving in the same sense as the home one; it is *differently* governed, and Ray's paperwork says so.

### 8.2 Who can see what

| Data | Margaret | Dan (family) | Facility staff | Porchlight staff | Leaves the building? |
|---|---|---|---|---|---|
| Raw accelerometer trace | On request | No | No | Only with a support ticket she opens | No (summarised only) |
| **Raw room-by-room location trace** | **Yes — her own, in full, on her own device** | **No. Never. Not aggregated *and* not raw** | **Yes (B2B only), access logged** | **No** | **No — stays on the home hub / facility box** |
| `out_of_home` / `returned_home` | Yes | **Yes** | Yes | No | Yes (single boolean + timestamp) |
| Bathroom visit counts | Yes | **Only as a 2-night deviation flag** | Yes (B2B) | No | Aggregate only |
| Room-transition count/day | Yes | **Yes, as a number vs her own median** | Yes | No | Aggregate only |
| CCTV video (B2B) | On request via the facility | **No** | Yes, for an open incident, time-boxed | **No** | **Never. Inference runs on the local box; only event rows sync** |
| Call recordings & transcripts | Yes, all of them | Only for calls she was told would be shared | Incident-scoped | No | Yes, encrypted |
| Fall events | Yes | Yes | Yes | No | Yes |

**What the family is explicitly NOT shown, and we say this in the marketing, not just the terms:** live location, a floor plan, a heat map, time-in-bathroom, sleep staging, any inference about cognition or "decline scores", any raw audio, and any camera image whatsoever. **We do not ship a "decline score."** A number that tells a son his mother is getting worse is a product that will be used to override her.

### 8.3 What the resident can switch off, and how

Every one of these is reachable by Margaret without the app, without Dan, and without calling support:

| Control | How | Effect |
|---|---|---|
| **Cancel this alert** | One press on the band, within 30 s | Nothing leaves the house |
| **Privacy window** | Hold the band button 3 s → "Location paused 2 hours" | Location stops; **fall detection keeps running** |
| **"Don't track the bathroom"** | A first-class setting, offered at enrolment before she asks | The bathroom beacon is unenrolled. Transitions into it are recorded as `private`. No counts, no deviation flags, no nocturia trend — permanently, until she changes it |
| **Physical switch: location off** | A recessed slide switch on the band | **Radios used for positioning are disabled; IMU fall detection continues.** The app shows "location off, by Margaret" — it does not show it as an error or nag Dan about it |
| **Stop recording this call** | Say "stop recording" at any point | Recording ends mid-call, the agent confirms out loud, the partial transcript is deleted, the incident is still logged |
| **"Don't call my son for this"** | Say it to the agent | That incident does not escalate. The next one still will |
| **Off** | Hold both buttons 10 s | Everything stops. Dan is told it is off, not why |

**Two rules the engineering team does not get to negotiate:**
1. **No family-side override of a resident control exists.** Not in the app, not in an admin console, not by calling support. If Dan wants location back on, he has to ask his mother.
2. **Switching location off must never degrade fall detection.** The moment a privacy choice costs safety, the product has made the resident choose between dignity and living alone, and she will choose wrong.

### 8.4 Consent — taken from the resident, separately, for each thing

Consent is taken as **three independent grants**, not one checkbox: **(a) fall detection, (b) indoor location, (c) camera-derived ADLs (B2B only).** Any one can be refused and the others still work. Consent is captured on a recorded call with the resident, stored as the artefact, and **re-confirmed every 12 months** — because a yes given at move-in, by a person who has since developed dementia, is not a yes.

**For residents who cannot consent (memory care):** the legally authorised representative signs, **and** the resident is still told in plain language, **and** a refusal behaviour — pulling the band off repeatedly, distress at the beacons — is treated as a withdrawal of assent and escalated to the care team, not engineered around. That is written into the implementation runbook, not just the ethics slide.

**Exact on-screen / read-aloud copy — fall detection:**

> **Porchlight watches for falls.**
> The band on your arm feels sudden impacts. If it thinks you've had a hard fall, it will buzz and give you **30 seconds to cancel**. If you don't cancel, we'll **call you and ask if you're alright** — a real conversation, not an alarm. If you say you're fine, that's the end of it and nobody else is called.
> If you don't answer, or you tell us you need help, we'll call **Dan** and tell him what happened.
> **We will never call an ambulance without asking you or Dan first.**
> Do you agree to this? You can change your mind any time by holding the band's button.

**Exact on-screen / read-aloud copy — indoor location (this is its own screen and its own spoken consent, deliberately separated):**

> **Porchlight can also tell which room you're in.**
> Small stickers in your kitchen, bathroom, bedroom, living room and front door let the band work out roughly which room you're in. We use it for three things: to know **if you've been out of the house today**, to count **how many times you get up at night**, and to tell the paramedics **which room you're in** if you ever need them.
> **Here is what Dan can and cannot see.** He **cannot** see where you are. There is no map in his app, no dot, no floor plan, and no way for him to turn one on — not even by calling us. He will only ever see **how many times you went out** and, if your nights change a lot for **more than one night in a row**, one sentence the next morning saying so.
> **You can turn the bathroom off right now** and we'll never count it. You can pause location for a couple of hours whenever you want, or switch it off for good with the slider on the band — **and your fall detection keeps working exactly the same either way.**
> This is a separate question from the fall alarm. **You can say no to this and yes to that.**
> Do you agree to location? — **[ Yes ] [ No ] [ Yes, but not the bathroom ]**

**Exact call preamble — spoken as the first sentence of every outbound call, before any question is asked:**

> *"Hi Margaret, this is Porchlight. Your band felt a hard fall about forty seconds ago. **I'm recording this call so it goes in your log — say 'stop recording' any time and I'll stop.** Are you hurt?"*

### 8.5 The two-party consent problem — real, and not solvable by a checkbox

An AI voice agent that records a phone call is squarely inside state wiretap law. **Roughly a dozen states require the consent of *all* parties to a recorded conversation**, and Massachusetts — where HackMIT is held and where this would be demoed — is among the strictest: [M.G.L. c. 272 § 99](https://malegislature.gov/Laws/GeneralLaws/PartIV/TitleI/Chapter272/Section99) defines interception as to *"**secretly** hear, **secretly** record"* a wire or oral communication without *"prior authority by **all parties**,"* with penalties up to **$10,000 or five years**. California ([Penal Code § 632](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=632)) and Florida, Illinois, Pennsylvania and Washington impose comparable all-party rules.

**The engineering consequences, which are design constraints and not legal boilerplate:**

1. **Disclosure is the first sentence, always, on every call, to every party** — including the escalation call to Dan and any bridged third party. Not a menu, not a footer, not buried at enrolment. Massachusetts turns on *secrecy*; a recording announced in the opening sentence of every call is not secret.
2. **"Stop recording" is an implemented function call in the voice agent**, not a promise. It halts the recorder, deletes the partial audio, and the agent says so out loud. The incident is still logged as metadata.
3. **The consent artefact is itself recorded with disclosure**, and stored per-party.
4. **Jurisdiction is resolved from the called number's area code and the account address, and the strictest applicable rule is applied.** We do not run a per-state matrix in the product; we run the all-party rule everywhere. It costs one sentence and removes an entire class of risk.
5. **For the hackathon demo specifically:** anyone whose voice will be on a call — including a judge who picks up the phone — is told before they answer, on a slide and out loud. If a judge says no, the demo runs on the pre-recorded track.

### 8.6 Regulatory posture

| Area | Position | Why |
|---|---|---|
| **FDA** | **General wellness / non-device.** We make no claim to diagnose, treat, mitigate or prevent any disease. We say "she was up more than usual," never "possible UTI," never "fall risk score," never "cognitive decline." | [FDA, *General Wellness: Policy for Low Risk Devices*](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices). Apple markets watch fall detection on the same basis. **The moment the product outputs a clinical inference, it is a regulated device** — which is exactly why §5.5 says "might be worth asking how she's feeling." |
| **HIPAA** | Assume **Business Associate** status on every B2B deal and sign a BAA, even where the operator is arguably not a covered entity. | Many assisted-living operators are not covered entities, but some are (Medicare/Medicaid billing, on-site skilled services), and the enterprise buyer's counsel will ask. Signing a BAA is cheap; arguing about it loses the quarter. B2C is **not** HIPAA-regulated (direct-to-consumer, no covered entity) — but we hold the same bar, and we say so rather than advertising a compliance we don't have. |
| **Cameras in resident rooms** | **We do not put cameras in resident rooms. Hallways and common areas only.** | A growing number of states have "granny cam" statutes governing electronic monitoring in long-term care rooms, typically requiring written resident consent **and roommate consent**, with audio treated more strictly than video. Staying out of private rooms sidesteps the hardest version of this entirely, and is also what Ray wants (§3.4). |
| **Audio** | The facility product records **no audio from cameras at all.** Only the consented, disclosed phone calls. | Audio recording is treated far more strictly than video in both wiretap and granny-cam law. |
| **What the demo must disclaim, out loud and on a slide** | "This is a prototype. It is **not a medical device**, it is **not a substitute for calling 911**, the resident data on screen is **synthetic**, and any phone call in this demo is **announced and consented** before it is placed." | Non-negotiable. Say it in the first 15 seconds so it never has to be said defensively in Q&A. |

---

## 9. Metrics

**North star: median time from an unrecovered fall to a human who can help knowing about it ("time-to-human-contact").**
Every other number in the business is an input to this one. It is the number that maps directly to the [long-lie literature](https://pubmed.ncbi.nlm.nih.gov/6779979/) — half of those who lay over an hour were dead within six months — and it is the number a facility director, an insurance underwriter and an adult child all understand without a glossary. **Baseline to beat: 29 minutes** (the gap to the next scheduled round in §5.4). **Target: under 3 minutes.**

**Guardrail on the north star:** it is only reported for accounts with **band wear-time ≥ 80% of waking hours**. A product nobody wears has a perfect time-to-contact over zero events, and optimising the north star without this guardrail rewards exactly the wrong thing.

| Metric | Definition | Target | Why it is on this list |
|---|---|---|---|
| **Band wear-time %** | Worn hours ÷ waking hours | **≥ 80%** | The literature says 24% of PERS users never wear the button and only 14% wear it always ([Heinbüchner 2010](https://pubmed.ncbi.nlm.nih.gov/20814795/)). Beating 14% is the whole thesis; anything under 80% means we built another pendant. |
| **False-alarm rate per resident-week** | Fall alerts that reached *anyone* and were not falls | **< 0.5** | Above ~1/week, Alicia stops responding and Margaret takes it off. |
| **% of alerts resolved by the voice agent without escalation** | `resolved` ÷ all fall checks | **70–85%** | This is the *product*. If it is 99%, we're missing real falls. If it is 30%, the detector is too jumpy and we are waking Dan for nothing. |
| **Median time-to-human-contact** | North star, above | **< 3 min** | — |
| **Escalation precision** | Escalations that a human judged warranted | **> 80%** | Dan's tolerance for being wrongly woken is roughly three times, ever. |
| **Family app WAU / enrolled household** | — | **> 60%** | The reassurance loop is the retention mechanism; if he stops opening it, he cancels at month 7. |
| **Family sessions ending without a notification having prompted them** | Pull, not push | **> 50%** | A healthy number here means we are reassurance, not anxiety-as-a-service. |
| **B2B: incidents caught before the nurse's round** | Events surfaced by the system vs found at the next scheduled round | **> 75%** | Ray's whole purchase. |
| **B2B: pages per nurse per shift** | — | **≤ 3** | Directly inverse to alarm fatigue. Go above this and the deployment dies quietly. |
| **B2B: elopement time-to-intercept** | Exit-corridor detection → staff contact | **< 90 s** | Against a 15-minute call-911 threshold ([Alz. Assoc.](https://www.alz.org/help-support/caregiving/stages-behaviors/wandering)). |

**Location-specific metrics** (new, and the ones most likely to be quietly bad):

| Metric | Definition | Target |
|---|---|---|
| **Room-classification accuracy** | Correct room ÷ labelled ground-truth samples | **≥ 90%** for coarse zones (bedroom / bathroom / kitchen / living / out); we do **not** claim sub-room precision |
| **Confident-coverage %** | Share of the day with a room estimate above the confidence threshold | **≥ 85%**; below that, deviation stats are not published at all rather than published wrong |
| **Beacon uptime** | Beacons heartbeating in the last 24 h ÷ enrolled | **≥ 98%**; exterior-door beacons in B2B are held to **100%**, with a dashboard alarm on any miss |
| **False wandering alerts per resident-week** | Exit alerts that were an escorted exit, a stationary band, or an RF artefact | **< 0.2** — one false 3 a.m. elopement page per resident per week would get the system unplugged inside a month |
| **Location-consent acceptance rate** | Residents who accept location when asked separately | Tracked, not targeted. **If it drops below ~60% we have written the consent copy badly, not chosen the wrong feature.** |
| **Bathroom opt-out rate** | Residents who take the bathroom exclusion | Tracked, not targeted. A healthy number is **non-zero** — if nobody ever opts out, we are not offering it clearly enough. |

---

## 10. Demo narrative for judges (3 minutes)

**Setup on the table:** the band on a wrist (or a forearm mount), **two phones face-up with ringers loud** (one labelled MARGARET, one labelled DAN), a laptop mirrored to the screen showing the family app on the left and the facility dashboard on the right, and one ESP32 beacon visibly taped to the edge of the table labelled **BATHROOM**.

| Time | Who / what | On screen | Said |
|---|---|---|---|
| **0:00–0:15** | Presenter A | Title slide with the disclaimer line | *"Quick disclaimer, then we start: this is a prototype, not a medical device, all the resident data is synthetic, and any call you hear is announced and consented first."* |
| **0:15–0:35** | Presenter A | One stat, large: **80%** | *"When an older person falls and can't get up — in a home that already has an alarm — the alarm doesn't get pressed 80% of the time. For the falls where they lie there over an hour, it's 97%. The pendant isn't broken. Nobody presses it, because being wrong costs an ambulance."* |
| **0:35–0:50** | Presenter B | Family app, status line: `Mum · active · out this morning` | *"This is her son's app. Notice what isn't here: no map, no camera, no live location. He can't see where his mother is. He gets one line a day. That's deliberate and I'll come back to it."* |
| **0:50–1:00** | **Presenter B drops the band onto the table from ~1 m** | Dashboard flips to `FALL DETECTED — 30s to cancel` with a visible countdown | *"So — that's a fall."* |
| **1:00–1:20** | — | Countdown runs 30 → 0. Silence in the room. | *"Thirty seconds to cancel. Nothing has left the room yet. No ambulance, no phone call to anyone's son."* |
| **1:20** | **MARGARET's phone rings, loudly, on the table** | Dashboard: `CALLING RESIDENT` | — |
| **1:20–1:50** | **A judge is invited to pick it up.** Agent: *"Hi, this is Porchlight. Your band felt a hard fall about forty seconds ago. I'm recording this call so it goes in your log — say 'stop recording' any time. Are you hurt?"* Judge: *"I'm fine, I just sat down hard."* Agent: *"Glad to hear it. Can you get up on your own?"* Judge: *"Yes."* Agent: *"Alright, I've logged it. Take care."* | Live transcript streams. Dashboard flips **red → green: `RESOLVED BY VOICE · no escalation`**. A single line appears in the son's timeline. **DAN's phone stays silent.** | — |
| **1:50–2:05** | **← THE 10-SECOND MOMENT.** Presenter B drops the band again. Phone rings. Judge picks up. Agent asks. Judge says: ***"I can't get up. My hip hurts."*** | Dashboard: **`ESCALATING`** — and **DAN's phone rings on the table within 5 seconds**, agent already speaking: *"This is Porchlight. There's been a hard fall at 2:07. She says she can't get up. Do you want me to call 911?"* | *(say nothing — let the second phone ring)* |
| **2:05–2:25** | Presenter A | Facility dashboard: 32 residents, 2 pages all night. Then the beacon trace of §5.6 replays: `219 → west hall → west exit` and a page at **31 seconds** | *"Same band, same event store, at a memory-care facility. One awake nurse, 32 residents — which is all 17 states require. Six in ten people with dementia wander. The old system tells you after the door opens. We page 31 seconds before it." * |
| **2:25–2:40** | Presenter B | Camera view with a **LOCAL — never leaves the building** badge; then the family chat: *"How was Mum's week?"* → the §5.3 answer | *"The camera inference runs on a box in the building. No video leaves. And what the family gets isn't a feed — it's an answer."* |
| **2:40–3:00** | Presenter A | Final slide: `$149 + $29/mo · $16/bed/mo` and **"the product shows deviations, not surveillance"** | *"Eleven cents a call. Ninety-four percent margin. But the reason it works isn't the price — it's that we ask her first, and we never show him where she is. That's what gets it worn."* |

**The single 10-second moment** is 1:50–2:05: the judge answers *badly*, and **the second phone on the table starts ringing while they're still holding the first one.** It works because they can hear both. Do not narrate over it.

### 10.1 Fallback ladder if the hardware fails

| Failure | Fallback | Rehearsed? |
|---|---|---|
| Band doesn't detect the drop | **A second presenter has a phone with a big red `SIMULATE FALL` button** wired to the same event endpoint. Say *"the band is being shy — here's the same event from the simulator"* and keep moving. **Never debug on stage.** | Yes — press it once in rehearsal so the muscle memory exists |
| Wi-Fi dies / venue network blocked | Everything runs on a **local hotspot** carried in the bag; the voice call is the only thing needing the internet, so the hotspot is the primary network, not the venue's | Yes |
| Twilio call doesn't connect, or A2P verification isn't through | **Pre-recorded audio of the exact same call**, played from the laptop, with the live transcript pane replaced by a screen recording. Say *"this is a recording of the call we placed this morning"* — judges forgive a recording, they do not forgive a stall | Yes — record it at hour 18, not hour 23 |
| Expo-hall noise wrecks the agent's ASR | **Wired headset** into the phone; judge holds the headset, not the handset. Plus a scripted single-utterance path so the agent doesn't need to turn-take under noise | Yes |
| **BLE beacon localization is wrong on stage** (likely — see §12) | The beacon trace for the facility segment is a **replay of a real capture recorded in a quiet room**, explicitly labelled `REPLAY` on screen. The *live* beacon on the table is used only for one binary event: `entered BATHROOM zone` / `left`, which is robust | Yes |
| Judge declines to take the call | Presenter takes it and speaks the resident's lines | Trivially |

---

## 11. Prize-track mapping — HackMIT 2026

Sponsor challenges are separate from the four general tracks, and a project may submit to **at most one general track**. Challenge wording below is from the official HackMIT 2026 Challenges & Prizes document.

| Track | Fit | Why | What to emphasise in *that* submission |
|---|---|---|---|
| **Deepgram — "Build Something Worth Talking To"** (must call a Deepgram API; 1st: a Switch per member) | **Very strong — submit** | A **full end-to-end Voice Agent** with function calling that makes a routing decision with real consequences — not a TTS wrapper. Their framing (*"pick something you would actually use"*) fits a product whose whole thesis is that the call *is* the feature. | Lead with the **state machine**, not the voice: `resolved / uncertain / escalate` as tool calls, visibly changing the dashboard. Mention low-latency turn-taking (Flux `EagerEndOfTurn`) and the `stop_recording` function call as the agent *doing* something. Show **$0.11 per incident**. |
| **Arduino — "Touch Grass"** (UNO Q; top 2) | **Very strong — submit** | The brief says the best projects *"won't just visualize sensor data, they'll transform it into meaningful, intelligent experiences."* An IMU transient becoming a phone conversation with a human being is about as literal a reading of that as exists. | Emphasise the **dual-brain split** the UNO Q was built for: STM32U585 runs the fall classifier deterministically; the Dragonwing QRB2210 Linux side runs BLE scanning, room classification and networking. Show the raw accel trace beside the resolved conversation. **Most likely track to win outright.** |
| **Espressif — "Best Use of Espressif Hardware (In AIoT)"** (ESP32-S3-DevKitC-1 / S3-Box at the hub) | **Strong — submit** | The beacon mesh is Espressif hardware doing real work: **ESP32-S3 boards as BLE room beacons** feeding room classification, and if time permits an **ESP32-S3-Box as the in-home voice endpoint** so the resident never has to reach a phone. Literal AIoT — edge radios feeding an inference layer. | Frame it as a **mesh, not a gadget**: N cheap nodes + one wearable = room-level location for under $20 of silicon, with the intelligence in the fusion. Note the door node is mains-powered and heartbeat-monitored, because reliability *is* the product. |
| **Healthcare (general track)** | **Strong — the one general track to enter** | Falls are the leading cause of injury death in 65+: **43,000+ deaths, ~$80B/yr** ([CDC](https://www.cdc.gov/falls/about/index.html)), and the long-lie argument is peer-reviewed and specific. | Lead with **evidence, not tech**: the 80%/97% non-activation numbers and the Shorr RCT showing bed alarms don't reduce falls — then position the voice agent as the intervention that fixes the *behavioural* failure the literature identifies. State the FDA general-wellness boundary explicitly; clinical judges respect the restraint. |
| **Meta — "Bringing People Closer Together with AI"** (top 3 advance to Menlo Park Round 2) | **Medium — submit, but honestly** | The family RAG chat and the daily digest genuinely change a relationship: Dan calls his mother about the pantry instead of asking "are you okay?". Meta's own examples include *"organize scattered family updates into a shared story."* **But be honest: this is a safety product with a connection feature, not a social product.** Meta judges on *"how meaningfully they strengthen human connection"* and *"how essential AI is"* — AI is essential here, connection is real but secondary. | Submit the **connection half as the project**: the chat, the digest, and — this is the strongest Meta-specific argument — the **deliberate refusal to show live location.** Most "family connection" products build a map. We removed the map so the relationship survives. That is a connection thesis, not a safety one. Requirements: 2–3 min demo video, public repo, and a write-up on who it's for and why AI is essential. **Do not oversell; a thin social claim reads worse than a modest true one.** |
| **Long Lake — "Convince a Non-Believer"** (top 3) | **Strong — submit** | The challenge asks for *"an AI-powered product or experience that a skeptic would try, love, and want to use again."* Margaret **is** the skeptic — she threw the last one in a dish by the door — and the product is designed backwards from her objections (§3.1, §8.3). | Make the **skeptic the protagonist of the pitch**. Open on her objection in her own words — *"I'm not going to have him checking up on my bathroom"* — and show that the answer is architectural, not rhetorical: the API physically cannot return her location to her son. The "one great experience" is the 20-second call where the machine asks and then believes her. |
| **ASUS — "Build What's Next with ASUS"** (hardware first-come; top 3) | **Conditional — only if we borrow the box** | An ASUS mini-PC is a natural **on-premises inference appliance** for the local VLM. Honest submission if it genuinely runs the pipeline. | The ASUS box is what makes the privacy claim *true*: video never leaves the building because the compute is in the building. Show bytes-of-video-leaving = 0. **If we don't borrow it, don't submit** — logo-stuffing is visible and costs credibility elsewhere. |
| **Dimensional — "Best Use of dimOS"** (agentic robotics; Unitree Go 2 per team) | **Weak — skip** | The challenge wants *"an agentic robotics application… perception, reasoning, and real-world action through reusable modules, skills, and blueprints."* We have perception and reasoning and no robot. Shoehorning the escalation ladder into "skills and blueprints" would be a stretch that judges who work on robotics will see through instantly. | Skip. The time is better spent on the Espressif and Arduino submissions, which are true. |
| **Regeneron — clinical trials & biostatistics** | **No fit — skip** | The challenge is explicitly about bottlenecks in clinical-trial planning, conduct, analysis and submission. Nothing in this project touches that pipeline. | Skip. Do not attempt a "we could generate trial cohorts" framing; it is transparently retrofitted. |

**Submission order under time pressure:** Deepgram → Arduino → Healthcare track → Long Lake → Espressif → Meta → (ASUS only if the box is on the table).

---

## 12. Honest risk list

### 12.1 The category is crowded — at hackathons most of all

"Eldercare / dementia companion" is a **rising and well-trodden** hackathon category in 2025–26. Specific prior art, so nobody is surprised on stage:

| Project | What it did | Link |
|---|---|---|
| **Bloom** | Voice-first senior caretaker with dementia speech monitoring; won Anthropic Human Flourishing 1st + Decagon at TreeHacks 2026 | [devpost](https://devpost.com/software/bloom-dvjpea) |
| **Elda AI** | Eldercare assistant, Cal Hacks 12.0 | [devpost](https://devpost.com/software/elda-ai) |
| **Recall** | Dementia memory camera (Whisper + Grok + ElevenLabs); Best Use of Grok, HackPrinceton F25 | [devpost](https://devpost.com/software/recall-cf0dp9) |
| **Mira** | 3D scene reconstruction to help elders find lost objects, TreeHacks 2026 | [devpost](https://devpost.com/software/mira-w65b0a) |
| **VoiceCare** | AI companion for the elderly | [devpost](https://devpost.com/software/voicecare-ai-companion-for-elderly) |

**Every one of those is a *companion*.** They talk to the older person to keep them company, remind them, or remember for them. **This is not a companion and must never be pitched as one.** The differentiator on stage, in one sentence: *"we don't talk to her for company — we call her exactly once, when something has happened, and the only thing the AI decides is whether to wake her son."* The demo reinforces it by being **transactional and short**: the call in §10 lasts 25 seconds and then ends. A judge who has seen four warm chatty grandma-bots that day will remember the one that hung up.

### 12.2 Everything else

| Risk | Severity | Honest assessment | Mitigation |
|---|---|---|---|
| **BLE localization is flaky in a crowded venue** | **High** | An expo hall is thousands of phones, dozens of hotspots and moving bodies — the worst possible RF environment, and RSSI-based room classification is 1–3 m at best in a quiet room. It **will** misclassify on stage. | The facility beacon trace is a **labelled `REPLAY`** of a clean capture (§10.1). The one live beacon does a **binary zone event**, not a position estimate. And say the accuracy out loud — *"this is room-level, about a metre or three, and that's all we ever claim"* — because a judge who catches you overclaiming precision discounts everything else you said. |
| **Room-level accuracy is genuinely imperfect in production too** | Medium | 90% coarse-zone accuracy means one in ten samples is wrong. Deviation statistics built on noisy room labels can manufacture a "2 unusual nights" alert out of RF drift. | Never publish a deviation when confident-coverage is under 85% for that night (§9). Require **two consecutive** anomalous nights. Fuse with the IMU — a bathroom transition with no walking signature is discarded. In B2B, the hallway camera arbitrates. |
| **The demo reads as surveillance, not care** | **High — the reputational risk** | A demo that opens on a floor plan with a dot moving through a bathroom is a product nobody funds and a story that writes itself badly. Location is, on its face, the creepiest thing here. | **Verbatim stage framing:** *"Here's what her son sees. No map. No dot. No floor plan. There is no screen in this product that shows you where your mother is, and no setting that adds one. The location exists so paramedics know which room, and so we can tell him one sentence if her nights change. That's it."* Show the **absence** of the map as a feature, early, before anyone asks. **Never render a floor plan on stage**, not even to explain the tech. |
| **Two products, 24 hours** | **High** | The most common way this build fails is shipping two convincing halves of two things. | **B2C is the demo; B2B is a slide plus one replayed beacon trace and one camera clip.** Cut the staff dashboard to a single screen. If at hour 18 the B2B half is not working, cut it entirely and pitch one product well. |
| **Band false positives** | High | 24 hours of tuning vs Apple's five years. Sitting down hard, a dropped band, and a car door all look like falls. | The 30-second cancel window and the voice call are *themselves* the mitigation — this is the one risk the product's own design absorbs. Say that: *"our detector is worse than Apple's, and it matters less, because being wrong costs a phone call."* |
| **Twilio A2P / number provisioning stalls** | High | A known hackathon killer; verification can take hours or days. | Buy the number and place a test call in **hour 1**, not hour 20. Pre-recorded call audio ready by hour 18. |
| **Judges challenge liability** — "what if it says she's fine and she isn't?" | Medium | A fair question with no perfect answer. | Answer honestly and in advance: uncertainty escalates, ambiguity escalates, silence escalates, **and the agent never de-escalates a call it could not complete.** The only path to "no escalation" is an affirmative, coherent answer from the resident. |
| **Consent theatre** | Medium | It is easy to write beautiful consent copy and build a product that ignores it. | The family-scoped API returning no room identifiers (§8.1) is the test. If that is true in the code, the copy is true. If it isn't, delete §8 and the pitch. |
| **The 24h build can't learn a baseline** | Medium | "Per-resident baseline" needs weeks of data; we have hours. | Seed a synthetic 30-night history per demo resident, generated from a plausible distribution, and **say on stage that the history is seeded.** Judges forgive seeded data; they do not forgive a claimed model that is an `if` statement. |
| **Market size is decent, not huge** | Low (but be ready) | 1% of US assisted-living beds at $16/mo is ~$2.7M ARR. | Don't pretend otherwise. The honest expansion story is the ~16.2M US adults 65+ living alone on the B2C side and the insurance-rebate motion on the B2B side (§7.2). |

---

## 13. Post-hackathon roadmap

| Horizon | Goal | Concretely |
|---|---|---|
| **30 days** | **Prove the number, not the product.** | Ten households — team members' own grandparents and two recruited through a local senior centre — running the band and beacons for four weeks. One thing measured above all: **band wear-time**. If it isn't above 60% by week three, the hardware design is wrong and no amount of software fixes it. In parallel: replace the UNO Q with an off-the-shelf nRF52 dev band for wearability, get one LOI from a single-site assisted living operator, and have a lawyer review the all-party consent flow before a single real call is recorded. |
| **90 days** | **One paying facility, and an honest false-alarm number.** | A 60–100 bed community, full beacon install, bands on consenting residents, cameras in hallways only. Publish internally: false-alarm rate per resident-week, pages per nurse per shift, time-to-discovery vs their historical baseline. **Ship the resident-facing privacy switch in hardware**, because in a facility it's the difference between a purchase and a grievance. Build the consent register properly (three grants, annual re-confirmation, revocation audit trail). Sign a BAA. Begin a retrospective chart review on the time-to-discovery delta — that's the artefact an insurance underwriter will actually read. |
| **365 days** | **A number an actuary will price.** | 500–1,000 beds across 5–10 communities under one or two multi-site operators. The deliverable is not features, it is a **defensible statistic**: time-to-discovery and elopement time-to-intercept, before vs after, over enough resident-days to be credible. Take it to a long-term-care general-liability carrier and negotiate a premium credit; if that lands, B2B inverts from a cost sale to a savings sale. B2C ships on the same platform, sold **through the facility's family base** rather than paid acquisition — the only way a $29 ARPU survives eldercare CAC. **And decide, on data rather than ambition, whether this is a B2B sensing platform with a consumer app or a consumer brand that sells to facilities. Trying to be both at month 18 is how it dies.** |

---

*Companion documents: **`HARDWARE_SPEC.md`** (Arduino UNO Q band, Modulino IMU, BLE beacon mesh, power, enclosure) · **`TECHNICAL_PRD.md`** (Deepgram Voice Agent, Twilio telephony, local VLM pipeline, room-classification algorithm, RAG event store, React Native app).*
