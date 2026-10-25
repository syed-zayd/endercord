import { deferEphemeral, editDeferred, editDeferredFile, errorEmbed, getUser } from '../discord.js';
import type { DiscordInteraction, Env, RequestCtx } from '../types.js';

// DEMO: a message context-menu command ("Capture Proof"). Because this interaction
// is delivered to us already Ed25519-signed by Discord, and its body embeds the
// targeted message (author + content + timestamp), we can hand back a self-contained,
// independently-verifiable proof that survives the message being deleted.

export function handleCaptureProof(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): object {
  ctx.waitUntil(run(interaction, env, reqCtx));
  return deferEphemeral();
}

// UTF-8 string → base64 (preserves the exact signed bytes regardless of JSON quoting)
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function run(interaction: DiscordInteraction, env: Env, reqCtx: RequestCtx): Promise<void> {
  const data = interaction.data!;
  const targetId = data.target_id ?? '';
  const msg = data.resolved?.messages?.[targetId];

  if (!msg || !msg.author) {
    await editDeferred(env, interaction.token, { embeds: [errorEmbed('Could not read the target message.')] });
    return;
  }

  // The proof bundle — everything a third party needs to verify, without trusting this bot.
  const proof = {
    note: 'Verify: fetch this app\'s public key from Discord (GET /applications/<application_id> -> verify_key), then Ed25519.verify(verify_key, hexToBytes(signature), utf8Bytes(signature_timestamp + base64Decode(body_base64))). The verified body is a Discord interaction; the captured message is at data.resolved.messages[target_id].',
    application_id: env.DISCORD_APP_ID,
    target_id: targetId,
    signature: reqCtx.signature,
    signature_timestamp: reqCtx.timestamp,
    body_base64: toBase64(reqCtx.rawBody),
  };
  const proofBytes = new TextEncoder().encode(JSON.stringify(proof, null, 2));

  const who = getUser(interaction);
  const summary =
    '🔒 **Captured a Discord-signed proof of this message.**\n' +
    `**Author:** ${msg.author.global_name ?? msg.author.username ?? '?'} ` +
    `(@${msg.author.username ?? '?'}, id \`${msg.author.id}\`)\n` +
    `**Sent:** ${msg.timestamp ?? '?'}${msg.edited_timestamp ? ' (edited)' : ''}\n` +
    '**Content:**\n' +
    '```\n' + (msg.content && msg.content.length ? msg.content.slice(0, 1500) : '(empty — see caveat)') + '\n```\n' +
    `Captured by ${who.username}. The attached \`proof.json\` is independently verifiable even after the message is deleted.`;

  await editDeferredFile(
    env, interaction.token, { content: summary },
    { name: 'proof.json', bytes: proofBytes, contentType: 'application/json' },
  );
}
