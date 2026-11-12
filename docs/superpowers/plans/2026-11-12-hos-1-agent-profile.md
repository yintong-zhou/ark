# Agent Profile Implementation Plan (Head of Staff, part 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every agent a profile image, an alias, a role, a typed username, a model picked from the engines on this PC and a model lock.

**Architecture:** The agent file gains four optional header fields, so old files keep loading. Faces are bundled vector art picked by id; an uploaded image is a file in Ark's data folder that only main reads and writes, handed to the renderer as base64. The form is rebuilt from two reusable field components that part 2 uses again for the Head of Staff.

**Tech Stack:** Electron main (Node 22), React 19 + Tailwind renderer, TypeScript, vitest, `yaml`.

**Spec:** `docs/superpowers/specs/2026-11-12-head-of-staff-design.md`, section 1. Parts 2 to 4 have their own plans (`2026-11-12-hos-2-head-of-staff.md`, `-3-ready-teams.md`, `-4-skill-import.md`) and are built in that order.

## Global Constraints

- UI text is English. Use a hyphen (-) in place of an em dash, in code, copy and commit messages.
- Colours only from `brand-guidelines.md`: `#0E1013`, `#FAFAF9`, `#00A896`, `#2C2F36`, `#DEE1E6`. Faces never use the accent `#00A896`.
- The renderer never sends an absolute path to be read. Main opens every file dialog and validates every IPC payload.
- Ark writes only under `%APPDATA%\ark`; nothing under `~/.claude` or `~/.codex`.
- An agent file stays Markdown with a YAML header that existing files, and imported Claude Code agent files, still parse into.
- `head-of-staff` is a reserved username.
- The username follows `AGENT_ID_RE` (`^[a-z0-9_-]{1,64}$`), is unique, and cannot change after creation.
- Do not run `npm run test:live` (it spends the user's tokens).
- Every task ends green on `npm run typecheck`, `npm run lint` and `npm test`.

## Review Focus

1. A file that is not an image but is named `.png` is picked in "Upload from PC": it is refused with a clear message, nothing is written. (Task 3)
2. An agent file written before this change is opened in the form and saved without touching anything: its engine setting, tier, skills and prompt are unchanged. (Tasks 1 and 6)
3. A catalog with more than 24 agents: faces repeat, nothing throws, the least used face is reused. (Task 2)
4. A username with capitals or spaces, or one already taken, or `head-of-staff`: Save stays disabled with the reason shown; no existing agent is overwritten. (Tasks 1 and 6)
5. An uploaded image deleted by hand from Ark's data folder: the agent shows its initials, no broken image. (Tasks 3 and 4)

---

### Task 1: Profile fields in the agent file

**Files:**
- Modify: `src/shared/agent-file.ts`
- Test: `tests/shared/agent-file.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AgentDef = { /* existing fields */ alias?: string; role?: string; avatar?: string; lock?: boolean };
  export const RESERVED_IDS: readonly string[]; // ['head-of-staff']
  export const AVATAR_RE: RegExp;               // /^(face-(0[1-9]|1\d|2[0-4])|custom)$/
  export function isLocked(a: Pick<AgentDef, 'engine' | 'lock'>): boolean;
  export function engineString(e: EngineSetting): string; // already exists, now exported
  ```

- [ ] **Step 1: Write the failing tests** (append to `tests/shared/agent-file.test.ts`)

```ts
const base: AgentDef = { id: 'backend_dev', name: 'Forge - Backend dev', description: 'd', engine: { kind: 'model', engine: 'claude', model: 'sonnet' }, tier: 'standard', skills: [], permissions: 'build', prompt: 'p' };

test('the profile fields round-trip through the file', () => {
  const a = { ...base, alias: 'Forge', role: 'Backend dev', avatar: 'face-03', lock: false };
  expect(parseAgentFile(serializeAgentFile(a), a.id)).toEqual({ ok: true, agent: a });
});

test('a file without the profile fields loads unchanged and an exact model counts as locked', () => {
  const r = parseAgentFile(serializeAgentFile(base), base.id);
  expect(r).toEqual({ ok: true, agent: base });
  expect(serializeAgentFile(base)).not.toMatch(/alias|role|avatar|lock/);
  expect(isLocked(base)).toBe(true);
  expect(isLocked({ ...base, lock: false })).toBe(false);
  expect(isLocked({ engine: { kind: 'auto' }, lock: true })).toBe(false); // nothing to lock
});

test.each([
  [{ avatar: 'face-25' }, 'avatar: must be a gallery face or custom'],
  [{ avatar: '../x' }, 'avatar: must be a gallery face or custom'],
  [{ alias: 'x'.repeat(41) }, 'alias: must be text of at most 40 characters'],
  [{ role: 'x'.repeat(61) }, 'role: must be text of at most 60 characters'],
  [{ lock: 'yes' }, 'lock: must be true or false'],
])('rejects %j', (extra, error) => {
  expect(validateAgent({ ...base, ...extra })).toEqual({ ok: false, error });
});

test('head-of-staff is a reserved username', () => {
  const error = 'username: head-of-staff is reserved';
  expect(parseAgentFile(serializeAgentFile(base), 'head-of-staff')).toEqual({ ok: false, error });
  expect(validateAgent({ ...base, id: 'head-of-staff' })).toEqual({ ok: false, error });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/shared/agent-file.test.ts`
Expected: FAIL (`isLocked` is not exported; unknown fields are dropped).

- [ ] **Step 3: Implement in `src/shared/agent-file.ts`**

`parseAgentFile` reads the four optional header keys with the limits and error texts in the tests, and fails first when `id` is in `RESERVED_IDS`. `serializeAgentFile` writes each key only when it is set. `validateAgent` passes them through its serialize-then-parse round trip. `isLocked` is `a.engine.kind === 'model' && a.lock !== false`.

- [ ] **Step 4: Run the file's tests, then the whole suite**

Run: `npx vitest run tests/shared/agent-file.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-file.ts tests/shared/agent-file.test.ts
git commit -m "feat: profile fields in the agent file"
```

---

### Task 2: Gallery faces and the default face

**Files:**
- Create: `src/shared/avatars.ts`
- Modify: `src/main/services/catalog.ts` (`list`)
- Test: `tests/shared/avatars.test.ts`, `tests/main/catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FACES: readonly string[]; // 'face-01' ... 'face-24'
  export const HEAD_FACE = 'face-head';  // the Head of Staff's, never in FACES
  /** The first face nobody uses; when all are used, the least used one (the earliest on a tie). */
  export function nextFace(used: readonly (string | undefined)[]): string;
  /** Agents without an avatar get one, in id order; the input order is kept and nothing is mutated. */
  export function assignFaces<T extends { id: string; avatar?: string }>(agents: T[]): T[];
  ```
- `Catalog.list()` returns `assignFaces(agents)`. The file on disk is not rewritten; the face is persisted the next time the agent is saved from the form.

- [ ] **Step 1: Write the failing tests**

`tests/shared/avatars.test.ts`:

```ts
import { expect, test } from 'vitest';
import { assignFaces, FACES, HEAD_FACE, nextFace } from '@shared/avatars';

test('there are 24 gallery faces and the head face is not one of them', () => {
  expect(FACES).toHaveLength(24);
  expect(FACES[0]).toBe('face-01');
  expect(FACES[23]).toBe('face-24');
  expect(FACES).not.toContain(HEAD_FACE);
});

test('nextFace is the first unused face', () => {
  expect(nextFace([])).toBe('face-01');
  expect(nextFace(['face-01', 'custom', undefined, 'face-03'])).toBe('face-02');
});

test('when every face is taken the least used one is reused', () => {
  expect(nextFace([...FACES, 'face-01'])).toBe('face-02');
});

test('assignFaces fills the gaps in id order and keeps what is set', () => {
  const out = assignFaces([{ id: 'zed' }, { id: 'amy', avatar: 'face-01' }, { id: 'bob' }]);
  expect(out).toEqual([{ id: 'zed', avatar: 'face-03' }, { id: 'amy', avatar: 'face-01' }, { id: 'bob', avatar: 'face-02' }]);
});

test('30 agents all get a face', () => {
  const out = assignFaces(Array.from({ length: 30 }, (_, i) => ({ id: `a${String(i).padStart(2, '0')}` })));
  expect(out.every((a) => FACES.includes(a.avatar!))).toBe(true);
  expect(new Set(out.slice(0, 24).map((a) => a.avatar)).size).toBe(24);
});
```

`tests/main/catalog.test.ts` (use the file's existing temp-dir setup):

```ts
test('list gives every agent a face without rewriting its file', () => {
  catalog.save({ ...agent, id: 'one' });
  catalog.save({ ...agent, id: 'two' });
  const before = readFileSync(join(dir, 'one.md'), 'utf8');
  expect(catalog.list().agents.map((a) => a.avatar).sort()).toEqual(['face-01', 'face-02']);
  expect(readFileSync(join(dir, 'one.md'), 'utf8')).toBe(before);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/shared/avatars.test.ts tests/main/catalog.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/shared/avatars.ts` and call `assignFaces` in `Catalog.list()`**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/shared/avatars.test.ts tests/main/catalog.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/avatars.ts src/main/services/catalog.ts tests/shared/avatars.test.ts tests/main/catalog.test.ts
git commit -m "feat: gallery faces and a default face per agent"
```

---

### Task 3: Uploaded images, kept and checked by main

**Files:**
- Create: `src/main/services/avatars.ts`
- Modify: `src/main/ipc/index.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts` (`ArkApi.catalog`)
- Test: `tests/main/avatars.test.ts`

**Interfaces:**
- Consumes: `ImageInput = { mime: string; data: string }` (base64) from `@shared/attachments`; `AGENT_ID_RE`.
- Produces:
  ```ts
  export const IMAGE_MAX = 512 * 1024; // bytes
  /** Throws 'Use a PNG, JPEG or WebP image' or 'The image is larger than 512 KB'. The first bytes must match the mime. */
  export function checkImage(v: unknown): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Buffer };
  /** The ImageInput of a file's bytes, by its magic bytes; throws like checkImage. */
  export function imageOf(bytes: Buffer): ImageInput;
  export class Avatars {
    constructor(dir: string);           // %APPDATA%\ark\avatars
    read(id: string): ImageInput | null; // null when there is none or it cannot be read
    write(id: string, image: unknown): void; // checkImage, then <dir>/<id>.<png|jpg|webp>, replacing any other extension
    remove(id: string): void;
  }
  ```
  An id that fails `AGENT_ID_RE` throws `Unsafe agent id` in all three methods.
- `ArkApi.catalog` becomes:
  ```ts
  save(a: AgentDef, image?: ImageInput | null): Promise<void>; // undefined keeps the image, null removes it
  pickImage(): Promise<ImageInput | null>;                    // main opens the dialog; null when cancelled
  image(id: string): Promise<ImageInput | null>;
  ```
- IPC channels: `catalog:pick-image`, `catalog:image`; `catalog:save` takes the second argument; `catalog:remove` also calls `avatars.remove`.

- [ ] **Step 1: Write the failing tests** (`tests/main/avatars.test.ts`)

```ts
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { Avatars, checkImage, IMAGE_MAX, imageOf } from '../../src/main/services/avatars';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = Buffer.from('GIF89a..');
const input = (mime: string, b: Buffer) => ({ mime, data: b.toString('base64') });

let dir: string;
let avatars: Avatars;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ark-avatars-'));
  avatars = new Avatars(dir);
  return () => rmSync(dir, { recursive: true, force: true });
});

