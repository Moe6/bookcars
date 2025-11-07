import axios from 'axios'
import * as nodemailer from 'nodemailer'
import SMTPTransport from 'nodemailer/lib/smtp-transport'
import * as env from '../config/env.config'

const createSmtpTransporter = async (): Promise<nodemailer.Transporter> => {
  if (env.CI) {
    const testAccount = await nodemailer.createTestAccount()
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    })
  }

  const transporterOptions: SMTPTransport.Options = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    auth: env.SMTP_USER && env.SMTP_PASS ? {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : undefined,
  }

  return nodemailer.createTransport(transporterOptions)
}

const sendViaSmtp = async (mailOptions: nodemailer.SendMailOptions) => {
  const transporter = await createSmtpTransporter()
  return transporter.sendMail(mailOptions)
}

const normaliseAddress = (value: nodemailer.SendMailOptions['from'] | nodemailer.SendMailOptions['to']) => {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : item.address)).filter(Boolean).join(',')
  }

  return value.address ?? ''
}

const sendViaEmailJs = async (mailOptions: nodemailer.SendMailOptions) => {
  const to = normaliseAddress(mailOptions.to)
  if (!to) {
    throw new Error('EMAILJS_MISSING_RECIPIENT')
  }

  const from = normaliseAddress(mailOptions.from) || env.SMTP_FROM
  const replyTo = normaliseAddress(mailOptions.replyTo) || from

  const payload: Record<string, unknown> = {
    service_id: env.EMAILJS_SERVICE_ID,
    template_id: env.EMAILJS_TEMPLATE_ID,
    user_id: env.EMAILJS_PUBLIC_KEY,
    template_params: {
      to_email: to,
      from_email: from,
      reply_to: replyTo,
      subject: mailOptions.subject ?? '',
      message_html: mailOptions.html ?? '',
      message_text: mailOptions.text ?? '',
    },
  }

  if (env.EMAILJS_PRIVATE_KEY) {
    payload.accessToken = env.EMAILJS_PRIVATE_KEY
  }

  const response = await axios.post(env.EMAILJS_API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  })

  return {
    accepted: to.split(',').map((email) => email.trim()).filter(Boolean),
    rejected: [],
    envelope: {
      from,
      to: to.split(',').map((email) => email.trim()).filter(Boolean),
    },
    messageId: typeof response.data === 'object' && response.data && 'id' in response.data ? String(response.data.id) : undefined,
    response: response.statusText,
  } as nodemailer.SentMessageInfo
}

/**
 * Sends an email using either SMTP/Nodemailer or the EmailJS REST API depending on configuration.
 *
 * @param mailOptions - Email content and metadata
 * @returns A promise resolving to the sending result
 */
export const sendMail = async (mailOptions: nodemailer.SendMailOptions): Promise<nodemailer.SentMessageInfo> => {
  if (env.MAIL_PROVIDER === 'emailjs') {
    return sendViaEmailJs(mailOptions)
  }

  return sendViaSmtp(mailOptions)
}
