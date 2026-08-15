import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAlert,
  channelLabel,
  determineTransition,
  loadChannelConfiguration,
  runDispatcher,
  transitionLabel,
  withRetry,
} from "./dispatcher.mjs";

const now = new Date("2026-08-15T12:00:00Z");
const baseIssue = {
  number: 50,
  title: "🛑 API — Liveness is down",
  state: "open",
  created_at: "2026-08-15T11:59:00Z",
  labels: [{ name: "status" }, { name: "api-liveness" }],
};

test("indisponibilidade alerta imediatamente e é idempotente por label", () => {
  assert.equal(determineTransition(baseIssue, { now }), "down");
  assert.equal(determineTransition({
    ...baseIssue,
    labels: [...baseIssue.labels, { name: transitionLabel("down") }],
  }, { now }), null);
});

test("degradação exige confirmação em uma verificação posterior", () => {
  const issue = {
    ...baseIssue,
    title: "🟨 API — Liveness has degraded performance",
    created_at: "2026-08-15T11:50:00Z",
  };
  assert.equal(determineTransition(issue, {
    now,
    currentHistory: { status: "degraded", lastUpdated: "2026-08-15T11:51:00Z" },
  }), null);
  assert.equal(determineTransition(issue, {
    now,
    currentHistory: { status: "degraded", lastUpdated: "2026-08-15T11:55:00Z" },
  }), "degraded");
});

test("recuperação só é enviada para incidente previamente notificado", () => {
  assert.equal(determineTransition({ ...baseIssue, state: "closed" }, { now }), null);
  assert.equal(determineTransition({
    ...baseIssue,
    state: "closed",
    labels: [...baseIssue.labels, { name: transitionLabel("down") }],
  }, { now }), "recovery");
});

test("backoff repete até sucesso", async () => {
  let calls = 0;
  const waits = [];
  const result = await withRetry(() => {
    calls += 1;
    if (calls < 3) throw new Error("temporary");
    return "sent";
  }, {
    wait: async (milliseconds) => waits.push(milliseconds),
    baseDelayMs: 10,
  });

  assert.equal(result, "sent");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("configuração aceita múltiplos destinatários sem versioná-los", () => {
  const config = loadChannelConfiguration({
    RESEND_API_KEY: "secret",
    ALERT_EMAIL_FROM: "Status <status@example.com>",
    ALERT_EMAIL_TO: "one@example.com, two@example.com;three@example.com",
    TELEGRAM_BOT_TOKEN: "bot-secret",
    TELEGRAM_CHAT_ID: "-1000",
  });
  assert.deepEqual(config.email.to, ["one@example.com", "two@example.com", "three@example.com"]);
  assert.equal(config.telegram.chatId, "-1000");
  assert.equal(channelLabel("email", "down"), "alert:email-down-sent");
});

test("execução operacional exige os dois canais configurados", async () => {
  await assert.rejects(() => runDispatcher({
    environment: {
      RESEND_API_KEY: "secret",
      ALERT_EMAIL_FROM: "Status <status@example.com>",
      ALERT_EMAIL_TO: "one@example.com",
    },
    now,
  }), /Resend e Telegram/);
});

test("mensagem é em português, sanitizada e inclui links operacionais", () => {
  const alert = buildAlert({
    service: { name: "API", description: "Disponibilidade do processo" },
    transition: "down",
    issue: { html_url: "https://github.com/icone-academy/icone-status/issues/50" },
    now,
  });
  assert.match(alert.subject, /Indisponibilidade: API/);
  assert.match(alert.text, /Estado: indisponível/);
  assert.match(alert.text, /status\.icone\.academy/);
  assert.doesNotMatch(alert.text, /exception|queue count|token/i);
});
