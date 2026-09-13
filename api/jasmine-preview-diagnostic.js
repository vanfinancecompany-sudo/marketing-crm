import { handleCustomerAssistantRequest } from './ai-assistant-customer.js';

export default async function handler(request, response) {
  if (process.env.VERCEL_ENV !== 'preview') return response.status(404).json({ ok: false, error: 'preview only' });
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'GET only' });

  const capture = {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };

  const fakeRequest = {
    method: 'POST',
    headers: {
      origin: 'https://www.vanfinancecompany.co.uk',
      'x-forwarded-for': '127.0.0.1',
    },
    body: {
      action: 'start',
      page_context: {
        page_type: 'finance_general',
        product: 'finance',
        page_path: '/diagnostic',
        page_title: 'Jasmine preview diagnostic',
        category: 'general',
        available_customer_action: 'enquire',
        context_source: 'diagnostic',
        vehicle: {},
      },
      analytics_visitor_id: 'diagnostic',
    },
  };

  await handleCustomerAssistantRequest(fakeRequest, capture);

  return response.status(200).json({
    ok: capture.statusCode === 200,
    backendStatus: capture.statusCode,
    backendPayload: capture.payload ? {
      status: capture.payload.status || null,
      reply: capture.payload.reply || null,
      conversation_id_present: Boolean(capture.payload.conversation_id),
    } : null,
    env: {
      supabase_url: Boolean(process.env.SUPABASE_URL),
      supabase_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      session_secret: Boolean(process.env.AI_ASSISTANT_SESSION_SECRET),
      openai_key: Boolean(process.env.OPENAI_API_KEY),
    },
  });
}
