import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';

export type ClientApp = 'passenger' | 'driver';

@Injectable()
export class DeviceRegistrationsRepository {
  /**
   * Upserts by installation id. A push token moves with the device: registering a token removes
   * it from any other installation first (a token belongs to one installation and one user).
   */
  async upsert(
    tx: Tx,
    input: {
      installationId: string;
      userId: string;
      app: ClientApp;
      platform: 'android' | 'ios';
      pushToken: string;
    },
  ): Promise<void> {
    await tx.query(
      `delete from taketuk.device_registrations where push_token = $1 and installation_id <> $2`,
      [input.pushToken, input.installationId],
    );
    await tx.query(
      `insert into taketuk.device_registrations (installation_id, user_id, app, platform, push_token)
       values ($1, $2, $3, $4, $5)
       on conflict (installation_id) do update
         set user_id = excluded.user_id, app = excluded.app, platform = excluded.platform,
             push_token = excluded.push_token`,
      [input.installationId, input.userId, input.app, input.platform, input.pushToken],
    );
  }

  async remove(db: Queryable, installationId: string, userId: string): Promise<void> {
    await db.query(
      `delete from taketuk.device_registrations where installation_id = $1 and user_id = $2`,
      [installationId, userId],
    );
  }

  async tokensFor(db: Queryable, userId: string, app: ClientApp): Promise<string[]> {
    const { rows } = await db.query<{ push_token: string }>(
      `select push_token from taketuk.device_registrations where user_id = $1 and app = $2`,
      [userId, app],
    );
    return rows.map((r) => r.push_token);
  }

  async removeTokens(db: Queryable, tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) return;
    await db.query(`delete from taketuk.device_registrations where push_token = any($1::text[])`, [
      tokens,
    ]);
  }
}
