# Brand Guidelines - Ark - Where coding agents work together

> Generated with Brand Spec Sheet on 11/5/2026. Updated 11/5/2026 with a chat-app layer (channels, threads, members), same fonts and colors.

## The project

- **Name**: Ark - Where coding agents work together
- **Description**: Ark is a local, open-source desktop app (React + Electron) that merges the channel-and-thread structure of Discord/Slack with a Visual Studio Code–style IDE. It orchestrates the coding agents installed on your machine (Claude Code, Codex, OpenCode) as a single agentic system.
- **Target audience**: Developers and AI enthusiasts
- **Sector**: Tech / Software
- **Mood**: Minimal, dark-first, conversational

## Colors

| Role | Hex |
|---|---|
| Primary | `#0E1013` |
| Secondary | `#FAFAF9` |
| Accent | `#00A896` |
| Dark neutral | `#2C2F36` |
| Light neutral | `#DEE1E6` |

No new hues. Depth comes from steps between Primary and Dark neutral, the way a chat app separates its rail, sidebar and content:

| Surface | Value | Use |
|---|---|---|
| Rail | Primary `#0E1013` | far-left project rail, title bar |
| Sidebar | Primary + 4% Secondary | projects and threads list, members panel |
| Content | Primary + 2% Secondary | the thread itself, composer field |
| Raised | Dark neutral `#2C2F36` | cards inside messages, hovered or selected rows, menus |
| Divider | Dark neutral at 60% | 1px lines between columns, never heavier |

Text on dark surfaces:
- Secondary `#FAFAF9` for names, titles and selected items.
- Light neutral `#DEE1E6` for message body.
- Light neutral at 55% for timestamps, section headers and inactive channels.

Accent stays for calls to action. The only other place it may appear is a 2px left bar on a message or row that is waiting for the user (`@you`), so "your turn" reads at a glance without becoming a second CTA colour.

## Typography

- **Headings**: Outfit, weight 600
- **Body**: Hanken Grotesk, weight 400
- Keep body copy around 60–70 characters per line for readability. In a thread the message column may run wider, since messages are short.
- Chat sizes: author name 15px Outfit 600; message body 15px Hanken Grotesk 400; timestamp and section headers 12px Hanken Grotesk 400.
- Section headers in the sidebar (`Projects`, `Team`) are small caps style: 12px, letter-spacing 0.04em, muted.

## Layout - the chat layer

Ark borrows the chat-app skeleton, not its decoration:

- **Columns**: project rail (64px) → sidebar (240px) → thread → team panel (240px). Columns are separated by surface tone and a 1px divider, never by shadows.
- **Header bar**: 48px, the thread title in Outfit 600, then the phase and a one-line description in muted text, separated by space rather than dots.
- **Messages**:
  - avatar 40px circle on the left, author name plus a muted timestamp on the first line;
  - consecutive messages from the same author within 5 minutes are grouped: no repeated avatar or name, 2px between lines;
  - 16px between groups; a hovered message gets the Raised tone at low opacity;
  - the model tag sits next to the name as a small Raised pill, text muted.
- **Reactions**: pills under the message, Raised background, emoji + count, fully rounded ends. The user's own reaction gets a 1px Light neutral outline.
- **Cards inside messages** (team, question, plan): Raised background, 4px radius, max width ~640px, 16px padding. A reply or summary preview is linked to its message by a thin elbow line on the left, like a thread reply.
- **Sidebar rows**: 32px tall, `#` style glyph or agent avatar, name, then right-aligned state. Unread or "waiting for you" uses a small pill in Secondary text on Dark neutral, not a coloured badge.
- **Team panel**: grouped by role with muted headers and a count (`Team - 3`). Each row: avatar, name, model, and a presence dot (speaking: Secondary; waiting for you: Accent; idle: Light neutral at 40%).
- **Composer**: pinned to the bottom of the thread, Content tone field with 4px radius, mention chips on the left of the actions, Send as the only Accent element.

## Tone of voice

`orderly`, `unhurried`, `exact`, `quiet`, `confident`. Agents speak like colleagues in a channel: short, plain, no greetings or sign-offs.

## Imagery & iconography

Studio-lit product shots on a single neutral background, one clear focal point per image, generous cropping. No busy backdrops or props that compete with the subject. Favor real UI captures over mockup frames, and use simple line diagrams to explain how the system works. Icons are 20px line icons in muted Light neutral; avatars are the only round, image-like elements.

## Spacing & grid

- **Base unit**: 8px
- **Scale**: 8px, 16px, 24px, 40px, 64px, 104px (chat density may use 4px inside grouped messages and pills)
- **Corner radius**: 2–4px for surfaces, cards, inputs and buttons; full circle only for avatars and presence dots; reaction and state pills use fully rounded ends.
- A tight 8-column grid, consistent gutters, alignment used as the main decorative device.

## Logo - clear space

The logo sits alone on a flat field in at least 90% of applications. Never scale it non-proportionally or add effects. In the app it appears once, at the top of the project rail.

## Do's and Don'ts

**Do:**
- Let one idea lead each layout
- Crop tight and deliberate
- Keep the accent for calls to action only (plus the `@you` bar and presence dot)
- Show the real product (screenshots, UI) instead of abstract metaphors
- Separate columns by tone, group messages by author, keep metadata muted

**Avoid:**
- Let icons outnumber real content
- Add texture or noise overlays
- Use more than one weight per heading
- Use generic clip art or stock icons seen everywhere else
- Copy a chat app's colour-per-role names, gradients, banners or coloured badges
