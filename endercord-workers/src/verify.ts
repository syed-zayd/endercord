export async function verifyDiscordRequest(
  body: string, signature: string, timestamp: string, publicKey: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', hexToBytes(publicKey), { name: 'Ed25519' }, false, ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519', key, hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}
