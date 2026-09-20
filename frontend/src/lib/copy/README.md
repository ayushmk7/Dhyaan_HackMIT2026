# Copy lives here, not in screens

Every user-facing string in the app is defined in this folder and imported by
the screen that renders it. A string literal inside a component is a bug: it
cannot be reviewed as writing, it cannot be translated, and it is where the
app's voice quietly drifts from screen to screen.

One file per area, so two people editing different screens do not edit the same
file. Screens import their own area directly (`@/lib/copy/family`), not through
a barrel — a barrel would make every screen depend on every other area's copy.

What belongs here: anything a person reads. Labels, headings, button text,
empty states, error messages, accessibility labels, the words inside a
confirmation.

What does NOT belong here: values that come from the server (her name, a
sentence Dhyaan wrote, a room label), machine telemetry keys rendered through
`DataLabel` (`FPS`, `MODEL`), and format strings better expressed as functions.
Copy that interpolates takes a function: `noPhoneFor(name)`, not a template the
screen fills in by hand.
