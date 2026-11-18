import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export type LostFoundEventType =
  | 'LOST_FOUND_SMART_MATCH'
  | 'LOST_FOUND_CLAIM_SUBMITTED'
  | 'LOST_FOUND_CLAIM_APPROVED'
  | 'LOST_FOUND_CLAIM_REJECTED'
  | 'LOST_FOUND_ITEM_RETURNED';

export interface LostFoundNotificationPayload {
  userId?: string;
  tenantKey: string;
  organizationId: string;
  event: LostFoundEventType;
  title: string;
  message: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class IntranetNotificationService {
  private readonly logger = new Logger(IntranetNotificationService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Sends non-blocking in-app notification (HealthyStudy Notification service)
   * and signed webhook events (`WEBHOOK_URL`) for external REST API consumers.
   */
  async dispatch(payload: LostFoundNotificationPayload): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    if (payload.tenantKey === 'healthystudy' && payload.userId) {
      tasks.push(this.sendToHealthyStudyNotifications(payload));
    }

    const webhookUrl = this.configService.get<string>('webhookUrl') || '';
    if (webhookUrl) {
      tasks.push(this.sendToExternalWebhook(webhookUrl, payload));
    }

    await Promise.allSettled(tasks);
  }

  private async sendToHealthyStudyNotifications(
    payload: LostFoundNotificationPayload,
  ): Promise<void> {
    const notifBase =
      this.configService.get<string>('notificationServiceUrl') ||
      'http://localhost:3002';
    const secret =
      this.configService.get<string>('internalServiceSecret') || '';

    try {
      await fetch(
        `${notifBase}/api/notifications/internal/send?userId=${encodeURIComponent(
          payload.userId!,
        )}`,
        {
          method: 'POST',
          headers: {
            'x-internal-secret': secret,
            'x-internal-key': secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'SYSTEM',
            eventType: payload.event,
            title: payload.title,
            message: payload.message,
            actionUrl: payload.actionUrl || null,
            actionData: {
              __eventType: payload.event,
              organizationId: payload.organizationId,
              ...(payload.data || {}),
            },
          }),
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch (err) {
      this.logger.debug(
        `Notification dispatch skipped (${payload.event}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async sendToExternalWebhook(
    webhookUrl: string,
    payload: LostFoundNotificationPayload,
  ): Promise<void> {
    const body = JSON.stringify({
      event: payload.event,
      tenantKey: payload.tenantKey,
      organizationId: payload.organizationId,
      userId: payload.userId || null,
      title: payload.title,
      message: payload.message,
      data: payload.data || {},
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-intranet-event': payload.event,
    };
    const webhookSecret =
      this.configService.get<string>('webhookSecret') || '';
    if (webhookSecret) {
      headers['x-intranet-signature'] = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');
    }

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(4000),
      });
    } catch (err) {
      this.logger.warn(
        `Webhook delivery failed (${payload.event}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
