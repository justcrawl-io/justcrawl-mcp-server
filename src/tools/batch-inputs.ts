/** Durable input upload with bounded model-authored chunks and exact receipt replay. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { structuredJsonResult } from './helpers.js';
import { batchEnvelope, batchOutputSchema, invalidBatchArguments, runBatchTool, type BatchNextStep } from './batch-output.js';

/** Register the create/append/seal/metadata adapter; no input URLs are returned. */
export function registerBatchInputTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool('jc_batch_input_upload', {
    title: 'Upload a durable BatchJob input',
    description: 'Create an input by omitting inputId, or append a bounded chunk to an existing input. Keep inputId and zero-based ordinal. ' +
      'Each call accepts at most 100 entries and 256 KiB serialized UTF-8 including the envelope. Repeat the exact chunk and ordinal to replay its receipt. ' +
      'Optional seal requires the exact submitted chunkCount and entryCount, including rejected entries. Pass inputId alone to read bounded metadata. ' +
      'This does not start a run. Requires urls:write and verified email for writes; metadata requires jobs:read.',
    inputSchema: {
      inputId: z.string().uuid().optional(),
      ordinal: z.number().int().min(0).max(2147483647).optional(),
      entries: z.array(z.string()).max(100).optional(),
      seal: z.object({ chunkCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        entryCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).optional(),
    },
    outputSchema: batchOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ inputId, ordinal, entries, seal }) => {
    let retainedId = inputId;
    const nextStep = (): BatchNextStep => retainedId
      ? { tool: 'jc_batch_input_upload', arguments: { inputId: retainedId },
        reason: 'Inspect bounded input metadata; append the next chunk or repeat the exact previous chunk and ordinal to recover its receipt.' }
      : { tool: 'jc_batch_jobs_list', arguments: {}, reason: 'Resolve the upload failure before creating another input.' };
    return runBatchTool('jc_batch_input_upload', nextStep, async () => {
      if (entries === undefined && ordinal !== undefined) invalidBatchArguments();
      // A generated input ID is a UUID too; reserve its full envelope before creating any state.
      const append = entries === undefined ? undefined : { ordinal: ordinal ?? 0, entries };
      if (append && new TextEncoder().encode(JSON.stringify({ inputId: retainedId ?? '00000000-0000-4000-8000-000000000000', ...append })).byteLength > 256 * 1024) {
        invalidBatchArguments();
      }
      let metadata: Awaited<ReturnType<typeof client.batchInputs.get>> | null = null;
      if (!retainedId) {
        metadata = await client.batchInputs.create();
        retainedId = metadata.id;
      }
      const receipt = append ? await client.batchInputs.append(retainedId, append) : null;
      if (append) metadata = null;
      if (seal) metadata = await client.batchInputs.seal(retainedId, seal);
      else if (!append && inputId) metadata = await client.batchInputs.get(retainedId);
      const following: BatchNextStep = metadata?.state === 'sealed'
        ? { tool: 'jc_batch_jobs_count', arguments: { source: { inputId: retainedId } }, reason: 'Count the sealed input and show its size before a launch.' }
        : nextStep();
      return structuredJsonResult(batchEnvelope('input_upload', following, { inputId: retainedId, metadata, receipt }));
    }, () => ({ inputId: retainedId ?? null }));
  });
}
