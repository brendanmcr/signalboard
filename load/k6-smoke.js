// k6 smoke test: mixed read/write load against a locally started server.
// Thresholds are enforced in CI — a p95 regression fails the build.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:3000";
const VIEWER = __ENV.VIEWER_KEY;
const POSTER = __ENV.POSTER_KEY;
const CHANNEL = __ENV.CHANNEL_ID;

export const options = {
  scenarios: {
    readers: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      exec: "read",
    },
    writers: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 10,
      exec: "write",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<100"],
    http_req_failed: ["rate<0.01"],
  },
};

export function read() {
  const res = http.get(`${BASE}/api/channels/${CHANNEL}/signals?limit=20`, {
    headers: { Authorization: `Bearer ${VIEWER}` },
  });
  check(res, { "read 200": (r) => r.status === 200 });
}

export function write() {
  const res = http.post(
    `${BASE}/api/channels/${CHANNEL}/signals`,
    JSON.stringify({ status: "ok", message: `load beat ${Date.now()}` }),
    { headers: { Authorization: `Bearer ${POSTER}`, "Content-Type": "application/json" } }
  );
  check(res, { "write 201": (r) => r.status === 201 });
}
