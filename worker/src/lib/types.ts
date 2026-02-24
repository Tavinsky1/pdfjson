export interface Env {
  // Secrets
  DATABASE_URL: string;
  GROQ_API_KEY: string;
  SECRET_KEY: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;

  // Vars
  APP_NAME: string;
  APP_URL: string;
  API_KEY_PREFIX: string;
  MAX_UPLOAD_MB: string;
  FREE_MONTHLY_LIMIT: string;
  STARTER_MONTHLY_LIMIT: string;
  PRO_MONTHLY_LIMIT: string;
  SCALE_MONTHLY_LIMIT: string;
  LLM_PROVIDER: string;
  GROQ_MODEL: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_SCALE?: string;
}

export const TIER_LIMITS: Record<string, (env: Env) => number> = {
  free: (e) => parseInt(e.FREE_MONTHLY_LIMIT) || 50,
  starter: (e) => parseInt(e.STARTER_MONTHLY_LIMIT) || 500,
  pro: (e) => parseInt(e.PRO_MONTHLY_LIMIT) || 3000,
  scale: (e) => parseInt(e.SCALE_MONTHLY_LIMIT) || 20000,
};

export const TIER_DISPLAY = {
  free:    { name: "Free",    price: "$0",   limit: 50,    features: ["50 parses/month", "Invoice & receipt extraction", "JSON output"] },
  starter: { name: "Starter", price: "$19",  limit: 500,   features: ["500 parses/month", "AI-powered extraction", "Email support"] },
  pro:     { name: "Pro",     price: "$49",  limit: 3000,  features: ["3,000 parses/month", "AI-powered extraction", "Priority support"] },
  scale:   { name: "Scale",   price: "$149", limit: 20000, features: ["20,000 parses/month", "AI-powered extraction", "SLA + priority"] },
};