test('an image round-trips and a new one replaces the old extension', () => {
  avatars.write('forge', input('image/png', PNG));
  expect(avatars.read('forge')).toEqual(input('image/png', PNG));
  avatars.write('forge', input('image/jpeg', JPEG));
  expect(readdirSync(dir)).toEqual(['forge.jpg']);
  avatars.remove('forge');
  expect(avatars.read('forge')).toBeNull();
});

test('refuses what is not a small PNG, JPEG or WebP', () => {
  expect(() => checkImage(input('image/png', GIF))).toThrow('Use a PNG, JPEG or WebP image');
  expect(() => checkImage(input('image/gif', GIF))).toThrow('Use a PNG, JPEG or WebP image');
  expect(() => checkImage({ mime: 'image/png' })).toThrow('Use a PNG, JPEG or WebP image');
  expect(() => checkImage(input('image/png', Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX)])))).toThrow('The image is larger than 512 KB');
  expect(() => imageOf(GIF)).toThrow('Use a PNG, JPEG or WebP image');
  expect(imageOf(PNG).mime).toBe('image/png');
});

test('a refused image writes nothing, and an unsafe id never reaches the disk', () => {
  expect(() => avatars.write('forge', input('image/png', GIF))).toThrow();
  expect(readdirSync(dir)).toEqual([]);
  expect(() => avatars.write('../x', input('image/png', PNG))).toThrow('Unsafe agent id');
  expect(() => avatars.read('../x')).toThrow('Unsafe agent id');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/avatars.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/main/services/avatars.ts`**

Magic bytes: PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; WebP `RIFF` at 0 and `WEBP` at 8. Write with `writeAtomic` from `./files`.

- [ ] **Step 4: Wire IPC, preload and types**

In `registerIpc` add `avatars: Avatars` to `Deps` (created in `src/main/index.ts` as `new Avatars(join(userData, 'avatars'))`).

- `catalog:pick-image`: `dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })`; when a file is chosen, refuse one whose size is over `IMAGE_MAX` before reading it, then return `imageOf(bytes)`.
- `catalog:image`: `avatars.read(agentId(id))`.
- `catalog:save (a, image)`: after `validateAgent`, when `image` is an object call `avatars.write`, when it is `null` call `avatars.remove`. Then, if the agent's `avatar` is `'custom'` and `avatars.read(id)` is null, throw `Choose an image first`; if it is not `'custom'`, call `avatars.remove(id)`. The agent file is saved last.
- `catalog:remove`: remove the agent, then its image.

- [ ] **Step 5: Run the checks**

Run: `npx vitest run tests/main/avatars.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/avatars.ts src/main/ipc/index.ts src/main/index.ts src/preload/index.ts src/shared/types.ts tests/main/avatars.test.ts
git commit -m "feat: uploaded agent images kept and checked by main"
```

---

### Task 4: The faces and the agent avatar

**Files:**
- Create: `src/renderer/components/faces.tsx`
- Modify: `src/renderer/components/Avatar.tsx`
- Modify (call sites): `src/renderer/pages/Agents.tsx`, `src/renderer/pages/Chat.tsx`, `src/renderer/components/Cards.tsx`, `Composer.tsx`, `TeamPanel.tsx`, `Sidebars.tsx`, `ThreadView.tsx`
- Test: `tests/renderer/faces.test.ts`

**Interfaces:**
- Consumes: `FACES`, `HEAD_FACE` (Task 2); `window.ark.catalog.image` (Task 3).
- Produces:
  ```tsx
  /** The inside of a 40x40 SVG for each face id: all of FACES plus HEAD_FACE. */
  export const FACE: Record<string, ReactNode>;
  /** An agent's picture: its uploaded image, else its face, else the initials of `name`. */
  export function AgentAvatar(p: { agent?: Pick<AgentDef, 'id' | 'avatar'>; name: string; size?: 24 | 32 | 40; inset?: boolean; title?: string }): JSX.Element;
  /** Drops the cached image of an agent, after it was saved or removed. */
  export function forgetImage(id: string): void;
  ```
  `Avatar` and `initials` stay as they are for the user ("You"), the engine tags in `Logos.tsx` and the project rail.

- [ ] **Step 1: Write the failing test** (`tests/renderer/faces.test.ts`)

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { FACES, HEAD_FACE } from '@shared/avatars';
import { FACE } from '../../src/renderer/components/faces';

const svg = (id: string) => renderToStaticMarkup(createElement('svg', { viewBox: '0 0 40 40' }, FACE[id]));

test('every face id has a drawing and no two drawings are the same', () => {
  const ids = [...FACES, HEAD_FACE];
  expect(Object.keys(FACE).sort()).toEqual([...ids].sort());
  expect(new Set(ids.map(svg)).size).toBe(ids.length);
});

test('faces use only the brand neutrals, never the accent', () => {
  const allowed = new Set(['#0e1013', '#fafaf9', '#2c2f36', '#dee1e6']);
  for (const id of Object.keys(FACE)) {
    for (const hex of svg(id).match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(allowed, `${id} uses ${hex}`).toContain(hex.toLowerCase());
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/renderer/faces.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Draw the faces in `src/renderer/components/faces.tsx`**

25 simple character faces as SVG shapes inside a 40x40 box, to sit on a round `#2C2F36` (or Primary when `inset`) background that `AgentAvatar` draws. Style A of the approved mockup: a light head (`#DEE1E6`), dark features (`#0E1013`), small highlights (`#FAFAF9`). Each face must differ from the others in silhouette or in a feature a person notices at 24px (antenna, visor, hair cap, ears, single eye, glasses, and so on). The six faces in `.superpowers/brainstorm/311-1794475635/content/agent-avatars-form.html` (first card, not committed) set the level of detail and can be used as `face-01` to `face-06`; if that file is gone, draw them fresh. `face-head` is the Head of Staff's: make it the most distinct of the set.

