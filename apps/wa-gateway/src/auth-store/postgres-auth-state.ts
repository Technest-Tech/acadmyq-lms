import type { Pool } from 'pg'
import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationState,
  type SignalDataTypeMap,
} from 'baileys'

/**
 * A Postgres-backed implementation of Baileys' AuthenticationState — the linchpin of "survive a
 * restart without re-scanning the QR". Creds live on the session row; signal keys live in
 * wa_signal_keys. Buffers are round-tripped with Baileys' BufferJSON replacer/reviver (the #1
 * custom-auth-store bug if omitted). pg auto-serializes/parses the jsonb columns.
 *
 * Wrap `state.keys` with `makeCacheableSignalKeyStore` at the call site so hot keys are cached in
 * memory and DB writes are batched, not issued on every signal operation.
 */
export async function usePostgresAuthState(
  pool: Pool,
  sessionId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const credsRes = await pool.query('select creds from wa_sessions where session_id = $1', [sessionId])
  const storedCreds = credsRes.rows[0]?.creds
  const creds = storedCreds
    ? JSON.parse(JSON.stringify(storedCreds), BufferJSON.reviver)
    : initAuthCreds()

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result: { [id: string]: SignalDataTypeMap[typeof type] } = {}
        if (!ids.length) return result
        const res = await pool.query(
          'select key_id, key_data from wa_signal_keys where session_id = $1 and key_type = $2 and key_id = any($3::text[])',
          [sessionId, type, ids],
        )
        for (const row of res.rows) {
          let value = JSON.parse(JSON.stringify(row.key_data), BufferJSON.reviver)
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value)
          }
          result[row.key_id as string] = value
        }
        return result
      },
      set: async (data) => {
        const client = await pool.connect()
        try {
          await client.query('begin')
          for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            const entries = data[category]
            if (!entries) continue
            for (const id of Object.keys(entries)) {
              const value = entries[id]
              if (value) {
                const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer))
                await client.query(
                  `insert into wa_signal_keys (session_id, key_type, key_id, key_data, updated_at)
                     values ($1, $2, $3, $4, now())
                   on conflict (session_id, key_type, key_id)
                     do update set key_data = excluded.key_data, updated_at = now()`,
                  [sessionId, category, id, serialized],
                )
              } else {
                await client.query(
                  'delete from wa_signal_keys where session_id = $1 and key_type = $2 and key_id = $3',
                  [sessionId, category, id],
                )
              }
            }
          }
          await client.query('commit')
        } catch (e) {
          try {
            await client.query('rollback')
          } catch {
            /* ignore rollback error */
          }
          throw e
        } finally {
          client.release()
        }
      },
    },
  }

  const saveCreds = async (): Promise<void> => {
    const serialized = JSON.parse(JSON.stringify(state.creds, BufferJSON.replacer))
    await pool.query('update wa_sessions set creds = $2, updated_at = now() where session_id = $1', [
      sessionId,
      serialized,
    ])
  }

  return { state, saveCreds }
}

/** Wipe a session's stored credentials + signal keys (e.g. on badSession → fresh QR). */
export async function clearAuthState(pool: Pool, sessionId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('delete from wa_signal_keys where session_id = $1', [sessionId])
    await client.query('update wa_sessions set creds = null where session_id = $1', [sessionId])
    await client.query('commit')
  } catch (e) {
    try {
      await client.query('rollback')
    } catch {
      /* ignore rollback error */
    }
    throw e
  } finally {
    client.release()
  }
}
