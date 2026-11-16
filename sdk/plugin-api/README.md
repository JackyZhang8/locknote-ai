# @locknote/plugin-api

TypeScript declarations for trusted Locknote AI plugins, API version 1.
This repository package is private and has not been published to npm.

```ts
import type { PluginContext } from '@locknote/plugin-api'

export default {
  activate(ctx: PluginContext) {
    ctx.commands.register({ id: 'hello', title: 'Hello', run: () => ctx.ui.notify('Hello') })
  },
}
```

To use in a separate project, install the local declaration package with
`npm install --save-dev /absolute/path/to/locknote-ai/sdk/plugin-api`.
Import it with `import type`; there is no runtime module. Bundle the plugin into
an ES module `main.js`, then package it with `go run ./tools/plugin-pack` from
the Locknote AI repository. See `docs/plugin-development.md` for the API contract,
lifecycle, capability declarations, packaging, and trust model.

Localization: declare defaultLocale/locales in manifest.json. Use ctx.i18n.locale and ctx.i18n.t(key, params?, fallback?) for DOM text. Set titleKey/textKey for automatically translated contributions; listen to language:change to refresh plugin-owned DOM. Secondary views may set showInNavigation: false.

## Host features and typed contracts

API v1 evolves additively. Check ctx.host?.hasFeature('storage.cas') instead of
assuming every v1 host has every service. Current feature names: notes.query,
notes.versionedWrites, notes.review.metadata, notes.review.deferred,
writes.commitReceipts, storage.cas, workspace.activeViews, events.typed,
ai.chat, ai.models, conversations.journal. Features do not grant permissions.

NoteQuery types q/scope/notebook/tag/sort/limit/offset/withBody query parameters.
Event names and payloads use PluginEventMap, extensible through TypeScript module
augmentation. Type checking catches misspelled event names and queries; existing
JavaScript plugin execution remains compatible.

## Configuration concurrency

Prefer snapshot()/compareAndSet(data, revision) for each settings form:

    const snapshot = await ctx.storage.snapshot()
    await ctx.storage.compareAndSet({ ...snapshot.data, maxLevel: 4 }, snapshot.revision)

Keep each revision with its original data. CONFIG_CONFLICT means reload and
reconcile; never retry stale whole-object data with a fresh revision. Existing
get()/set() remain: get remembers its revision, set conditions the write on it,
and successful set advances it. Set before any get first reads the current
revision. Independent forms should use explicit snapshots rather than sharing
the legacy implicit revision.

PluginAPIError is structural (this package has no runtime module). Inspect code
and status: CONFIG_CONFLICT, INSTALL_CONFLICT, CONVERSATION_CONFLICT, CONFLICT,
PLUGIN_STOPPED, CAPABILITY_DENIED, RATE_LIMITED, INVALID_ARGUMENT, FORBIDDEN,
NOT_FOUND and HTTP_ERROR. Plugin-owned errors need not carry these fields.

## Writes, review and views

A submitted successful note create/update/undo keeps its receipt even if the
plugin is disabled while awaiting the response. Disable blocks future writes;
it cannot roll back committed work. Post-save UI refresh failure does not turn
a successful write into an error. Transport failures with uncertain outcomes
must be reconciled with persisted notes before retrying.

Review preserves title, content, tags, notebook/notebookId and pinned. Notebook ID
wins when both selectors are supplied; only a name clears the inherited ID.
Metadata differences are shown before approval. Undo restores classification
and pin status, including the uncategorized/unpinned state.

Retaining a draft returns saved:false, deferred:true and changeId. End the tool
turn without claiming the note was saved. Retained drafts require explicit apply
or discard. openView activates an existing tab; closing selects another available
tab. Change-record events broadcast once per runtime publication.

## AI provider transport

### Versioned note review

`ctx.changes.review({ before, after, summary? }, { signal })` requires `notes.read` and `notes.write`. The host presents an independent editable draft and returns a receipt after apply/discard. Successful review already saves the edited candidate: do not write again. Omit `before` for a new note; updates require a full original note and version. `changes.list()` and `changes.open(id)` expose plugin-owned records. `changes.undo(id)` refuses to overwrite subsequent edits. Checkpoint snapshots are bounded local WebView data; restored drafts never apply automatically. Requires the updated host.

Model discovery: `ctx.ai.listModels({ baseURL, apiKey }, { signal })` returns sorted, deduplicated `{ models: string[] }` via the authenticated host `/models` proxy. Requires `ai.chat` and the updated host. Timeout: 30 seconds; response bound: 1 MiB.

Chat accepts optional `maxTokens` (1–32768), forwarded as `max_tokens`. Provider `usage` and cached token counts are retained when supplied. See `docs/ai-assistant-micro-agent.md` for bounded sessions and prefix caching.

Declare `ai.chat` and call `ctx.ai.chatCompletion({ baseURL, apiKey, model, messages, tools }, { signal })`. The desktop host adds `/chat/completions` to the base URL and forwards non-streaming OpenAI-compatible JSON. Requests are cancelled on plugin disable. See `examples/plugins/ai-assistant` for provider settings, paged note tools and confirmed versioned writes. This requires the host build containing the AI transport API.

### Conversation journals

New hosts expose ctx.conversations: list(offset?), create(title), read(id,before?), append(id,expectedSeq,events), activate(id), rename(id,title), and delete(id). Desktop authorization and enabled-plugin checks apply. IDs are scoped to the calling plugin, never filesystem paths. This API is available to trusted plugins without additional filesystem access.

Journals are UTF-8 JSONL under plugins/_data/<plugin-id>/conversations/. Event types are message, turn_start, tool, checkpoint, rename, and initial session; the host supplies v, seq, and at. Append up to 16 events per request (4 MiB total; 2 MiB per encoded record). Use returned seq for the next write; stale writes fail with 409. Do not retry ambiguous writes automatically: reopen first. Reads return a bounded recent event page, latest checkpoint and before cursor (0 means oldest reached); lists use next (-1 means complete). Keep API keys and authorization headers out of journal events.

The host repairs incomplete final lines with a tail backup, rejects complete corrupt records, and preserves history through plugin replacement/disable/uninstall unless plugin data deletion is selected. Clients must recover incomplete tool turns without replaying actions or approvals. See the AI assistant example for bounded model snapshots and a separate visible transcript.

Host 0.4.2 assistant integration adds derived fixed-width .idx files (16 bytes per JSONL event: byte offset, byte length and CRC32). These are rebuildable and should not be edited. Normal page reads seek to indexed records and verify their checksums; missing/invalid indexes trigger journal validation and rebuild. This avoids repeated whole-file scans while preserving JSONL as authoritative data. Conversation lists may return warnings for isolated unreadable sessions; clients should display them while keeping valid sessions accessible. Missing/broken metadata is rebuilt where the journal is valid. Unchanged metadata is no longer rewritten on every page read.