- [ ] **Step 4: Add `AgentAvatar` and `forgetImage` to `Avatar.tsx`**

`AgentAvatar` keeps the sizes and the round shape of `Avatar`. For `avatar === 'custom'` it loads `window.ark.catalog.image(id)` once per id through a module-level cache of promises, shows the initials until it resolves, and the initials for good when it resolves to null. The image is an `<img>` with a `data:` URL (the content security policy already allows `img-src data:`), `alt=""`, object-fit cover.

- [ ] **Step 5: Use `AgentAvatar` wherever an agent is shown**

Replace `<Avatar text={initials(name)} .../>` with `<AgentAvatar agent={...} name={name} .../>` in the seven call sites listed above, looking the agent up by id in the `agents` list each of them already receives (an id that is no longer in the catalog passes `agent={undefined}`). Leave the "You" avatars alone.

- [ ] **Step 6: Run the checks**

Run: `npx vitest run tests/renderer/faces.test.ts && npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer tests/renderer/faces.test.ts
git commit -m "feat: agent faces in place of initials"
```

---

### Task 5: The Codex models found on this PC

**Files:**
- Modify: `src/main/services/engines/models.ts`, `src/main/ipc/index.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts` (`ArkApi.engines`)
- Test: `tests/main/models.test.ts`

