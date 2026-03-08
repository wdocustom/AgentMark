import { createConnection, createTransport } from 'net';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { sleep } from '@agentmark/shared';

interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  headers?: Record<string, string>;
}

interface SMTPResponse {
  code: number;
  message: string;
}

/**
 * Built-from-scratch SMTP email sender.
 * No third-party email services - we talk SMTP directly.
 */
export class EmailSender {
  private smtpHost: string;
  private smtpPort: number;
  private smtpUser: string;
  private smtpPass: string;
  private fromDomain: string;

  constructor() {
    this.smtpHost = process.env.SMTP_HOST || 'localhost';
    this.smtpPort = parseInt(process.env.SMTP_PORT || '25');
    this.smtpUser = process.env.SMTP_USER || '';
    this.smtpPass = process.env.SMTP_PASS || '';
    this.fromDomain = process.env.EMAIL_DOMAIN || 'mail.agentmark.io';
  }

  async sendEmail(message: EmailMessage): Promise<{ messageId: string; success: boolean }> {
    const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@${this.fromDomain}>`;

    const rawEmail = this.buildRawEmail(message, messageId);

    try {
      await this.sendViaSMTP(message.to, message.from, rawEmail);
      return { messageId, success: true };
    } catch (error) {
      logger.error({ error, to: message.to }, 'Email send failed');
      throw error;
    }
  }

  private buildRawEmail(message: EmailMessage, messageId: string): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const date = new Date().toUTCString();

    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `X-Mailer: AgentMark/1.0`,
      ...(message.headers ? Object.entries(message.headers).map(([k, v]) => `${k}: ${v}`) : []),
    ];

    const parts = [];

    // Text part
    if (message.textBody) {
      parts.push([
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: quoted-printable`,
        ``,
        message.textBody,
      ].join('\r\n'));
    }

    // HTML part
    parts.push([
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      ``,
      message.htmlBody,
    ].join('\r\n'));

    return [
      headers.join('\r\n'),
      '',
      parts.join('\r\n'),
      `--${boundary}--`,
    ].join('\r\n');
  }

  private sendViaSMTP(to: string, from: string, rawEmail: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.smtpPort, this.smtpHost);
      let buffer = '';
      let step = 0;

      const commands = [
        null, // Wait for server greeting
        `EHLO ${this.fromDomain}\r\n`,
        ...(this.smtpUser ? [`AUTH LOGIN\r\n`] : []),
        ...(this.smtpUser ? [`${Buffer.from(this.smtpUser).toString('base64')}\r\n`] : []),
        ...(this.smtpPass ? [`${Buffer.from(this.smtpPass).toString('base64')}\r\n`] : []),
        `MAIL FROM:<${from}>\r\n`,
        `RCPT TO:<${to}>\r\n`,
        `DATA\r\n`,
        `${rawEmail}\r\n.\r\n`,
        `QUIT\r\n`,
      ];

      socket.setTimeout(30000);

      socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;
          const code = parseInt(line.substring(0, 3));

          if (code >= 400) {
            socket.end();
            reject(new Error(`SMTP error: ${line}`));
            return;
          }

          step++;
          if (step < commands.length && commands[step]) {
            socket.write(commands[step]!);
          }
        }
      });

      socket.on('connect', () => {
        // Wait for greeting
      });

      socket.on('end', () => resolve());
      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('SMTP connection timeout'));
      });
    });
  }

  /**
   * Process the email queue - call this from a worker/scheduler
   */
  async processQueue(batchSize: number = 50): Promise<{ sent: number; failed: number }> {
    const { rows: emails } = await query(
      `UPDATE email_queue SET status = 'sending'
       WHERE id IN (
         SELECT id FROM email_queue
         WHERE status = 'queued' AND attempts < max_attempts
         ORDER BY created_at LIMIT $1
         FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [batchSize]
    );

    let sent = 0;
    let failed = 0;

    for (const email of emails) {
      try {
        await this.sendEmail({
          to: email.to_address,
          from: email.from_address,
          subject: email.subject,
          htmlBody: email.html_body,
          textBody: email.text_body,
          headers: email.headers,
        });

        await query(
          "UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1",
          [email.id]
        );

        // Update campaign send status if linked
        if (email.campaign_send_id) {
          await query(
            "UPDATE campaign_sends SET status = 'sent', sent_at = NOW() WHERE id = $1",
            [email.campaign_send_id]
          );
        }

        sent++;
      } catch (error) {
        await query(
          "UPDATE email_queue SET status = 'queued', attempts = attempts + 1, error = $1 WHERE id = $2",
          [String(error), email.id]
        );
        failed++;
      }

      // Rate limiting between sends
      await sleep(100);
    }

    return { sent, failed };
  }

  /**
   * Queue an email for sending
   */
  async queueEmail(
    organizationId: string,
    message: EmailMessage,
    campaignSendId?: string
  ): Promise<string> {
    const { rows } = await query(
      `INSERT INTO email_queue (organization_id, to_address, from_address, subject, html_body, text_body, headers, campaign_send_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        organizationId, message.to, message.from, message.subject,
        message.htmlBody, message.textBody, JSON.stringify(message.headers || {}),
        campaignSendId,
      ]
    );
    return rows[0].id;
  }
}

export const emailSender = new EmailSender();