**Interfaces:**
- Consumes: `codexModels(exe, env)` from `engines/codex-session.ts`; `engineStatus`, `readEngines`.
- Produces:
  ```ts
  /** The ids the user can pick: not hidden, the default model first, the rest in Codex's order. */
  export function visibleModels(models: CodexModel[]): string[];
  // ArkApi.engines
  codexModels(): Promise<string[]>; // [] when Codex is not installed or does not answer
  ```
- IPC channel `engines:codex-models`; `Deps` gains `codexModels: () => Promise<string[]>`, built in `src/main/index.ts` from the installed Codex path and `cleanEnv(process.env)`, catching every error into `[]`.

- [ ] **Step 1: Write the failing test** (append to `tests/main/models.test.ts`)

```ts
test('visibleModels drops hidden models and puts the default first', () => {
  const models = [
    { id: 'gpt-x-luna', hidden: false, isDefault: false },
    { id: 'gpt-internal', hidden: true, isDefault: false },
    { id: 'gpt-x', hidden: false, isDefault: true },
  ];
  expect(visibleModels(models)).toEqual(['gpt-x', 'gpt-x-luna']);
  expect(visibleModels([])).toEqual([]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/main/models.test.ts`
Expected: FAIL (`visibleModels` is not exported).

- [ ] **Step 3: Implement `visibleModels`, the IPC channel, the preload method and the type**

- [ ] **Step 4: Run the checks**

Run: `npx vitest run tests/main/models.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload src/shared/types.ts tests/main/models.test.ts
git commit -m "feat: list the Codex models found on this PC"
```

---

### Task 6: The agent form

**Files:**
- Create: `src/renderer/components/AgentFields.tsx`
- Modify: `src/renderer/pages/AgentForm.tsx`, `src/renderer/hooks/useCatalog.ts`, `src/shared/agent-file.ts`, `src/shared/agent-draft.ts`, `README.md` (the paragraph on creating an agent)
- Test: `tests/shared/agent-file.test.ts`, `tests/shared/agent-draft.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces:
  ```ts
  // src/shared/agent-file.ts
  /** What the Model list offers: Auto, then the models of each installed engine. A current setting that is not among them is appended, so saving an untouched agent changes nothing. */
  export function modelOptions(installed: Record<EngineId, boolean>, codex: string[], current: EngineSetting): { value: string; label: string }[];
  ```
  `value` is `engineString` of the setting; `label` is `formatEngineSetting`.
  ```tsx
  // src/renderer/components/AgentFields.tsx
  export function ModelField(p: { engine: EngineSetting; lock: boolean; installed: Record<EngineId, boolean>; codex: string[]; onChange: (engine: EngineSetting, lock: boolean) => void }): JSX.Element;
  export function SkillsField(p: { skills: SkillInfo[]; picked: string[]; onChange: (picked: string[]) => void; children?: ReactNode }): JSX.Element;
  ```
  `SkillsField` is today's filter-and-checkbox list moved out of `AgentForm`; `children` is a slot for part 4's Import button.
  `useCatalog()` also returns `codex: string[]` (from `window.ark.engines.codexModels()`).

- [ ] **Step 1: Write the failing tests**

`tests/shared/agent-file.test.ts`:

```ts
test('modelOptions lists only the engines found on this PC', () => {
  const values = (o: { value: string }[]) => o.map((x) => x.value);
  expect(values(modelOptions({ claude: true, codex: true }, ['gpt-x', 'gpt-x-luna'], { kind: 'auto' })))
    .toEqual(['auto', 'claude:haiku', 'claude:sonnet', 'claude:opus', 'codex:gpt-x', 'codex:gpt-x-luna']);
  expect(values(modelOptions({ claude: true, codex: false }, [], { kind: 'auto' }))).toEqual(['auto', 'claude:haiku', 'claude:sonnet', 'claude:opus']);
});

test('modelOptions keeps a setting it would not offer', () => {
  const legacy = modelOptions({ claude: true, codex: false }, [], { kind: 'engine', engine: 'codex' });
  expect(legacy.at(-1)).toEqual({ value: 'codex', label: 'Codex' });
  const gone = modelOptions({ claude: true, codex: true }, ['gpt-x'], { kind: 'model', engine: 'codex', model: 'gpt-old' });
  expect(gone.at(-1)).toEqual({ value: 'codex:gpt-old', label: 'Codex gpt-old' });
});
```

`tests/shared/agent-draft.test.ts`:

```ts
test('the drafter is asked for an alias and a role, and its file parses with them', () => {
  expect(DRAFTER_PROMPT).toContain('alias: <');
  expect(DRAFTER_PROMPT).toContain('role: <');
  const file = extractAgentFile('---\nname: Forge - Backend dev\nalias: Forge\nrole: Backend dev\ndescription: Writes the server code.\nengine: auto\ntier: heavy\nskills: []\npermissions: build\n---\nYou are Forge.');
  const r = parseAgentFile(file!, 'forge-backend-dev');
  expect(r.ok && [r.agent.alias, r.agent.role]).toEqual(['Forge', 'Backend dev']);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/shared/agent-file.test.ts tests/shared/agent-draft.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `modelOptions`, and add `alias` and `role` to `DRAFTER_PROMPT`**

The drafter's `name` line becomes `name: <alias> - <role>`.

- [ ] **Step 4: Build `AgentFields.tsx` and rebuild the form**

The form, top to bottom, with these exact labels and hints:

| Label | Control | Hint |
|---|---|---|
| Profile image | the current picture at 64px, **Choose from gallery** (a grid of the 24 faces, the chosen one outlined) and **Upload from PC** | Assigned automatically, different for every agent. |
| Alias | text, 40 max | The agent's own name. |
| Role | text, 60 max | Shown next to the alias: Forge - Backend dev. |
| Username | text with a leading `@`; read-only when editing | How you call it in a thread. Cannot change after creation. |
| Task | 2-row text (the `description` field) | One sentence. The Head of Staff reads it to decide who to involve. |
| Model | `ModelField`: a select of `modelOptions`, and under it a checkbox **Lock this model** shown only when a model (not Auto) is chosen | Unlocked: the Head of Staff may go up or down with the difficulty of the task. |
| Can change files | select: `No - advisor only` (`read-only`), `Yes - can write code in the thread worktree` (`build`) | |
| Skills | `SkillsField` | Skills installed on this PC. |
| System prompt | 10-row monospace text (the `prompt` field) | |

Rules:
- "Draft with AI" stays on top for a new agent and also fills alias and role.
- The saved `name` is `role.trim() ? `${alias.trim()} - ${role.trim()}` : alias.trim()`.
- A new agent: the username is prefilled with `agentId(role || alias)` until the user edits it, and becomes the agent's `id`. An existing agent opened for the first time after this change shows its whole `name` as the alias and an empty role.
- Problems shown next to Save, which they disable: `Username: lowercase letters, digits, - and _ (up to 64).`, `This username is taken.`, and whatever `validateAgent` returns.
- A new agent starts with `avatar: nextFace(catalog.agents.map((a) => a.avatar))`, `lock: false`, tier `standard`. An edited agent keeps its `tier`. The Tier select is gone.
- Picking a face sets `avatar` to its id and the pending image to `null`. Upload calls `window.ark.catalog.pickImage()`; a result sets `avatar: 'custom'` and is previewed; an error is shown under the field.
- Save calls `window.ark.catalog.save(agent, image)` with `image` undefined when the picture was not touched, then `forgetImage(agent.id)`.

- [ ] **Step 5: Run the checks**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Try it in the app**

Run: `npm run dev` (if it reports "Electron uninstall": `node node_modules/electron/install.js`). Check, and report what you saw:
1. New agent: a face is already shown and differs from the other agents'.
2. Alias `Forge`, role `Backend dev`: the username proposes `backend-dev`; change it to `backend_dev`; a capital letter disables Save with the username message.
3. Model lists only the engines shown as installed on the Agents page; the lock box appears for a model and not for Auto.
4. Upload a PNG under 512 KB: it shows in the form, in the Agents list and in a thread's team panel. Upload a `.txt` renamed `.png`: refused with `Use a PNG, JPEG or WebP image`.
5. Open an agent created before this change, press Save without touching anything: its file differs only by the added `alias` and `avatar` lines (and `lock: true` when it names an exact model).

- [ ] **Step 7: Commit**

```bash
git add src tests README.md
git commit -m "feat: agent form with image, alias, role, username and model lock"
```
